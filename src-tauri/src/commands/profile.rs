use crate::config::ConfigProfile;
use crate::AppState;
use tauri::{command, State};

use super::shared::wrap_cmd;

#[command]
pub async fn save_profile(
    state: State<'_, AppState>,
    profile: ConfigProfile,
) -> Result<(), String> {
    wrap_cmd("save_profile", async move {
        let db = state.db.lock().await;
        db.save_profile(&profile)
    })
    .await
}

#[command]
pub async fn get_profiles(state: State<'_, AppState>) -> Result<Vec<ConfigProfile>, String> {
    wrap_cmd("get_profiles", async move {
        let db = state.db.lock().await;
        db.get_profiles()
    })
    .await
}

#[command]
pub async fn delete_profile(state: State<'_, AppState>, id: String) -> Result<(), String> {
    wrap_cmd("delete_profile", async move {
        let db = state.db.lock().await;
        db.delete_profile(&id)
    })
    .await
}

#[command]
pub async fn update_profile_last_used(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    wrap_cmd("update_profile_last_used", async move {
        let timestamp = chrono::Utc::now().to_rfc3339();
        let db = state.db.lock().await;
        db.update_profile_last_used(&id, &timestamp)
    })
    .await
}
