use crate::database::Snippet;
use crate::AppState;
use tauri::{command, State};

use super::shared::wrap_cmd;

#[command]
pub async fn save_snippet(
    state: State<'_, AppState>,
    snippet: Snippet,
) -> Result<(), String> {
    wrap_cmd("save_snippet", async move {
        let db = state.db.lock().await;
        db.save_snippet(&snippet)
    })
    .await
}

#[command]
pub async fn get_snippets(state: State<'_, AppState>) -> Result<Vec<Snippet>, String> {
    wrap_cmd("get_snippets", async move {
        let db = state.db.lock().await;
        db.get_snippets()
    })
    .await
}

#[command]
pub async fn delete_snippet(state: State<'_, AppState>, id: String) -> Result<(), String> {
    wrap_cmd("delete_snippet", async move {
        let db = state.db.lock().await;
        db.delete_snippet(&id)
    })
    .await
}
