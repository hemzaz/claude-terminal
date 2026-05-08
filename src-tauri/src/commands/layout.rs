use crate::AppState;
use tauri::{command, State};

use super::shared::wrap_cmd;

#[command]
pub async fn save_layout_template(
    state: State<'_, AppState>,
    id: String,
    name: String,
    layout: String,
    terminal_configs: String,
) -> Result<(), String> {
    wrap_cmd("save_layout_template", async move {
        let db = state.db.lock().await;
        db.save_layout_template(&id, &name, &layout, &terminal_configs)
    })
    .await
}

#[command]
pub async fn list_layout_templates(
    state: State<'_, AppState>,
) -> Result<Vec<crate::database::LayoutTemplate>, String> {
    wrap_cmd("list_layout_templates", async move {
        let db = state.db.lock().await;
        db.list_layout_templates()
    })
    .await
}

#[command]
pub async fn load_layout_template(
    state: State<'_, AppState>,
    id: String,
) -> Result<crate::database::LayoutTemplate, String> {
    wrap_cmd("load_layout_template", async move {
        let db = state.db.lock().await;
        db.load_layout_template(&id)
    })
    .await
}

#[command]
pub async fn delete_layout_template(state: State<'_, AppState>, id: String) -> Result<(), String> {
    wrap_cmd("delete_layout_template", async move {
        let db = state.db.lock().await;
        db.delete_layout_template(&id)
    })
    .await
}
