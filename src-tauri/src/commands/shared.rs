use crate::AppState;
use crate::error_reporter::{self, ErrorSource};
use std::future::Future;
use std::path::PathBuf;
use tauri::State;

/// Wrap a Tauri command body so any `Err(String)` it returns is also reported
/// to the error_reporter (fire-and-forget). The command's behavior is unchanged.
///
/// # Rename note (Issue #72)
/// This function should be renamed to `with_error_reporting` — the current name
/// reveals nothing about the error-reporting behaviour. Deferred until the sibling
/// command modules (git, session, terminal, …) can be updated in the same PR so
/// the rename is atomic.
pub async fn wrap_cmd<T, F>(name: &'static str, fut: F) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    match fut.await {
        Ok(v) => Ok(v),
        Err(e) => {
            tokio::spawn(error_reporter::report(
                ErrorSource::RustCommand,
                Some(name.to_string()),
                e.clone(),
                None,
            ));
            Err(e)
        }
    }
}

/// Shells that are allowed when reading `$SHELL` on non-Windows platforms.
pub const VALID_SHELLS: &[&str] = &[
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

/// Shell-escape a single argument by wrapping it in single quotes.
/// Any embedded single quotes are escaped as `'\''`.
pub fn shell_escape_arg(arg: &str) -> String {
    let mut escaped = String::with_capacity(arg.len() + 2);
    escaped.push('\'');
    for ch in arg.chars() {
        if ch == '\'' {
            escaped.push_str("'\\''");
        } else {
            escaped.push(ch);
        }
    }
    escaped.push('\'');
    escaped
}

/// Creates a Command that works cross-platform.
/// On Windows, wraps the command with `cmd /C` so that `.cmd`/`.bat` scripts
/// (like `npm.cmd`, `claude.cmd`) are resolved correctly.
pub fn shell_command(program: &str, args: &[&str]) -> std::process::Command {
    if cfg!(target_os = "windows") {
        let mut cmd = std::process::Command::new("cmd");
        cmd.arg("/C").arg(program);
        for arg in args {
            cmd.arg(arg);
        }
        // Prevent a console window from flashing on Windows
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        cmd
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        // Validate $SHELL against allowlist to prevent arbitrary binary execution
        let shell = if VALID_SHELLS.contains(&shell.as_str()) {
            shell
        } else {
            "/bin/bash".to_string()
        };
        let mut full_cmd = shell_escape_arg(program);
        for arg in args {
            full_cmd.push(' ');
            full_cmd.push_str(&shell_escape_arg(arg));
        }
        let mut cmd = std::process::Command::new(shell);
        cmd.arg("-lc").arg(&full_cmd);
        cmd
    }
}

/// Validate that a path belongs to (or is under) an active terminal's working directory.
/// Prevents arbitrary filesystem access via git commands.
pub async fn validate_path_is_trusted(
    state: &State<'_, AppState>,
    path: &str,
) -> Result<(), String> {
    let canonical_path = std::path::Path::new(path)
        .canonicalize()
        .map_err(|e| format!("Invalid path '{}': {}", path, e))?;

    let terminals = state.terminals.lock().await;
    let known_dirs = terminals.get_all_configs();

    let is_trusted = known_dirs.iter().any(|config| {
        if config.working_directory.is_empty() {
            return false;
        }
        std::path::Path::new(&config.working_directory)
            .canonicalize()
            .ok()
            .map(|known| canonical_path.starts_with(&known))
            .unwrap_or(false)
    });

    if !is_trusted {
        return Err(format!(
            "Path '{}' is not under any active terminal's working directory",
            canonical_path.display()
        ));
    }
    Ok(())
}

// ── Log-directory helpers ────────────────────────────────────────────────────

/// Return the path to the app's log directory, creating it if it does not exist.
///
/// This is the single source of truth for the log-directory location.
/// All commands that need to generate a new log-file path should call this
/// instead of re-deriving the path from `ProjectDirs` inline.
pub fn app_logs_dir() -> Result<PathBuf, String> {
    let data_dir = directories::ProjectDirs::from("com", "claudeterminal", "ClaudeTerminal")
        .ok_or("Failed to get project directories")?
        .data_dir()
        .to_path_buf();
    let logs_dir = data_dir.join("logs");
    std::fs::create_dir_all(&logs_dir)
        .map_err(|e| format!("Failed to create logs directory: {}", e))?;
    Ok(logs_dir)
}

/// Return the **canonical** path to the app's log directory.
///
/// Use this when you need an `Option<PathBuf>` to guard multiple path checks
/// in a loop (e.g. `search_session_history`, `collect_cost_stats`).
pub fn canonical_logs_dir() -> Result<PathBuf, String> {
    let logs_dir = app_logs_dir()?;
    logs_dir
        .canonicalize()
        .map_err(|e| format!("Failed to resolve logs directory: {}", e))
}

/// Validate that `path` points to an existing file **inside** the app's log
/// directory, and return its canonical path.
///
/// Returns `Err` if:
/// - the app data directory cannot be located
/// - `path` does not exist or cannot be canonicalized (e.g. deleted log)
/// - `path` resolves to a location outside the logs directory (path-traversal)
///
/// This is the canonical replacement for the six duplicated validation
/// blocks that previously appeared in `session.rs` (Issue #64).
pub fn canonical_in_logs(path: &str) -> Result<PathBuf, String> {
    let canonical_logs = canonical_logs_dir()?;
    let canonical_path = std::path::Path::new(path)
        .canonicalize()
        .map_err(|e| format!("Invalid log path '{}': {}", path, e))?;
    if !canonical_path.starts_with(&canonical_logs) {
        return Err(format!(
            "Access denied: '{}' is not under the logs directory",
            canonical_path.display()
        ));
    }
    Ok(canonical_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn app_logs_dir_creates_directory() {
        let result = app_logs_dir();
        assert!(result.is_ok(), "app_logs_dir should succeed: {:?}", result);
        let dir = result.unwrap();
        assert!(dir.exists(), "logs directory must exist after app_logs_dir()");
        assert!(dir.is_dir(), "logs path must be a directory");
    }

    #[test]
    fn canonical_in_logs_accepts_file_inside_real_logs_dir() {
        // Create a real file inside the app logs directory and validate it.
        let logs_dir = app_logs_dir().expect("app_logs_dir");
        let test_file = logs_dir.join("__test_canonical_in_logs__.log");
        fs::write(&test_file, b"test").expect("write test file");

        let result = canonical_in_logs(test_file.to_str().unwrap());
        let _ = fs::remove_file(&test_file); // clean up regardless
        assert!(result.is_ok(), "file inside logs dir must be accepted: {:?}", result);
    }

    #[test]
    fn canonical_in_logs_rejects_nonexistent_path() {
        // canonicalize() fails for a path that doesn't exist — must get Err.
        let result = canonical_in_logs("/nonexistent/path/that/does/not/exist/__.log");
        assert!(result.is_err(), "nonexistent path must be rejected");
    }

    #[test]
    fn canonical_in_logs_rejects_path_outside_logs_dir() {
        // A real file that exists but is NOT inside the app logs directory.
        // /tmp itself is a well-known existing path on all supported platforms.
        let tmp = std::env::temp_dir();
        let outside = tmp.join("__ct_test_outside__.log");
        fs::write(&outside, b"x").expect("write outside file");

        let result = canonical_in_logs(outside.to_str().unwrap());
        let _ = fs::remove_file(&outside);

        // /tmp is never the logs directory, so this must be rejected.
        // (Unless the OS happens to put the app data dir inside /tmp, which
        // is not the case for any supported macOS/Windows install.)
        assert!(
            result.is_err(),
            "file outside logs dir must be rejected, got: {:?}",
            result
        );
    }
}
