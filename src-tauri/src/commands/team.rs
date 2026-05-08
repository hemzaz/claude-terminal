use serde::{Deserialize, Serialize};
use tauri::command;

use super::shared::wrap_cmd;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskInfo {
    pub id: String,
    pub subject: String,
    pub status: String,
    pub owner: Option<String>,
    pub blocked_by: Vec<String>,
    pub active_form: Option<String>,
}

#[command]
pub async fn get_team_tasks(team_name: String) -> Result<Vec<TaskInfo>, String> {
    wrap_cmd("get_team_tasks", async move {
        // Validate team_name doesn't contain path traversal
        if team_name.contains('/')
            || team_name.contains('\\')
            || team_name.contains("..")
            || team_name.contains('\0')
        {
            return Err("Invalid team name".to_string());
        }

        let home = if cfg!(target_os = "windows") {
            std::env::var("USERPROFILE").map_err(|_| "USERPROFILE not set".to_string())?
        } else {
            std::env::var("HOME").map_err(|_| "HOME not set".to_string())?
        };

        let tasks_dir = std::path::Path::new(&home)
            .join(".claude")
            .join("tasks")
            .join(&team_name);

        if !tasks_dir.exists() {
            return Ok(vec![]);
        }

        let entries = std::fs::read_dir(&tasks_dir).map_err(|e| e.to_string())?;
        let mut tasks = Vec::new();

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            // Skip .highwatermark and non-JSON files
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || !name.ends_with(".json") {
                continue;
            }

            let content = match std::fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let val: serde_json::Value = match serde_json::from_str(&content) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let id = val.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let subject = val
                .get("subject")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let status = val
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("pending")
                .to_string();
            let owner = val
                .get("owner")
                .and_then(|v| v.as_str())
                .map(String::from);
            let active_form = val
                .get("activeForm")
                .and_then(|v| v.as_str())
                .map(String::from);
            let blocked_by: Vec<String> = val
                .get("blockedBy")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();

            if !id.is_empty() {
                tasks.push(TaskInfo {
                    id,
                    subject,
                    status,
                    owner,
                    blocked_by,
                    active_form,
                });
            }
        }

        tasks.sort_by(|a, b| a.id.cmp(&b.id));

        Ok(tasks)
    })
    .await
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TeamMember {
    pub agent_id: String,
    pub name: String,
    pub agent_type: String,
    pub model: Option<String>,
    pub joined_at: Option<u64>,
    pub cwd: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TeamConfig {
    pub name: String,
    pub description: Option<String>,
    pub created_at: Option<u64>,
    pub lead_agent_id: Option<String>,
    pub members: Vec<TeamMember>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TeamInfo {
    pub dir_name: String,
    pub config: TeamConfig,
    pub task_count: Option<u32>,
}

#[command]
pub async fn get_active_teams() -> Result<Vec<TeamInfo>, String> {
    wrap_cmd("get_active_teams", async move {
        let home = if cfg!(target_os = "windows") {
            std::env::var("USERPROFILE").map_err(|_| "USERPROFILE not set".to_string())?
        } else {
            std::env::var("HOME").map_err(|_| "HOME not set".to_string())?
        };

        let teams_dir = std::path::Path::new(&home).join(".claude").join("teams");
        if !teams_dir.exists() {
            return Ok(vec![]);
        }

        let entries = std::fs::read_dir(&teams_dir).map_err(|e| e.to_string())?;
        let mut teams = Vec::new();

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let config_path = path.join("config.json");
            if !config_path.exists() {
                continue;
            }

            let config_str = match std::fs::read_to_string(&config_path) {
                Ok(s) => s,
                Err(_) => continue,
            };

            let config: TeamConfig = match serde_json::from_str(&config_str) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let dir_name = entry.file_name().to_string_lossy().to_string();

            // Read task count from .highwatermark
            let tasks_dir = std::path::Path::new(&home)
                .join(".claude")
                .join("tasks")
                .join(&dir_name);
            let hwm_path = tasks_dir.join(".highwatermark");
            let task_count = std::fs::read_to_string(&hwm_path)
                .ok()
                .and_then(|s| s.trim().parse::<u32>().ok());

            teams.push(TeamInfo {
                dir_name,
                config,
                task_count,
            });
        }

        Ok(teams)
    })
    .await
}
