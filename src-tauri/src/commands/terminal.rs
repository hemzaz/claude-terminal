use crate::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{command, AppHandle, Emitter, State};
use tokio::sync::mpsc;

use super::shared::{validate_path_is_trusted, wrap_cmd};

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateTerminalRequest {
    pub label: String,
    pub working_directory: String,
    pub claude_args: Vec<String>,
    pub env_vars: HashMap<String, String>,
    pub color_tag: Option<String>,
    pub nickname: Option<String>,
}

/// Maximum size for a single write to terminal (64 KB)
const MAX_TERMINAL_WRITE_SIZE: usize = 65_536;

#[command]
pub async fn create_terminal(
    app: AppHandle,
    state: State<'_, AppState>,
    request: CreateTerminalRequest,
) -> Result<crate::terminal::TerminalConfig, String> {
    wrap_cmd("create_terminal", async move {
        // Channel sized for burst output — Claude Code streaming can easily push
        // hundreds of chunks/sec per terminal. 100 caused backpressure into the
        // PTY reader thread under load.
        let (tx, mut rx) = mpsc::channel::<(String, Vec<u8>)>(1000);

        // Compute log file path
        let log_path = {
            let data_dir = directories::ProjectDirs::from("com", "claudeterminal", "ClaudeTerminal")
                .ok_or("Failed to get project directories")?
                .data_dir()
                .to_path_buf();
            let logs_dir = data_dir.join("logs");
            std::fs::create_dir_all(&logs_dir).map_err(|e| e.to_string())?;
            let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
            let filename = format!("{}_{}.log", uuid::Uuid::new_v4(), timestamp);
            logs_dir.join(filename).to_string_lossy().to_string()
        };

        let config = {
            let mut terminals = state.terminals.lock().await;
            terminals.create_terminal(
                request.label.clone(),
                request.working_directory,
                request.claude_args,
                request.env_vars,
                request.color_tag,
                request.nickname,
                tx,
                Some(log_path.clone()),
            )?
        };

        // Insert session history entry
        {
            let db = state.db.lock().await;
            if let Err(e) = db.insert_session_history(
                &config.id,
                &config.label,
                &config.created_at.to_rfc3339(),
                Some(&log_path),
            ) {
                eprintln!("Failed to insert session history: {}", e);
            }
        }

        let terminal_id = config.id.clone();
        let db_arc = state.db.clone();
        let terminals_arc = state.terminals.clone();

        let app_clone = app.clone();
        tokio::spawn(async move {
            while let Some((id, data)) = rx.recv().await {
                if let Err(e) = app_clone.emit("terminal-output", serde_json::json!({
                    "id": id,
                    "data": data,
                })) {
                    eprintln!("Failed to emit terminal-output: {}", e);
                    break;
                }
            }

            // Terminal process exited — update status, session history, and notify frontend
            // Note: the terminal may have already been removed by close_terminal(), so ignore errors
            {
                if let Ok(mut manager) = tokio::time::timeout(
                    std::time::Duration::from_secs(2),
                    terminals_arc.lock(),
                ).await {
                    let _ = manager.update_status(&terminal_id, crate::terminal::TerminalStatus::Stopped);
                }
            }
            {
                let db = db_arc.lock().await;
                if let Err(e) = db.update_session_ended(&terminal_id, &chrono::Utc::now().to_rfc3339()) {
                    eprintln!("Failed to update session ended for {}: {}", terminal_id, e);
                }
            }

            if let Err(e) = app_clone.emit("terminal-finished", serde_json::json!({
                "id": terminal_id,
            })) {
                eprintln!("Failed to emit terminal-finished: {}", e);
            }
        });

        Ok(config)
    })
    .await
}

#[command]
pub async fn write_to_terminal(
    state: State<'_, AppState>,
    id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    wrap_cmd("write_to_terminal", async move {
        if data.len() > MAX_TERMINAL_WRITE_SIZE {
            return Err(format!(
                "Write payload too large ({} bytes). Maximum is {} bytes.",
                data.len(),
                MAX_TERMINAL_WRITE_SIZE
            ));
        }
        let mut terminals = state.terminals.lock().await;
        terminals.write(&id, &data)
    })
    .await
}

#[command]
pub async fn resize_terminal(
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    wrap_cmd("resize_terminal", async move {
        let mut terminals = state.terminals.lock().await;
        terminals.resize(&id, cols, rows)
    })
    .await
}

#[command]
pub async fn close_terminal(state: State<'_, AppState>, id: String) -> Result<(), String> {
    wrap_cmd("close_terminal", async move {
        let mut terminals = state.terminals.lock().await;
        terminals.close(&id)
    })
    .await
}

#[command]
pub async fn get_terminals(
    state: State<'_, AppState>,
) -> Result<Vec<crate::terminal::TerminalConfig>, String> {
    wrap_cmd("get_terminals", async move {
        let terminals = state.terminals.lock().await;
        Ok(terminals.get_all_configs())
    })
    .await
}

#[command]
pub async fn update_terminal_label(
    state: State<'_, AppState>,
    id: String,
    label: String,
) -> Result<(), String> {
    wrap_cmd("update_terminal_label", async move {
        let mut terminals = state.terminals.lock().await;
        terminals.update_label(&id, label)
    })
    .await
}

#[command]
pub async fn update_terminal_nickname(
    state: State<'_, AppState>,
    id: String,
    nickname: String,
) -> Result<(), String> {
    wrap_cmd("update_terminal_nickname", async move {
        let mut terminals = state.terminals.lock().await;
        terminals.update_nickname(&id, nickname)
    })
    .await
}

#[command]
pub async fn create_script_terminal(
    app: AppHandle,
    state: State<'_, AppState>,
    cwd: String,
    script_name: String,
) -> Result<crate::terminal::TerminalConfig, String> {
    wrap_cmd("create_script_terminal", async move {
        validate_path_is_trusted(&state, &cwd).await?;

        let (tx, mut rx) = mpsc::channel::<(String, Vec<u8>)>(1000);

        let config = {
            let mut terminals = state.terminals.lock().await;
            terminals.create_script_terminal(
                format!("npm run {}", script_name),
                cwd,
                script_name,
                tx,
            )?
        };

        let terminal_id = config.id.clone();
        let terminals_arc = state.terminals.clone();
        let app_clone = app.clone();
        tokio::spawn(async move {
            while let Some((id, data)) = rx.recv().await {
                if let Err(e) = app_clone.emit("terminal-output", serde_json::json!({
                    "id": id,
                    "data": data,
                })) {
                    eprintln!("Failed to emit terminal-output: {}", e);
                    break;
                }
            }
            if let Ok(mut manager) = tokio::time::timeout(
                std::time::Duration::from_secs(2),
                terminals_arc.lock(),
            ).await {
                let _ = manager.update_status(&terminal_id, crate::terminal::TerminalStatus::Stopped);
            }
            if let Err(e) = app_clone.emit("terminal-finished", serde_json::json!({ "id": terminal_id })) {
                eprintln!("Failed to emit terminal-finished: {}", e);
            }
        });

        Ok(config)
    })
    .await
}

#[command]
pub async fn create_shell_terminal(
    app: AppHandle,
    state: State<'_, AppState>,
    label: String,
    cwd: String,
) -> Result<crate::terminal::TerminalConfig, String> {
    wrap_cmd("create_shell_terminal", async move {
        validate_path_is_trusted(&state, &cwd).await?;

        let (tx, mut rx) = mpsc::channel::<(String, Vec<u8>)>(1000);

        let config = {
            let mut terminals = state.terminals.lock().await;
            terminals.create_shell_terminal(label, cwd, tx)?
        };

        let terminal_id = config.id.clone();
        let terminals_arc = state.terminals.clone();
        let app_clone = app.clone();
        tokio::spawn(async move {
            while let Some((id, data)) = rx.recv().await {
                if let Err(e) = app_clone.emit("terminal-output", serde_json::json!({
                    "id": id,
                    "data": data,
                })) {
                    eprintln!("Failed to emit terminal-output: {}", e);
                    break;
                }
            }
            if let Ok(mut manager) = tokio::time::timeout(
                std::time::Duration::from_secs(2),
                terminals_arc.lock(),
            ).await {
                let _ = manager.update_status(&terminal_id, crate::terminal::TerminalStatus::Stopped);
            }
            if let Err(e) = app_clone.emit("terminal-finished", serde_json::json!({ "id": terminal_id })) {
                eprintln!("Failed to emit terminal-finished: {}", e);
            }
        });

        Ok(config)
    })
    .await
}
