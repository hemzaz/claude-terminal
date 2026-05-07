use crate::AppState;
use crate::error_reporter::{self, ErrorSource};
use std::future::Future;
use tauri::State;

/// Wrap a Tauri command body so any `Err(String)` it returns is also reported
/// to the error_reporter (fire-and-forget). The command's behavior is unchanged.
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
