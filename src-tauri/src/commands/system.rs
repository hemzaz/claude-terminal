use crate::config::HintCategory;
use serde::{Deserialize, Serialize};
use tauri::command;

use super::shared::{shell_command, wrap_cmd};

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SystemStatus {
    pub node_installed: bool,
    pub node_version: Option<String>,
    pub npm_installed: bool,
    pub npm_version: Option<String>,
    pub claude_installed: bool,
    pub claude_version: Option<String>,
}

#[command]
pub async fn get_claude_version() -> Result<String, String> {
    wrap_cmd("get_claude_version", async move {
        let output = shell_command("claude", &["--version"])
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }

        String::from_utf8(output.stdout)
            .map(|s| s.trim().to_string())
            .map_err(|e| e.to_string())
    })
    .await
}

#[command]
pub async fn check_claude_update() -> Result<UpdateCheckResult, String> {
    wrap_cmd("check_claude_update", async move {
        // Get current version
        let current_output = shell_command("claude", &["--version"])
            .output()
            .map_err(|e| format!("Failed to get current version: {}", e))?;

        let current_version = String::from_utf8_lossy(&current_output.stdout)
            .trim()
            .to_string();

        if current_version.is_empty() {
            return Err("Claude Code is not installed".to_string());
        }

        // Get latest version from npm
        let npm_output = shell_command("npm", &["view", "@anthropic-ai/claude-code", "version"])
            .output()
            .map_err(|e| format!("Failed to check latest version: {}", e))?;

        let latest_version = String::from_utf8_lossy(&npm_output.stdout)
            .trim()
            .to_string();

        if latest_version.is_empty() {
            return Err("Failed to fetch latest version from npm".to_string());
        }

        // Extract version number from current version string (e.g., "1.0.17 (Claude Code)" -> "1.0.17")
        let current_ver_clean = current_version
            .split_whitespace()
            .next()
            .unwrap_or(&current_version)
            .to_string();

        let update_available = current_ver_clean != latest_version;

        Ok(UpdateCheckResult {
            current_version,
            latest_version,
            update_available,
        })
    })
    .await
}

#[command]
pub async fn update_claude_code() -> Result<String, String> {
    wrap_cmd("update_claude_code", async move {
        let output = shell_command("npm", &["install", "-g", "@anthropic-ai/claude-code@latest"])
            .output()
            .map_err(|e| format!("Failed to run npm: {}", e))?;

        if output.status.success() {
            Ok("Claude Code updated successfully!".to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            Err(format!("{}{}", stderr, stdout))
        }
    })
    .await
}

#[command]
pub fn get_hints() -> Vec<HintCategory> {
    crate::config::get_default_hints()
}

#[command]
pub async fn check_system_requirements() -> Result<SystemStatus, String> {
    wrap_cmd("check_system_requirements", async move {
        // Check Node.js
        let node_result = shell_command("node", &["--version"]).output();

        let (node_installed, node_version) = match node_result {
            Ok(output) if output.status.success() => {
                let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
                (true, Some(version))
            }
            _ => (false, None),
        };

        // Check npm
        let npm_result = shell_command("npm", &["--version"]).output();

        let (npm_installed, npm_version) = match npm_result {
            Ok(output) if output.status.success() => {
                let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
                (true, Some(version))
            }
            _ => (false, None),
        };

        // Check Claude Code
        let claude_result = shell_command("claude", &["--version"]).output();

        let (claude_installed, claude_version) = match claude_result {
            Ok(output) if output.status.success() => {
                let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
                (true, Some(version))
            }
            _ => (false, None),
        };

        Ok(SystemStatus {
            node_installed,
            node_version,
            npm_installed,
            npm_version,
            claude_installed,
            claude_version,
        })
    })
    .await
}

#[command]
pub async fn install_claude_code() -> Result<String, String> {
    wrap_cmd("install_claude_code", async move {
        let output = shell_command("npm", &["install", "-g", "@anthropic-ai/claude-code"])
            .output()
            .map_err(|e| e.to_string())?;

        if output.status.success() {
            return Ok("Claude Code installed successfully!".to_string());
        }

        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        // On macOS (and Linux), a system-wide Node from nodejs.org installs npm
        // with a root-owned global prefix, so `npm i -g` hits EACCES. Surface a
        // clear remediation rather than dumping the raw npm error.
        if !cfg!(target_os = "windows")
            && (stderr.contains("EACCES") || stderr.contains("permission denied"))
        {
            return Err(
                "npm requires root access to install global packages with this Node setup.\n\n\
                 Recommended fixes (pick one):\n\
                 • Install Node via Homebrew: brew install node\n\
                 • Install Node via nvm: https://github.com/nvm-sh/nvm\n\
                 • Or run this in Terminal: sudo npm install -g @anthropic-ai/claude-code\n\n\
                 Then click Recheck."
                    .to_string(),
            );
        }

        Err(stderr)
    })
    .await
}

#[command]
pub async fn send_notification(title: String, body: String) -> Result<(), String> {
    wrap_cmd("send_notification", async move {
        tokio::task::spawn_blocking(move || {
            notify_rust::Notification::new()
                .summary(&title)
                .body(&body)
                .show()
                .map(|_| ())
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    })
    .await
}

#[command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    wrap_cmd("open_external_url", async move {
        // Reject null bytes that could confuse shell execution
        if url.contains('\0') {
            return Err("Invalid URL".to_string());
        }
        // Parse with a proper URL parser to prevent scheme confusion
        let parsed = url::Url::parse(&url).map_err(|_| "Invalid URL".to_string())?;
        if parsed.scheme() != "https" && parsed.scheme() != "http" {
            return Err("Only HTTP and HTTPS URLs are allowed".to_string());
        }
        open::that(parsed.as_str()).map_err(|e| e.to_string())
    })
    .await
}

/// Walks up from the running executable path to find the enclosing `.app` bundle on macOS.
#[cfg(target_os = "macos")]
fn get_macos_bundle_path() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("cannot resolve executable: {e}"))?;
    let mut path: &std::path::Path = exe.as_path();
    loop {
        if path
            .file_name()
            .map(|n| n.to_string_lossy().ends_with(".app"))
            .unwrap_or(false)
        {
            return Ok(path.to_path_buf());
        }
        match path.parent() {
            Some(parent) => path = parent,
            None => {
                return Err(
                    "Could not locate .app bundle — quarantine check skipped".to_string(),
                )
            }
        }
    }
}

/// Returns `true` if the running `.app` bundle carries the `com.apple.quarantine` xattr.
/// Always returns `false` on non-macOS platforms.
#[command]
pub async fn check_quarantine() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let bundle_path = match get_macos_bundle_path() {
            Ok(p) => p,
            // If we can't determine the bundle path (e.g. running from `cargo tauri dev`),
            // treat as not quarantined so the wizard doesn't block development.
            Err(_) => return Ok(false),
        };
        let output = std::process::Command::new("xattr")
            .args([
                "-p",
                "com.apple.quarantine",
                bundle_path.to_string_lossy().as_ref(),
            ])
            .output()
            .map_err(|e| format!("xattr check failed: {e}"))?;
        Ok(output.status.success())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(false)
    }
}

#[command]
pub async fn set_global_hotkey(app: tauri::AppHandle, shortcut: String) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| e.to_string())?;
    if !shortcut.is_empty() {
        app.global_shortcut()
            .register(shortcut.as_str())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Removes the `com.apple.quarantine` xattr from the running `.app` bundle.
/// No-op on non-macOS platforms.
#[command]
pub async fn remove_quarantine() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let bundle_path = get_macos_bundle_path()?;
        let output = std::process::Command::new("xattr")
            .args([
                "-d",
                "com.apple.quarantine",
                bundle_path.to_string_lossy().as_ref(),
            ])
            .output()
            .map_err(|e| format!("xattr remove failed: {e}"))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}
