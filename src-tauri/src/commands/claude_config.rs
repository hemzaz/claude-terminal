use serde::{Deserialize, Serialize};
use tauri::command;

use super::shared::wrap_cmd;

/// Returns the path to the user's ~/.claude directory
fn get_claude_dir() -> Result<std::path::PathBuf, String> {
    let home = if cfg!(target_os = "windows") {
        std::env::var("USERPROFILE").map_err(|_| "USERPROFILE not set".to_string())?
    } else {
        std::env::var("HOME").map_err(|_| "HOME not set".to_string())?
    };
    Ok(std::path::Path::new(&home).join(".claude"))
}

/// Validates that a filename is safe (no path traversal)
fn validate_filename(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Filename cannot be empty".to_string());
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") || name.contains('\0') {
        return Err("Invalid filename".to_string());
    }
    Ok(())
}

/// Maximum size for ~/.claude/settings.json — 1 MB is generous for a JSON config
/// and prevents a compromised renderer (or malformed file) from exhausting memory.
const MAX_CLAUDE_SETTINGS_BYTES: u64 = 1024 * 1024;

/// Validates that a path is under ~/.claude/
/// Rejects traversal components (`..`, `\0`) and resolves against the canonical
/// parent directory so not-yet-existing files still get a real containment check.
fn validate_claude_path(path: &str) -> Result<(), String> {
    let target = std::path::Path::new(path);

    // Reject path traversal and null-byte components explicitly. canonicalize()
    // collapses `..` but only when the full path exists, so we also need a
    // structural check for write paths that don't exist yet.
    if path.contains('\0') {
        return Err("Invalid path: null byte".to_string());
    }
    for comp in target.components() {
        if matches!(comp, std::path::Component::ParentDir) {
            return Err("Invalid path: parent directory traversal not allowed".to_string());
        }
    }

    let claude_dir = get_claude_dir()?;
    let canonical_claude = claude_dir
        .canonicalize()
        .unwrap_or_else(|_| claude_dir.clone());

    // If the target exists, canonicalize resolves symlinks — strongest check.
    // Otherwise fall back to canonicalizing the nearest existing ancestor and
    // re-appending the remaining components (prevents bypass when the file
    // is about to be created).
    let canonical_target = match target.canonicalize() {
        Ok(p) => p,
        Err(_) => {
            let mut ancestor = target.to_path_buf();
            let mut tail: Vec<std::ffi::OsString> = Vec::new();
            loop {
                if ancestor.exists() {
                    break;
                }
                match ancestor.file_name() {
                    Some(name) => tail.push(name.to_os_string()),
                    None => return Err("Invalid path: cannot resolve".to_string()),
                }
                if !ancestor.pop() {
                    return Err("Invalid path: cannot resolve".to_string());
                }
            }
            let mut resolved = ancestor
                .canonicalize()
                .map_err(|e| format!("Invalid path: {}", e))?;
            for name in tail.into_iter().rev() {
                resolved.push(name);
            }
            resolved
        }
    };

    if !canonical_target.starts_with(&canonical_claude) {
        return Err("Access denied: path is not under ~/.claude/".to_string());
    }
    Ok(())
}

#[command]
pub async fn read_claude_settings() -> Result<String, String> {
    wrap_cmd("read_claude_settings", async move {
        let settings_path = get_claude_dir()?.join("settings.json");
        if !settings_path.exists() {
            return Ok("{}".to_string());
        }
        let meta = std::fs::metadata(&settings_path)
            .map_err(|e| format!("Failed to stat settings.json: {}", e))?;
        if meta.len() > MAX_CLAUDE_SETTINGS_BYTES {
            return Err(format!(
                "settings.json is larger than allowed maximum ({} bytes)",
                MAX_CLAUDE_SETTINGS_BYTES
            ));
        }
        std::fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read settings.json: {}", e))
    })
    .await
}

#[command]
pub async fn write_claude_settings(content: String) -> Result<(), String> {
    wrap_cmd("write_claude_settings", async move {
        if content.len() as u64 > MAX_CLAUDE_SETTINGS_BYTES {
            return Err(format!(
                "settings content exceeds maximum size ({} bytes)",
                MAX_CLAUDE_SETTINGS_BYTES
            ));
        }
        // Validate it's valid JSON
        serde_json::from_str::<serde_json::Value>(&content)
            .map_err(|e| format!("Invalid JSON: {}", e))?;
        let claude_dir = get_claude_dir()?;
        std::fs::create_dir_all(&claude_dir).map_err(|e| e.to_string())?;
        std::fs::write(claude_dir.join("settings.json"), &content)
            .map_err(|e| format!("Failed to write settings.json: {}", e))
    })
    .await
}

#[command]
pub async fn list_claude_agents() -> Result<Vec<String>, String> {
    wrap_cmd("list_claude_agents", async move {
        let agents_dir = get_claude_dir()?.join("agents");
        if !agents_dir.exists() {
            return Ok(vec![]);
        }
        let entries = std::fs::read_dir(&agents_dir).map_err(|e| e.to_string())?;
        let mut names: Vec<String> = entries
            .flatten()
            .filter(|e| e.path().is_file())
            .filter_map(|e| e.file_name().to_str().map(String::from))
            .collect();
        names.sort();
        Ok(names)
    })
    .await
}

#[command]
pub async fn read_claude_agent(name: String) -> Result<String, String> {
    wrap_cmd("read_claude_agent", async move {
        validate_filename(&name)?;
        let path = get_claude_dir()?.join("agents").join(&name);
        if !path.exists() {
            return Err(format!("Agent file not found: {}", name));
        }
        std::fs::read_to_string(&path).map_err(|e| e.to_string())
    })
    .await
}

#[command]
pub async fn write_claude_agent(name: String, content: String) -> Result<(), String> {
    wrap_cmd("write_claude_agent", async move {
        validate_filename(&name)?;
        let agents_dir = get_claude_dir()?.join("agents");
        std::fs::create_dir_all(&agents_dir).map_err(|e| e.to_string())?;
        std::fs::write(agents_dir.join(&name), &content).map_err(|e| e.to_string())
    })
    .await
}

#[command]
pub async fn delete_claude_agent(name: String) -> Result<(), String> {
    wrap_cmd("delete_claude_agent", async move {
        validate_filename(&name)?;
        let path = get_claude_dir()?.join("agents").join(&name);
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
}

#[command]
pub async fn list_claude_commands() -> Result<Vec<String>, String> {
    wrap_cmd("list_claude_commands", async move {
        let commands_dir = get_claude_dir()?.join("commands");
        if !commands_dir.exists() {
            return Ok(vec![]);
        }
        let entries = std::fs::read_dir(&commands_dir).map_err(|e| e.to_string())?;
        let mut names: Vec<String> = entries
            .flatten()
            .filter(|e| e.path().is_file())
            .filter_map(|e| e.file_name().to_str().map(String::from))
            .collect();
        names.sort();
        Ok(names)
    })
    .await
}

#[command]
pub async fn read_claude_command(name: String) -> Result<String, String> {
    wrap_cmd("read_claude_command", async move {
        validate_filename(&name)?;
        let path = get_claude_dir()?.join("commands").join(&name);
        if !path.exists() {
            return Err(format!("Command file not found: {}", name));
        }
        std::fs::read_to_string(&path).map_err(|e| e.to_string())
    })
    .await
}

#[command]
pub async fn write_claude_command(name: String, content: String) -> Result<(), String> {
    wrap_cmd("write_claude_command", async move {
        validate_filename(&name)?;
        let commands_dir = get_claude_dir()?.join("commands");
        std::fs::create_dir_all(&commands_dir).map_err(|e| e.to_string())?;
        std::fs::write(commands_dir.join(&name), &content).map_err(|e| e.to_string())
    })
    .await
}

#[command]
pub async fn delete_claude_command(name: String) -> Result<(), String> {
    wrap_cmd("delete_claude_command", async move {
        validate_filename(&name)?;
        let path = get_claude_dir()?.join("commands").join(&name);
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryFileInfo {
    pub path: String,
    pub name: String,
    pub project: String,
    pub size: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeMdInfo {
    pub path: String,
    pub scope: String,
    pub project_name: Option<String>,
}

#[command]
pub async fn list_memory_files(
    project_path: Option<String>,
) -> Result<Vec<MemoryFileInfo>, String> {
    wrap_cmd("list_memory_files", async move {
        let claude_dir = get_claude_dir()?;
        let projects_dir = claude_dir.join("projects");

        if !projects_dir.exists() {
            return Ok(vec![]);
        }

        let mut files = Vec::new();

        let scan_project = |project_dir: &std::path::Path, files: &mut Vec<MemoryFileInfo>| {
            let memory_dir = project_dir.join("memory");
            if !memory_dir.exists() || !memory_dir.is_dir() {
                return;
            }
            let project_name = project_dir
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            if let Ok(entries) = std::fs::read_dir(&memory_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                        files.push(MemoryFileInfo {
                            path: path.to_string_lossy().to_string(),
                            name,
                            project: project_name.clone(),
                            size,
                        });
                    }
                }
            }
        };

        if let Some(ref specific_project) = project_path {
            // Scan only the specific project
            let target = std::path::Path::new(specific_project);
            if target.exists() && target.is_dir() {
                scan_project(target, &mut files);
            }
        } else {
            // Scan all projects
            if let Ok(entries) = std::fs::read_dir(&projects_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        scan_project(&path, &mut files);
                    }
                }
            }
        }

        Ok(files)
    })
    .await
}

#[command]
pub async fn read_memory_file(path: String) -> Result<String, String> {
    wrap_cmd("read_memory_file", async move {
        validate_claude_path(&path)?;
        std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read memory file: {}", e))
    })
    .await
}

#[command]
pub async fn write_memory_file(path: String, content: String) -> Result<(), String> {
    wrap_cmd("write_memory_file", async move {
        validate_claude_path(&path)?;
        // Ensure parent directory exists
        if let Some(parent) = std::path::Path::new(&path).parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&path, &content)
            .map_err(|e| format!("Failed to write memory file: {}", e))
    })
    .await
}

#[command]
pub async fn list_claude_md_files() -> Result<Vec<ClaudeMdInfo>, String> {
    wrap_cmd("list_claude_md_files", async move {
        let mut files = Vec::new();
        let claude_dir = get_claude_dir()?;

        // Global ~/.claude/CLAUDE.md
        let global_md = claude_dir.join("CLAUDE.md");
        if global_md.exists() {
            files.push(ClaudeMdInfo {
                path: global_md.to_string_lossy().to_string(),
                scope: "global".to_string(),
                project_name: None,
            });
        }

        // Project-level CLAUDE.md files in ~/.claude/projects/*/
        let projects_dir = claude_dir.join("projects");
        if projects_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&projects_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        let md_path = path.join("CLAUDE.md");
                        if md_path.exists() {
                            let project_name =
                                entry.file_name().to_string_lossy().to_string();
                            files.push(ClaudeMdInfo {
                                path: md_path.to_string_lossy().to_string(),
                                scope: "project".to_string(),
                                project_name: Some(project_name),
                            });
                        }
                    }
                }
            }
        }

        Ok(files)
    })
    .await
}
