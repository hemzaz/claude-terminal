use crate::database::SessionHistoryEntry;
use crate::AppState;
use tauri::{command, State};

use super::shared::{shell_command, wrap_cmd};

#[command]
pub async fn get_session_history(
    state: State<'_, AppState>,
) -> Result<Vec<SessionHistoryEntry>, String> {
    wrap_cmd("get_session_history", async move {
        let db = state.db.lock().await;
        db.get_session_history()
    })
    .await
}

#[command]
pub async fn read_log_file(path: String) -> Result<String, String> {
    wrap_cmd("read_log_file", async move {
        // Validate path is under the logs directory
        let data_dir = directories::ProjectDirs::from("com", "claudeterminal", "ClaudeTerminal")
            .ok_or("Failed to get project directories")?
            .data_dir()
            .to_path_buf();
        let logs_dir = data_dir.join("logs");
        let canonical_path = std::path::Path::new(&path)
            .canonicalize()
            .map_err(|e| format!("Invalid path: {}", e))?;
        std::fs::create_dir_all(&logs_dir)
            .map_err(|e| format!("Failed to create logs directory: {}", e))?;
        let canonical_logs = logs_dir
            .canonicalize()
            .map_err(|e| format!("Failed to resolve logs directory: {}", e))?;
        if !canonical_path.starts_with(&canonical_logs) {
            return Err("Access denied: path is not under logs directory".to_string());
        }
        // Cap at 2 MB — prevents DoS via huge/symlinked logs and matches
        // what the UI can reasonably render in a single read.
        const MAX_LOG_BYTES: usize = 2 * 1024 * 1024;
        let bytes = std::fs::read(&canonical_path)
            .map_err(|e| format!("Failed to read log file: {}", e))?;
        let slice = if bytes.len() > MAX_LOG_BYTES {
            &bytes[bytes.len() - MAX_LOG_BYTES..]
        } else {
            &bytes[..]
        };
        Ok(String::from_utf8_lossy(slice).into_owned())
    })
    .await
}

#[command]
pub async fn delete_session_history(
    state: State<'_, AppState>,
    id: i64,
    log_path: Option<String>,
) -> Result<(), String> {
    wrap_cmd("delete_session_history", async move {
        // Delete log file if it exists, but only if it's under the logs directory
        if let Some(ref path) = log_path {
            let data_dir = directories::ProjectDirs::from("com", "claudeterminal", "ClaudeTerminal")
                .ok_or("Failed to get project directories")?
                .data_dir()
                .to_path_buf();
            let logs_dir = data_dir.join("logs");
            let _ = std::fs::create_dir_all(&logs_dir);
            if let Ok(canonical_path) = std::path::Path::new(path).canonicalize() {
                if let Ok(canonical_logs) = logs_dir.canonicalize() {
                    if canonical_path.starts_with(&canonical_logs) {
                        let _ = std::fs::remove_file(&canonical_path);
                    }
                }
            }
        }
        let db = state.db.lock().await;
        db.delete_session_history_entry(id)
    })
    .await
}

/// Retrieve the log content for a terminal from a previous session.
/// Looks up the most recent session_history entry for the given terminal_id,
/// reads the log file, and returns its content (capped at 512 KB).
#[command]
pub async fn get_session_log(
    state: State<'_, AppState>,
    terminal_id: String,
) -> Result<Option<String>, String> {
    wrap_cmd("get_session_log", async move {
        let log_path = {
            let db = state.db.lock().await;
            db.get_log_path_for_terminal(&terminal_id)?
        };

        let path = match log_path {
            Some(p) => p,
            None => return Ok(None),
        };

        // Validate path is under the logs directory
        let data_dir = directories::ProjectDirs::from("com", "claudeterminal", "ClaudeTerminal")
            .ok_or("Failed to get project directories")?
            .data_dir()
            .to_path_buf();
        let logs_dir = data_dir.join("logs");
        std::fs::create_dir_all(&logs_dir)
            .map_err(|e| format!("Failed to create logs directory: {}", e))?;

        let canonical_path = match std::path::Path::new(&path).canonicalize() {
            Ok(p) => p,
            Err(_) => return Ok(None), // Log file may have been deleted
        };
        let canonical_logs = logs_dir
            .canonicalize()
            .map_err(|e| format!("Failed to resolve logs directory: {}", e))?;
        if !canonical_path.starts_with(&canonical_logs) {
            return Ok(None);
        }

        // Read up to 512 KB
        match std::fs::read(&canonical_path) {
            Ok(bytes) => {
                let max_bytes = 512 * 1024;
                let truncated = if bytes.len() > max_bytes {
                    &bytes[bytes.len() - max_bytes..]
                } else {
                    &bytes
                };
                Ok(Some(String::from_utf8_lossy(truncated).into_owned()))
            }
            Err(_) => Ok(None),
        }
    })
    .await
}

#[command]
pub async fn summarize_session(log_path: String) -> Result<Option<String>, String> {
    wrap_cmd("summarize_session", async move {
        // Validate path is under the logs directory
        let data_dir = directories::ProjectDirs::from("com", "claudeterminal", "ClaudeTerminal")
            .ok_or("Failed to get project directories")?
            .data_dir()
            .to_path_buf();
        let logs_dir = data_dir.join("logs");
        std::fs::create_dir_all(&logs_dir)
            .map_err(|e| format!("Failed to create logs directory: {}", e))?;

        let canonical_path = match std::path::Path::new(&log_path).canonicalize() {
            Ok(p) => p,
            Err(_) => return Ok(None),
        };
        let canonical_logs = logs_dir
            .canonicalize()
            .map_err(|e| format!("Failed to resolve logs directory: {}", e))?;
        if !canonical_path.starts_with(&canonical_logs) {
            return Err("Access denied: path is not under logs directory".to_string());
        }

        // Read log file content (capped at 100KB)
        let bytes = match std::fs::read(&canonical_path) {
            Ok(b) => b,
            Err(_) => return Ok(None),
        };
        let max_bytes = 100 * 1024;
        let truncated = if bytes.len() > max_bytes {
            &bytes[bytes.len() - max_bytes..]
        } else {
            &bytes
        };
        let log_content = String::from_utf8_lossy(truncated);

        // Strip ANSI escape sequences
        let ansi_re =
            regex::Regex::new(r"\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b\[.*?[A-Za-z]")
                .unwrap();
        let clean_content = ansi_re.replace_all(&log_content, "").to_string();

        if clean_content.trim().is_empty() {
            return Ok(None);
        }

        // Run claude -p to summarize
        let mut cmd = shell_command(
            "claude",
            &[
                "-p",
                "--model",
                "haiku",
                "Summarize what was accomplished in this terminal session in 2-3 bullet points. Be concise.",
            ],
        );
        cmd.stdin(std::process::Stdio::piped());
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(_) => return Ok(None), // Claude Code not available
        };

        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            let _ = stdin.write_all(clean_content.as_bytes());
        }

        let output = match child.wait_with_output() {
            Ok(o) => o,
            Err(_) => return Ok(None),
        };

        if !output.status.success() {
            return Ok(None);
        }

        let summary = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if summary.is_empty() {
            return Ok(None);
        }

        Ok(Some(summary))
    })
    .await
}

#[command]
pub async fn save_session_summary(
    state: State<'_, AppState>,
    terminal_id: String,
    summary: String,
) -> Result<(), String> {
    wrap_cmd("save_session_summary", async move {
        let db = state.db.lock().await;
        db.save_session_summary(&terminal_id, &summary)
    })
    .await
}

#[command]
pub async fn get_session_summary(
    state: State<'_, AppState>,
    terminal_id: String,
) -> Result<Option<String>, String> {
    wrap_cmd("get_session_summary", async move {
        let db = state.db.lock().await;
        db.get_session_summary(&terminal_id)
    })
    .await
}
