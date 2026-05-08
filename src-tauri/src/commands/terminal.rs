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
        let terminals = state.terminals.lock().await;
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
pub async fn set_terminal_pinned(
    state: State<'_, AppState>,
    id: String,
    pinned: bool,
) -> Result<(), String> {
    wrap_cmd("set_terminal_pinned", async move {
        // Acquire the lock once: mutate and read in the same scope, then drop
        // before awaiting the DB call.  Re-acquiring between update_pinned and
        // get_all_configs was a race window — another command could mutate the
        // manager in between, producing a persisted snapshot that did not
        // reflect the pin change just made (Issue #70).
        let configs = {
            let mut terminals = state.terminals.lock().await;
            terminals.update_pinned(&id, pinned)?;
            terminals.get_all_configs()
        };
        // Persist immediately so pinned state survives restart
        let db = state.db.lock().await;
        db.save_last_session(&configs)
    })
    .await
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use tokio::sync::Mutex;

    use portable_pty::{native_pty_system, CommandBuilder, PtySize};

    /// Construct a minimal [`crate::terminal::Terminal`] backed by a real PTY pair
    /// and a short-lived no-op process, then insert it into the manager.
    fn insert_test_terminal(mgr: &mut crate::terminal::TerminalManager, id: &str) {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty failed");

        #[cfg(target_os = "windows")]
        let cmd = {
            let mut c = CommandBuilder::new("cmd");
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

        let child = pair.slave.spawn_command(cmd).expect("spawn_command failed");
        let writer = pair.master.take_writer().expect("take_writer failed");

        let config = crate::terminal::TerminalConfig {
            id: id.to_string(),
            label: "test-label".to_string(),
            nickname: None,
            profile_id: None,
            working_directory: ".".to_string(),
            claude_args: vec![],
            env_vars: std::collections::HashMap::new(),
            created_at: chrono::Utc::now(),
            status: crate::terminal::TerminalStatus::Running,
            color_tag: None,
            pinned: false,
        };

        mgr.terminals.insert(
            id.to_string(),
            crate::terminal::Terminal {
                config,
                pty_pair: pair,
                writer: Arc::new(std::sync::Mutex::new(writer)),
                reader_handle: None,
                child,
            },
        );
    }

    /// Regression test for Issue #70: `update_pinned` and `get_all_configs` must
    /// be atomic within a single lock scope.  Two concurrent tasks race on the
    /// same `Arc<Mutex<TerminalManager>>`; each asserts that the config snapshot
    /// it reads inside the lock always reflects the mutation it just made.
    #[tokio::test]
    async fn update_pinned_and_get_configs_are_atomic() {
        let mgr = Arc::new(Mutex::new(crate::terminal::TerminalManager::new()));

        {
            let mut m = mgr.lock().await;
            insert_test_terminal(&mut m, "t1");
            insert_test_terminal(&mut m, "t2");
        }

        let mgr1 = Arc::clone(&mgr);
        let mgr2 = Arc::clone(&mgr);

        // Task 1: pin t1, then read configs — must see t1 pinned.
        let task1 = tokio::spawn(async move {
            for _ in 0..20 {
                let configs = {
                    let mut m = mgr1.lock().await;
                    m.update_pinned("t1", true).expect("update_pinned t1");
                    m.get_all_configs()
                };
                let t1 = configs.iter().find(|c| c.id == "t1").expect("t1 not found");
                assert!(t1.pinned, "t1 must be pinned within the same lock scope");
            }
        });

        // Task 2: unpin t2, then read configs — must see t2 unpinned.
        let task2 = tokio::spawn(async move {
            for _ in 0..20 {
                let configs = {
                    let mut m = mgr2.lock().await;
                    m.update_pinned("t2", false).expect("update_pinned t2");
                    m.get_all_configs()
                };
                let t2 = configs.iter().find(|c| c.id == "t2").expect("t2 not found");
                assert!(!t2.pinned, "t2 must be unpinned within the same lock scope");
            }
        });

        task1.await.unwrap();
        task2.await.unwrap();
    }
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
