use crate::error_reporter::{self, ErrorSource};
use tauri::command;

#[derive(serde::Deserialize)]
pub struct FrontendErrorPayload {
    pub kind: Option<String>,
    pub message: String,
    pub stack: Option<String>,
}

#[command]
pub async fn report_error(payload: FrontendErrorPayload) -> Result<(), String> {
    error_reporter::report(
        ErrorSource::Frontend,
        payload.kind,
        payload.message,
        payload.stack,
    )
    .await;
    Ok(())
}

#[command]
pub fn set_error_reporting_enabled(enabled: bool) -> Result<(), String> {
    error_reporter::set_enabled(enabled);
    Ok(())
}
