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

// ── Session export ─────────────────────────────────────────────────────────────

/// Scrub sensitive data from terminal output before export:
/// - Home-directory paths (platform-aware via $HOME / $USERPROFILE)
/// - Common secret token patterns (sk-*, ghp_*, pat_*, AKIA*, JWT)
fn redact(text: &str) -> String {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();
    let mut out = if home.is_empty() {
        text.to_string()
    } else {
        text.replace(&home, "~")
    };

    let token_re = regex::Regex::new(
        r"(?x)
          sk-[A-Za-z0-9\-_]{20,}
        | ghp_[A-Za-z0-9]{36,}
        | github_pat_[A-Za-z0-9_]{82,}
        | pat_[A-Za-z0-9]{20,}
        | AKIA[A-Z0-9]{16}
        | eyJ[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_.+/=]{20,}
        ",
    )
    .unwrap();
    out = token_re.replace_all(&out, "[REDACTED]").into_owned();
    out
}

fn strip_ansi_for_export(text: &str) -> String {
    let re = regex::Regex::new(
        r"\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b\[.*?[A-Za-z]",
    )
    .unwrap();
    re.replace_all(text, "").into_owned()
}

fn read_and_clean_log(log_path: &str) -> Result<String, String> {
    let data_dir = directories::ProjectDirs::from("com", "claudeterminal", "ClaudeTerminal")
        .ok_or("Failed to get project directories")?
        .data_dir()
        .to_path_buf();
    let logs_dir = data_dir.join("logs");
    let _ = std::fs::create_dir_all(&logs_dir);
    let canonical_logs = logs_dir
        .canonicalize()
        .map_err(|e| format!("Failed to resolve logs dir: {e}"))?;
    let canonical_path = std::path::Path::new(log_path)
        .canonicalize()
        .map_err(|e| format!("Invalid log path: {e}"))?;
    if !canonical_path.starts_with(&canonical_logs) {
        return Err("Access denied: path is not under logs directory".into());
    }
    const MAX_BYTES: usize = 2 * 1024 * 1024;
    let bytes = std::fs::read(&canonical_path)
        .map_err(|e| format!("Failed to read log: {e}"))?;
    let slice = if bytes.len() > MAX_BYTES {
        &bytes[bytes.len() - MAX_BYTES..]
    } else {
        &bytes
    };
    let raw = String::from_utf8_lossy(slice);
    Ok(redact(&strip_ansi_for_export(&raw)))
}

/// Export a session to the requested format.
///
/// `format`:
/// - `"markdown"` — Markdown with a code fence (caller copies to clipboard or saves)
/// - `"html"`     — Standalone single-file HTML
/// - `"gist"`     — Runs `gh gist create`, returns the resulting Gist URL
/// - `"text"`     — Plain redacted text (caller copies to clipboard)
#[command]
pub async fn export_session(
    log_path: String,
    label: String,
    started_at: String,
    format: String,
) -> Result<String, String> {
    wrap_cmd("export_session", async move {
        let clean = read_and_clean_log(&log_path)?;

        match format.as_str() {
            "markdown" => Ok(format!(
                "# Session: {label}\n**Date:** {started_at}\n\n```\n{clean}\n```\n"
            )),

            "html" => {
                let escaped = clean
                    .replace('&', "&amp;")
                    .replace('<', "&lt;")
                    .replace('>', "&gt;");
                Ok(format!(
                    r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>{label}</title>
<style>
  body{{font-family:system-ui,sans-serif;background:#0d1117;color:#c9d1d9;margin:0;padding:2rem}}
  h1{{font-size:1.25rem;color:#e6edf3;margin-bottom:.25rem}}
  .meta{{font-size:.8rem;color:#6e7681;margin-bottom:1.5rem}}
  pre{{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:1rem;
       font-size:.78rem;line-height:1.5;overflow-x:auto;white-space:pre-wrap;word-break:break-all}}
</style>
</head>
<body>
<h1>{label}</h1>
<p class="meta">Exported from ClaudeTerminal &mdash; {started_at}</p>
<pre>{escaped}</pre>
</body>
</html>"#
                ))
            }

            "gist" => {
                let tmp_dir = std::env::temp_dir();
                let safe_label: String = label
                    .chars()
                    .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
                    .take(60)
                    .collect();
                let filename = format!("{safe_label}.md");
                let tmp_path = tmp_dir.join(&filename);
                let md =
                    format!("# Session: {label}\nDate: {started_at}\n\n```\n{clean}\n```\n");
                std::fs::write(&tmp_path, &md)
                    .map_err(|e| format!("Failed to write temp file: {e}"))?;

                let output = shell_command(
                    "gh",
                    &[
                        "gist",
                        "create",
                        "--public",
                        "--filename",
                        &filename,
                        tmp_path.to_str().unwrap_or(""),
                    ],
                )
                .output()
                .map_err(|e| format!("Failed to run gh: {e}"))?;

                let _ = std::fs::remove_file(&tmp_path);

                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    return Err(format!("gh gist create failed: {stderr}"));
                }
                Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
            }

            // "text" or anything else — plain redacted text
            _ => Ok(clean),
        }
    })
    .await
}

#[derive(serde::Serialize)]
pub struct SessionSearchResult {
    pub session_id: i64,
    pub terminal_id: String,
    pub label: String,
    pub snippet: String,
    pub line_no: usize,
    pub timestamp: String,
}

/// Search across all session history — labels and log file contents.
/// Returns up to 100 results, capped at 200 KB per log file.
#[command]
pub async fn search_session_history(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<SessionSearchResult>, String> {
    wrap_cmd("search_session_history", async move {
        let trimmed = query.trim().to_string();
        if trimmed.is_empty() {
            return Ok(vec![]);
        }
        let query_lower = trimmed.to_lowercase();

        let entries = {
            let db = state.db.lock().await;
            db.get_session_history()?
        };

        let ansi_re = regex::Regex::new(
            r"\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b\[.*?[A-Za-z]",
        )
        .unwrap();

        let data_dir = directories::ProjectDirs::from("com", "claudeterminal", "ClaudeTerminal")
            .ok_or("Failed to get project directories")?
            .data_dir()
            .to_path_buf();
        let logs_dir = data_dir.join("logs");
        let _ = std::fs::create_dir_all(&logs_dir);
        let canonical_logs = logs_dir.canonicalize().ok();

        let mut results: Vec<SessionSearchResult> = Vec::new();

        'outer: for entry in &entries {
            let timestamp = entry
                .ended_at
                .as_deref()
                .unwrap_or(&entry.started_at)
                .to_string();

            // Match on label
            if entry.label.to_lowercase().contains(&query_lower) {
                results.push(SessionSearchResult {
                    session_id: entry.id,
                    terminal_id: entry.terminal_id.clone(),
                    label: entry.label.clone(),
                    snippet: entry.label.clone(),
                    line_no: 0,
                    timestamp: timestamp.clone(),
                });
                if results.len() >= 100 {
                    break;
                }
            }

            // Match inside log file
            if let Some(ref log_path) = entry.log_path {
                if let Some(ref canonical_logs) = canonical_logs {
                    if let Ok(canonical_path) =
                        std::path::Path::new(log_path).canonicalize()
                    {
                        if canonical_path.starts_with(canonical_logs) {
                            if let Ok(bytes) = std::fs::read(&canonical_path) {
                                const MAX_BYTES: usize = 200 * 1024;
                                let slice = if bytes.len() > MAX_BYTES {
                                    &bytes[bytes.len() - MAX_BYTES..]
                                } else {
                                    &bytes
                                };
                                let content = String::from_utf8_lossy(slice);
                                let clean = ansi_re.replace_all(&content, "");
                                for (line_idx, line) in clean.lines().enumerate() {
                                    if line.to_lowercase().contains(&query_lower) {
                                        let snippet: String =
                                            line.trim().chars().take(120).collect();
                                        results.push(SessionSearchResult {
                                            session_id: entry.id,
                                            terminal_id: entry.terminal_id.clone(),
                                            label: entry.label.clone(),
                                            snippet,
                                            line_no: line_idx + 1,
                                            timestamp: timestamp.clone(),
                                        });
                                        if results.len() >= 100 {
                                            break 'outer;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(results)
    })
    .await
}
