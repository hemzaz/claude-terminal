use crate::AppState;
use tauri::{command, State};

use super::shared::wrap_cmd;

#[command]
pub async fn get_workspaces(
    state: State<'_, AppState>,
) -> Result<Vec<crate::database::WorkspaceInfo>, String> {
    wrap_cmd("get_workspaces", async move {
        let db = state.db.lock().await;
        db.get_workspaces()
    })
    .await
}

#[command]
pub async fn delete_workspace(state: State<'_, AppState>, name: String) -> Result<(), String> {
    wrap_cmd("delete_workspace", async move {
        let db = state.db.lock().await;
        db.delete_workspace(&name)
    })
    .await
}

#[command]
pub async fn save_workspace(
    state: State<'_, AppState>,
    name: String,
    terminals: Vec<crate::terminal::TerminalConfig>,
) -> Result<(), String> {
    wrap_cmd("save_workspace", async move {
        let db = state.db.lock().await;
        db.save_workspace(&name, &terminals)
    })
    .await
}

#[command]
pub async fn load_workspace(
    state: State<'_, AppState>,
    name: String,
) -> Result<Vec<crate::terminal::TerminalConfig>, String> {
    wrap_cmd("load_workspace", async move {
        let db = state.db.lock().await;
        db.load_workspace(&name)
    })
    .await
}

#[command]
pub async fn save_session_for_restore(state: State<'_, AppState>) -> Result<(), String> {
    wrap_cmd("save_session_for_restore", async move {
        let configs = {
            let terminals = state.terminals.lock().await;
            terminals.get_all_configs()
        };
        let db = state.db.lock().await;
        db.save_last_session(&configs)
    })
    .await
}

#[command]
pub async fn get_last_session(
    state: State<'_, AppState>,
) -> Result<Option<Vec<crate::terminal::TerminalConfig>>, String> {
    wrap_cmd("get_last_session", async move {
        let db = state.db.lock().await;
        db.load_last_session()
    })
    .await
}

#[command]
pub async fn clear_last_session(state: State<'_, AppState>) -> Result<(), String> {
    wrap_cmd("clear_last_session", async move {
        let db = state.db.lock().await;
        db.clear_last_session()
    })
    .await
}
