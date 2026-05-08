use chrono::{DateTime, Utc};
use portable_pty::{native_pty_system, Child, CommandBuilder, PtyPair, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufWriter, Read, Write};
use std::sync::{Arc, Mutex as StdMutex};
use std::thread::JoinHandle;
use tokio::sync::mpsc;
use uuid::Uuid;

/// Shells allowed for PTY spawning on non-Windows platforms.
/// Defined once here; the three `create_*_terminal` methods all reference this.
const VALID_SHELLS: &[&str] = &[
    "/bin/bash",
    "/bin/sh",
    "/bin/zsh",
    "/bin/fish",
    "/bin/dash",
    "/usr/bin/bash",
    "/usr/bin/sh",
    "/usr/bin/zsh",
    "/usr/bin/fish",
    "/usr/bin/dash",
    "/usr/local/bin/bash",
    "/usr/local/bin/zsh",
    "/usr/local/bin/fish",
    "/opt/homebrew/bin/bash",
    "/opt/homebrew/bin/zsh",
    "/opt/homebrew/bin/fish",
];

// ── PTY spawn helper ──────────────────────────────────────────────────────────

/// Outputs of the shared PTY spawn path returned to each `create_*_terminal` caller.
struct PtySpawnResult {
    pty_pair: PtyPair,
    writer: Arc<StdMutex<Box<dyn Write + Send>>>,
    reader_handle: JoinHandle<()>,
    child: Box<dyn Child + Send + Sync>,
}

/// Open a PTY pair, spawn `cmd`, start the reader thread, and return the handles.
///
/// This is the **single canonical PTY spawn path** shared by `create_terminal`,
/// `create_script_terminal`, and `create_shell_terminal` (Issue #60).
///
/// The caller is responsible for:
/// - building the `CommandBuilder` (program, args, cwd, env)
/// - generating the terminal `id`
/// - inserting the result into `TerminalManager::terminals`
fn spawn_pty(
    cmd: CommandBuilder,
    id: String,
    tx: mpsc::Sender<(String, Vec<u8>)>,
    log_file_path: Option<String>,
) -> Result<PtySpawnResult, String> {
    let pty_system = native_pty_system();
    let pty_pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open pty: {}", e))?;

    // Spawn the command — keep the handle so we can kill it explicitly on close
    let child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn command: {}", e))?;

    let mut reader = pty_pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone reader: {}", e))?;
    let writer = Arc::new(StdMutex::new(
        pty_pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to take writer: {}", e))?,
    ));

    // Spawn reader thread.
    // 32 KB buffer — amortizes syscall overhead for high-throughput output
    // and reduces the number of IPC messages emitted to the frontend.
    // `log_file_path` is Some only for Claude terminals; the Option is handled
    // inline so no separate code path is needed.
    let reader_handle = std::thread::spawn(move || {
        let mut buf = [0u8; 32 * 1024];
        // Wrap the log file in a BufWriter so fs writes batch instead of
        // issuing one syscall per PTY chunk.
        let mut log_file = log_file_path.and_then(|path| {
            std::fs::File::create(&path)
                .map_err(|e| eprintln!("Failed to create log file: {}", e))
                .ok()
                .map(|f| BufWriter::with_capacity(64 * 1024, f))
        });
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = buf[..n].to_vec();
                    // Write ANSI-stripped output to log file (no-op when log_file is None)
                    if let Some(ref mut file) = log_file {
                        let stripped = strip_ansi_escapes::strip(&data);
                        let _ = file.write_all(&stripped);
                    }
                    if tx.blocking_send((id.clone(), data)).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    eprintln!("Error reading from pty: {}", e);
                    let _ = tx.blocking_send((
                        id.clone(),
                        format!("\r\n[Error reading from terminal: {}]\r\n", e).into_bytes(),
                    ));
                    break;
                }
            }
        }
        // Flush any pending buffered log writes before the thread exits.
        if let Some(ref mut file) = log_file {
            let _ = file.flush();
        }
    });

    Ok(PtySpawnResult {
        pty_pair,
        writer,
        reader_handle,
        child,
    })
}

// ── Data types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalConfig {
    pub id: String,
    pub label: String,
    pub nickname: Option<String>,
    pub profile_id: Option<String>,
    pub working_directory: String,
    pub claude_args: Vec<String>,
    pub env_vars: HashMap<String, String>,
    pub created_at: DateTime<Utc>,
    pub status: TerminalStatus,
    pub color_tag: Option<String>,
    #[serde(default)]
    pub pinned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TerminalStatus {
    Running,
    Idle,
    Error,
    Stopped,
}

pub struct Terminal {
    pub config: TerminalConfig,
    /// Kept alive to maintain the PTY connection
    pub pty_pair: PtyPair,
    /// Per-terminal writer lock — allows concurrent writes to different terminals
    /// without contending on the outer TerminalManager mutex.
    pub writer: Arc<StdMutex<Box<dyn Write + Send>>>,
    /// Handle to the reader thread for cleanup on close
    pub reader_handle: Option<JoinHandle<()>>,
    /// Child process handle — killed explicitly on close so the PTY read
    /// unblocks promptly on Windows (reads can block even after writer drop).
    pub child: Box<dyn Child + Send + Sync>,
}

pub struct TerminalManager {
    pub terminals: HashMap<String, Terminal>,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            terminals: HashMap::new(),
        }
    }

    /// Characters that could enable shell injection when passed through `cmd /C` or `sh -c`
    const SHELL_METACHARACTERS: &'static [char] = &[
        '&', '|', ';', '`', '$', '(', ')', '{', '}', '<', '>', '^', '\n', '\r', '\'', '"', '\\',
        '~', '*', '?', '[', ']', '!', '\t', '#',
    ];

    /// Environment variable names that must not be overridden by user profiles
    const BLOCKED_ENV_VARS: &'static [&'static str] = &[
        "PATH",
        "PATHEXT",
        "COMSPEC",
        "SYSTEMROOT",
        "WINDIR",
        "LD_PRELOAD",
        "LD_LIBRARY_PATH",
        "DYLD_INSERT_LIBRARIES",
        "DYLD_LIBRARY_PATH",
        "NODE_OPTIONS",
        "NODE_EXTRA_CA_CERTS",
        "ELECTRON_RUN_AS_NODE",
        "HOME",
        "USERPROFILE",
        "HOMEDRIVE",
        "HOMEPATH",
    ];

    #[expect(
        clippy::too_many_arguments,
        reason = "Terminal creation mirrors the IPC payload plus PTY channel/log plumbing"
    )]
    pub fn create_terminal(
        &mut self,
        label: String,
        working_directory: String,
        claude_args: Vec<String>,
        env_vars: HashMap<String, String>,
        color_tag: Option<String>,
        nickname: Option<String>,
        tx: mpsc::Sender<(String, Vec<u8>)>,
        log_file_path: Option<String>,
    ) -> Result<TerminalConfig, String> {
        // Validate claude_args: reject any argument containing shell metacharacters
        for arg in &claude_args {
            if arg.contains(Self::SHELL_METACHARACTERS) {
                return Err(format!(
                    "Invalid character in argument: \"{}\". Shell metacharacters are not allowed.",
                    arg
                ));
            }
        }

        // Filter out blocked environment variables
        let safe_env_vars: HashMap<String, String> = env_vars
            .into_iter()
            .filter(|(key, _)| {
                let upper = key.to_uppercase();
                !Self::BLOCKED_ENV_VARS
                    .iter()
                    .any(|blocked| blocked.eq_ignore_ascii_case(&upper))
            })
            .collect();

        // Spawn claude directly so the process exits when claude finishes,
        // allowing the terminal-finished event to fire for notifications
        #[cfg(target_os = "windows")]
        let mut cmd = {
            let mut c = CommandBuilder::new("cmd.exe");
            c.arg("/C");
            c.arg("claude");
            for arg in &claude_args {
                c.arg(arg);
            }
            c
        };

        #[cfg(not(target_os = "windows"))]
        let mut cmd = {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
            // Validate $SHELL against allowlist
            let shell = if VALID_SHELLS.contains(&shell.as_str()) {
                shell
            } else {
                "/bin/bash".to_string()
            };
            let mut c = CommandBuilder::new(&shell);
            // Build command string with shell-escaped args as defense-in-depth
            // (args are already validated against metacharacters above)
            let mut full_cmd = "claude".to_string();
            for arg in &claude_args {
                full_cmd.push(' ');
                // Single-quote wrap each arg; escape embedded single quotes
                full_cmd.push('\'');
                for ch in arg.chars() {
                    if ch == '\'' {
                        full_cmd.push_str("'\\''");
                    } else {
                        full_cmd.push(ch);
                    }
                }
                full_cmd.push('\'');
            }
            c.arg("-lc");
            c.arg(&full_cmd);
            c
        };

        // Set working directory
        if !working_directory.is_empty() {
            cmd.cwd(&working_directory);
        }

        // Set environment variables (blocked keys already filtered out)
        for (key, value) in &safe_env_vars {
            cmd.env(key, value);
        }

        let id = Uuid::new_v4().to_string();
        let config = TerminalConfig {
            id: id.clone(),
            label,
            nickname,
            profile_id: None,
            working_directory,
            claude_args,
            env_vars: safe_env_vars,
            created_at: Utc::now(),
            status: TerminalStatus::Running,
            color_tag,
            pinned: false,
        };

        let PtySpawnResult {
            pty_pair,
            writer,
            reader_handle,
            child,
        } = spawn_pty(cmd, id.clone(), tx, log_file_path)?;

        self.terminals.insert(
            id.clone(),
            Terminal {
                config: config.clone(),
                pty_pair,
                writer,
                reader_handle: Some(reader_handle),
                child,
            },
        );

        Ok(config)
    }

    /// Spawn a PTY running `npm run <script>` in the given working directory.
    /// Used by the package.json scripts runner. Reuses the same reader thread
    /// plumbing as `create_terminal` so frontend handling is unchanged.
    pub fn create_script_terminal(
        &mut self,
        label: String,
        working_directory: String,
        script_name: String,
        tx: mpsc::Sender<(String, Vec<u8>)>,
    ) -> Result<TerminalConfig, String> {
        // npm script names come from package.json keys but the user picks them
        // via UI, so reject any shell metacharacter as defense-in-depth.
        if script_name.is_empty() || script_name.contains(Self::SHELL_METACHARACTERS) {
            return Err(format!("Invalid script name: '{}'", script_name));
        }

        #[cfg(target_os = "windows")]
        let cmd = {
            let mut c = CommandBuilder::new("cmd.exe");
            c.arg("/C");
            c.arg("npm");
            c.arg("run");
            c.arg(&script_name);
            c
        };

        #[cfg(not(target_os = "windows"))]
        let cmd = {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
            let shell = if VALID_SHELLS.contains(&shell.as_str()) {
                shell
            } else {
                "/bin/bash".to_string()
            };
            let mut c = CommandBuilder::new(&shell);
            // Single-quote the script name as defense-in-depth (already validated above).
            let mut full = String::from("npm run '");
            for ch in script_name.chars() {
                if ch == '\'' {
                    full.push_str("'\\''");
                } else {
                    full.push(ch);
                }
            }
            full.push('\'');
            c.arg("-lc");
            c.arg(&full);
            c
        };

        let mut cmd = cmd;
        if !working_directory.is_empty() {
            cmd.cwd(&working_directory);
        }

        let id = Uuid::new_v4().to_string();
        let config = TerminalConfig {
            id: id.clone(),
            label,
            nickname: Some(format!("npm run {}", script_name)),
            profile_id: None,
            working_directory,
            // Reuse claude_args to carry the script command — simplest fit for
            // restore / session history without adding another schema field.
            claude_args: vec!["__script__".into(), script_name.clone()],
            env_vars: HashMap::new(),
            created_at: Utc::now(),
            status: TerminalStatus::Running,
            color_tag: None,
            pinned: false,
        };

        let PtySpawnResult {
            pty_pair,
            writer,
            reader_handle,
            child,
        } = spawn_pty(cmd, id.clone(), tx, None)?;

        self.terminals.insert(
            id.clone(),
            Terminal {
                config: config.clone(),
                pty_pair,
                writer,
                reader_handle: Some(reader_handle),
                child,
            },
        );

        Ok(config)
    }

    /// Spawn an interactive shell at `working_directory`. No `claude`, no
    /// `npm run` — just a plain shell the user can drive (run scripts, hit
    /// Ctrl+C to stop them, etc.). Reuses the same PTY/reader plumbing so
    /// `write_to_terminal` and `terminal-output` events Just Work.
    pub fn create_shell_terminal(
        &mut self,
        label: String,
        working_directory: String,
        tx: mpsc::Sender<(String, Vec<u8>)>,
    ) -> Result<TerminalConfig, String> {
        #[cfg(target_os = "windows")]
        let cmd = {
            // ComSpec is whatever the user has set as their shell — typically
            // cmd.exe but could be PowerShell. Without /C the shell stays
            // interactive.
            let exe = std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".to_string());
            CommandBuilder::new(exe)
        };

        #[cfg(not(target_os = "windows"))]
        let cmd = {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
            let shell = if VALID_SHELLS.contains(&shell.as_str()) {
                shell
            } else {
                "/bin/bash".to_string()
            };
            let mut c = CommandBuilder::new(&shell);
            // Login + interactive so the user gets their normal prompt.
            c.arg("-li");
            c
        };

        let mut cmd = cmd;
        if !working_directory.is_empty() {
            cmd.cwd(&working_directory);
        }

        let id = Uuid::new_v4().to_string();
        let config = TerminalConfig {
            id: id.clone(),
            label,
            nickname: None,
            profile_id: None,
            working_directory,
            // Tag this terminal so persistence/restore can recognise it as a
            // plain shell — same trick create_script_terminal uses.
            claude_args: vec!["__shell__".into()],
            env_vars: HashMap::new(),
            created_at: Utc::now(),
            status: TerminalStatus::Running,
            color_tag: None,
            pinned: false,
        };

        let PtySpawnResult {
            pty_pair,
            writer,
            reader_handle,
            child,
        } = spawn_pty(cmd, id.clone(), tx, None)?;

        self.terminals.insert(
            id.clone(),
            Terminal {
                config: config.clone(),
                pty_pair,
                writer,
                reader_handle: Some(reader_handle),
                child,
            },
        );

        Ok(config)
    }

    /// Return a cloned Arc to the per-terminal writer. The caller can hold this
    /// *after* releasing the TerminalManager lock, enabling concurrent writes to
    /// different terminals without cross-terminal contention.
    pub fn get_writer(&self, id: &str) -> Option<Arc<StdMutex<Box<dyn Write + Send>>>> {
        self.terminals.get(id).map(|t| Arc::clone(&t.writer))
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        if let Some(terminal) = self.terminals.get(id) {
            let mut w = terminal
                .writer
                .lock()
                .map_err(|_| "Terminal writer mutex poisoned".to_string())?;
            w.write_all(data)
                .map_err(|e| format!("Failed to write: {}", e))?;
            w.flush().map_err(|e| format!("Failed to flush: {}", e))
        } else {
            Err("Terminal not found".to_string())
        }
    }

    pub fn resize(&mut self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        if let Some(terminal) = self.terminals.get_mut(id) {
            terminal
                .pty_pair
                .master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| format!("Failed to resize: {}", e))?;
            Ok(())
        } else {
            Err("Terminal not found".to_string())
        }
    }

    pub fn close(&mut self, id: &str) -> Result<(), String> {
        if let Some(mut terminal) = self.terminals.remove(id) {
            // Kill the child process first so the PTY master read unblocks immediately.
            // On Windows, PTY reads can block indefinitely even after the writer is
            // dropped — without an explicit kill the reader thread would leak.
            let _ = terminal.child.kill();
            drop(terminal);
        }
        Ok(())
    }

    pub fn close_all(&mut self) {
        // Kill all child processes before clearing so reader threads unblock promptly.
        for terminal in self.terminals.values_mut() {
            let _ = terminal.child.kill();
        }
        self.terminals.clear();
    }

    /// Gracefully shut down all PTY child processes:
    /// 1. Send SIGTERM to every child (Unix) or kill() immediately (Windows).
    /// 2. Poll try_wait() for up to 2 seconds so children can flush and exit cleanly.
    /// 3. Force-kill any process that did not exit within the grace period.
    /// 4. Clear all terminal state.
    pub fn shutdown_all_graceful(&mut self) {
        // Phase 1: request graceful termination
        for terminal in self.terminals.values_mut() {
            #[cfg(unix)]
            {
                if let Some(pid) = terminal.child.process_id() {
                    // SAFETY: `pid` is a valid process ID returned by the OS for a child
                    // we spawned. SIGTERM asks the process to exit without forcing it,
                    // so this is safe even if the process has already exited.
                    unsafe {
                        libc::kill(pid as libc::pid_t, libc::SIGTERM);
                    }
                }
            }
            #[cfg(not(unix))]
            {
                // Windows has no SIGTERM equivalent; kill() closes the PTY immediately.
                let _ = terminal.child.kill();
            }
        }

        // Phase 2: wait up to 2 s for all children to exit
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        loop {
            if std::time::Instant::now() >= deadline {
                break;
            }
            let all_done = self
                .terminals
                .values_mut()
                .all(|t| matches!(t.child.try_wait(), Ok(Some(_))));
            if all_done {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }

        // Phase 3: force-kill anything still running after the grace period
        for terminal in self.terminals.values_mut() {
            if !matches!(terminal.child.try_wait(), Ok(Some(_))) {
                let _ = terminal.child.kill();
            }
        }

        self.terminals.clear();
    }

    pub fn get_all_configs(&self) -> Vec<TerminalConfig> {
        self.terminals.values().map(|t| t.config.clone()).collect()
    }

    pub fn update_label(&mut self, id: &str, label: String) -> Result<(), String> {
        if let Some(terminal) = self.terminals.get_mut(id) {
            terminal.config.label = label;
            Ok(())
        } else {
            Err("Terminal not found".to_string())
        }
    }

    pub fn update_status(&mut self, id: &str, status: TerminalStatus) -> Result<(), String> {
        if let Some(terminal) = self.terminals.get_mut(id) {
            terminal.config.status = status;
            Ok(())
        } else {
            Err("Terminal not found".to_string())
        }
    }

    pub fn update_nickname(&mut self, id: &str, nickname: String) -> Result<(), String> {
        if let Some(terminal) = self.terminals.get_mut(id) {
            terminal.config.nickname = Some(nickname);
            Ok(())
        } else {
            Err("Terminal not found".to_string())
        }
    }

    pub fn update_pinned(&mut self, id: &str, pinned: bool) -> Result<(), String> {
        if let Some(terminal) = self.terminals.get_mut(id) {
            terminal.config.pinned = pinned;
            Ok(())
        } else {
            Err("Terminal not found".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use portable_pty::CommandBuilder;

    /// Happy-path test: `spawn_pty` must open a PTY, spawn a trivial command,
    /// and return valid handles without panicking.
    #[test]
    fn spawn_pty_happy_path() {
        let (tx, _rx) = mpsc::channel::<(String, Vec<u8>)>(16);

        #[cfg(target_os = "windows")]
        let cmd = {
            let mut c = CommandBuilder::new("cmd.exe");
            c.arg("/C");
            c.arg("exit");
            c
        };
        #[cfg(not(target_os = "windows"))]
        let cmd = {
            let mut c = CommandBuilder::new("/bin/sh");
            c.arg("-c");
            c.arg("true");
            c
        };

        let result = spawn_pty(cmd, "test-id".to_string(), tx, None);
        assert!(
            result.is_ok(),
            "spawn_pty should succeed: {:?}",
            result.err()
        );
    }

    /// Verify that `spawn_pty` with a log file path accepts the parameter
    /// and returns valid handles (file creation is async in the reader thread).
    #[test]
    fn spawn_pty_with_log_file_path() {
        let tmp = std::env::temp_dir().join("ct_spawn_pty_test.log");
        let log_path = tmp.to_str().unwrap().to_string();

        let (tx, _rx) = mpsc::channel::<(String, Vec<u8>)>(16);

        #[cfg(not(target_os = "windows"))]
        let cmd = {
            let mut c = CommandBuilder::new("/bin/sh");
            c.arg("-c");
            c.arg("echo hello");
            c
        };
        #[cfg(target_os = "windows")]
        let cmd = {
            let mut c = CommandBuilder::new("cmd.exe");
            c.arg("/C");
            c.arg("echo hello");
            c
        };

        let result = spawn_pty(cmd, "test-log-id".to_string(), tx, Some(log_path.clone()));
        assert!(
            result.is_ok(),
            "spawn_pty with log_file should succeed: {:?}",
            result.err()
        );

        // Brief pause to let the reader thread run, then clean up
        std::thread::sleep(std::time::Duration::from_millis(50));
        let _ = std::fs::remove_file(&tmp);
    }
}
