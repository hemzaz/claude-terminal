use std::collections::HashMap;
use tauri::command;

fn keybindings_path() -> Option<std::path::PathBuf> {
    directories::ProjectDirs::from("com", "claudeterminal", "ClaudeTerminal")
        .map(|d| d.config_dir().join("keybindings.json"))
}

const DEFAULT_KEYBINDINGS: &str = r#"{
  "terminal.new": "Cmd+T",
  "terminal.new.shift": "Cmd+Shift+N",
  "terminal.close.active": "Cmd+W",
  "terminal.close.all": "Cmd+Shift+W",
  "terminal.reopen.last": "Cmd+Shift+T",
  "terminal.duplicate": "Cmd+Shift+D",
  "terminal.switch.1": "Cmd+1",
  "terminal.switch.2": "Cmd+2",
  "terminal.switch.3": "Cmd+3",
  "terminal.switch.4": "Cmd+4",
  "terminal.switch.5": "Cmd+5",
  "terminal.switch.6": "Cmd+6",
  "terminal.switch.7": "Cmd+7",
  "terminal.switch.8": "Cmd+8",
  "terminal.switch.9": "Cmd+9",
  "view.toggle.grid": "Cmd+G",
  "view.toggle.sidebar": "Cmd+B",
  "view.toggle.split": "Cmd+\\",
  "view.add.to.grid": "Cmd+Shift+G",
  "app.settings.open": "Cmd+,",
  "palette.open": "Cmd+P",
  "snippets.open": "Cmd+Shift+S",
  "search.global": "Cmd+Shift+F",
  "worktree.open": "Cmd+Shift+W"
}"#;

/// Creates the config directory if needed and writes the default keybindings
/// file if it does not already exist. Returns the file path as a String.
#[command]
pub async fn ensure_keybindings_file_exists() -> Result<String, String> {
    let path =
        keybindings_path().ok_or_else(|| "Failed to determine config directory".to_string())?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {e}"))?;
    }

    if !path.exists() {
        std::fs::write(&path, DEFAULT_KEYBINDINGS)
            .map_err(|e| format!("Failed to write keybindings.json: {e}"))?;
    }

    Ok(path.to_string_lossy().into_owned())
}

/// Read `keybindings.json` and return a map of action key → key combo string.
/// Returns an empty map if the file does not exist (don't error).
#[command]
pub async fn read_keybindings() -> Result<HashMap<String, String>, String> {
    let path =
        keybindings_path().ok_or_else(|| "Failed to determine config directory".to_string())?;

    if !path.exists() {
        return Ok(HashMap::new());
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read keybindings.json: {e}"))?;

    serde_json::from_str::<HashMap<String, String>>(&content)
        .map_err(|e| format!("Failed to parse keybindings.json: {e}"))
}

/// Opens `keybindings.json` in the user's default editor.
#[command]
pub async fn open_keybindings_file() -> Result<(), String> {
    let path =
        keybindings_path().ok_or_else(|| "Failed to determine config directory".to_string())?;

    // Ensure the file exists before trying to open it
    if !path.exists() {
        ensure_keybindings_file_exists().await?;
    }

    open::that(&path).map_err(|e| format!("Failed to open keybindings.json: {e}"))
}
