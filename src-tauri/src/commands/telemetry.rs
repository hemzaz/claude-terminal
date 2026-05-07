use crate::AppState;
use tauri::{command, State};

use super::shared::wrap_cmd;

#[command]
pub async fn get_installation_id(state: State<'_, AppState>) -> Result<String, String> {
    wrap_cmd("get_installation_id", async move {
        let db = state.db.lock().await;
        db.get_or_create_installation_id()
    })
    .await
}

#[command]
pub async fn send_telemetry_heartbeat(
    state: State<'_, AppState>,
    enabled: bool,
    app_version: String,
) -> Result<(), String> {
    wrap_cmd("send_telemetry_heartbeat", async move {
        if !enabled {
            return Ok(());
        }
        let installation_id = {
            let db = state.db.lock().await;
            db.get_or_create_installation_id()?
        };
        tokio::spawn(crate::telemetry::send_heartbeat(installation_id, app_version));
        Ok(())
    })
    .await
}
