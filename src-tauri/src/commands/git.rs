use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::{command, State};

use super::shared::{shell_command, validate_path_is_trusted, wrap_cmd};

// ─── Shared git helper ───────────────────────────────────────────────────────

fn run_git(path: &str, args: &[&str]) -> Result<String, String> {
    let out = shell_command("git", args)
        .current_dir(path)
        .output()
        .map_err(|e| format!("Failed to run git {}: {}", args.join(" "), e))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        return Err(if !stderr.is_empty() { stderr } else { stdout });
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

fn validate_stash_ref(r: &str) -> Result<(), String> {
    // Must be "stash@{N}" to prevent argument injection
    if !r.starts_with("stash@{") || !r.ends_with('}') {
        return Err("Invalid stash reference".to_string());
    }
    let inner = &r[7..r.len() - 1];
    if inner.is_empty() || !inner.chars().all(|c| c.is_ascii_digit()) {
        return Err("Invalid stash reference".to_string());
    }
    Ok(())
}

fn validate_file_list(files: &[String]) -> Result<(), String> {
    if files.is_empty() {
        return Err("No files selected".to_string());
    }
    for f in files {
        if f.is_empty() || f.contains('\0') {
            return Err("Invalid file path".to_string());
        }
        // Reject absolute paths and parent-dir traversal. Git always reports
        // repo-relative paths, so legitimate inputs never need these.
        if f.starts_with('/') || f.starts_with('\\') || f.contains("..") {
            return Err(format!("Invalid file path: {}", f));
        }
    }
    Ok(())
}

fn reject_bad_ref(s: &str, label: &str) -> Result<(), String> {
    if s.is_empty() || s.starts_with('-') {
        return Err(format!("Invalid {}", label));
    }
    if s.chars().any(|c| {
        c.is_control()
            || c == ' '
            || c == '~'
            || c == '^'
            || c == ':'
            || c == '?'
            || c == '*'
            || c == '['
            || c == '\\'
    }) {
        return Err(format!("Invalid {}", label));
    }
    Ok(())
}

// ─── File changes ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct FileChange {
    pub path: String,
    pub status: String,
    pub staged: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileChangesResult {
    pub terminal_id: String,
    pub working_directory: String,
    pub changes: Vec<FileChange>,
    pub is_git_repo: bool,
    pub branch: Option<String>,
    pub error: Option<String>,
}

fn map_status_code(c: char) -> &'static str {
    match c {
        'A' => "new",
        'M' => "modified",
        'D' => "deleted",
        'R' => "renamed",
        'C' => "new",
        'U' => "modified", // conflicted
        'T' => "modified", // type change
        _ => "",
    }
}

fn parse_git_status_output(stdout: &str) -> Vec<FileChange> {
    let mut changes = Vec::new();
    for line in stdout.lines() {
        if line.len() < 3 {
            continue;
        }
        let x = line.as_bytes().first().copied().unwrap_or(b' ') as char;
        let y = line.as_bytes().get(1).copied().unwrap_or(b' ') as char;
        let raw_path = &line[3..];
        let path = if raw_path.contains(" -> ") {
            raw_path.split(" -> ").nth(1).unwrap_or(raw_path).to_string()
        } else {
            raw_path.to_string()
        };

        if x == '?' && y == '?' {
            changes.push(FileChange {
                path,
                status: "untracked".into(),
                staged: false,
            });
            continue;
        }

        if x != ' ' && x != '?' {
            let status = map_status_code(x);
            if !status.is_empty() {
                changes.push(FileChange {
                    path: path.clone(),
                    status: status.into(),
                    staged: true,
                });
            }
        }
        if y != ' ' && y != '?' {
            let status = map_status_code(y);
            if !status.is_empty() {
                changes.push(FileChange {
                    path,
                    status: status.into(),
                    staged: false,
                });
            }
        }
    }
    changes
}

#[command]
pub async fn get_terminal_changes(
    state: State<'_, AppState>,
    id: String,
) -> Result<FileChangesResult, String> {
    wrap_cmd("get_terminal_changes", async move {
        let working_directory = {
            let terminals = state.terminals.lock().await;
            let configs = terminals.get_all_configs();
            configs
                .into_iter()
                .find(|c| c.id == id)
                .map(|c| c.working_directory.clone())
                .ok_or_else(|| "Terminal not found".to_string())?
        };

        let branch_output = shell_command("git", &["rev-parse", "--abbrev-ref", "HEAD"])
            .current_dir(&working_directory)
            .output();

        let (is_git_repo, branch) = match branch_output {
            Ok(output) if output.status.success() => {
                let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
                (true, Some(branch))
            }
            _ => (false, None),
        };

        if !is_git_repo {
            return Ok(FileChangesResult {
                terminal_id: id,
                working_directory,
                changes: vec![],
                is_git_repo: false,
                branch: None,
                error: None,
            });
        }

        let status_output = shell_command("git", &["status", "--porcelain"])
            .current_dir(&working_directory)
            .output()
            .map_err(|e| format!("Failed to run git status: {}", e))?;

        if !status_output.status.success() {
            return Ok(FileChangesResult {
                terminal_id: id,
                working_directory,
                changes: vec![],
                is_git_repo: true,
                branch,
                error: Some(
                    String::from_utf8_lossy(&status_output.stderr)
                        .trim()
                        .to_string(),
                ),
            });
        }

        let stdout = String::from_utf8_lossy(&status_output.stdout);
        Ok(FileChangesResult {
            terminal_id: id,
            working_directory,
            changes: parse_git_status_output(&stdout),
            is_git_repo: true,
            branch,
            error: None,
        })
    })
    .await
}

#[command]
pub async fn get_path_changes(
    state: State<'_, AppState>,
    path: String,
) -> Result<FileChangesResult, String> {
    wrap_cmd("get_path_changes", async move {
        validate_path_is_trusted(&state, &path).await?;

        let branch_output = shell_command("git", &["rev-parse", "--abbrev-ref", "HEAD"])
            .current_dir(&path)
            .output();

        let (is_git_repo, branch) = match branch_output {
            Ok(output) if output.status.success() => {
                let b = String::from_utf8_lossy(&output.stdout).trim().to_string();
                (true, Some(b))
            }
            _ => (false, None),
        };

        if !is_git_repo {
            return Ok(FileChangesResult {
                terminal_id: String::new(),
                working_directory: path,
                changes: vec![],
                is_git_repo: false,
                branch: None,
                error: None,
            });
        }

        let status_output = shell_command("git", &["status", "--porcelain"])
            .current_dir(&path)
            .output()
            .map_err(|e| format!("Failed to run git status: {}", e))?;

        if !status_output.status.success() {
            return Ok(FileChangesResult {
                terminal_id: String::new(),
                working_directory: path,
                changes: vec![],
                is_git_repo: true,
                branch,
                error: Some(
                    String::from_utf8_lossy(&status_output.stderr)
                        .trim()
                        .to_string(),
                ),
            });
        }

        let stdout = String::from_utf8_lossy(&status_output.stdout);
        Ok(FileChangesResult {
            terminal_id: String::new(),
            working_directory: path,
            changes: parse_git_status_output(&stdout),
            is_git_repo: true,
            branch,
            error: None,
        })
    })
    .await
}

// ─── File diff ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct FileDiffResult {
    pub file_path: String,
    pub diff_text: String,
    pub is_new_file: bool,
    pub is_deleted_file: bool,
    pub is_binary: bool,
}

fn compute_diff_text(
    working_directory: &str,
    file_path: &str,
    file_status: &str,
    staged: bool,
) -> Result<String, String> {
    let is_new_file = file_status == "??" || file_status == "A";
    let is_deleted_file = file_status == "D";

    if is_new_file {
        let full_path = std::path::Path::new(working_directory).join(file_path);
        return match std::fs::read_to_string(&full_path) {
            Ok(content) => {
                let lines: Vec<String> =
                    content.lines().map(|l| format!("+{}", l)).collect();
                Ok(format!(
                    "--- /dev/null\n+++ b/{}\n@@ -0,0 +1,{} @@\n{}",
                    file_path,
                    lines.len(),
                    lines.join("\n")
                ))
            }
            Err(_) => Ok(String::from("Unable to read file contents")),
        };
    }

    if is_deleted_file {
        let show_output =
            shell_command("git", &["show", &format!("HEAD:{}", file_path)])
                .current_dir(working_directory)
                .output();
        return match show_output {
            Ok(output) if output.status.success() => {
                let content = String::from_utf8_lossy(&output.stdout);
                let lines: Vec<String> =
                    content.lines().map(|l| format!("-{}", l)).collect();
                Ok(format!(
                    "--- a/{}\n+++ /dev/null\n@@ -1,{} +0,0 @@\n{}",
                    file_path,
                    lines.len(),
                    lines.join("\n")
                ))
            }
            _ => Ok(String::from("Unable to read deleted file contents")),
        };
    }

    let mut args = vec!["diff"];
    if staged {
        args.push("--cached");
    }
    args.push("--");
    args.push(file_path);

    let diff_output = shell_command("git", &args)
        .current_dir(working_directory)
        .output()
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    let text = String::from_utf8_lossy(&diff_output.stdout).to_string();

    // If unstaged diff is empty, try staged diff (file might be fully staged)
    if text.trim().is_empty() && !staged {
        let staged_output =
            shell_command("git", &["diff", "--cached", "--", file_path])
                .current_dir(working_directory)
                .output()
                .map_err(|e| format!("Failed to run git diff --cached: {}", e))?;
        return Ok(String::from_utf8_lossy(&staged_output.stdout).to_string());
    }

    Ok(text)
}

#[command]
pub async fn get_file_diff(
    state: State<'_, AppState>,
    id: String,
    file_path: String,
    staged: bool,
) -> Result<FileDiffResult, String> {
    wrap_cmd("get_file_diff", async move {
        let (working_directory, file_status) = {
            let terminals = state.terminals.lock().await;
            let configs = terminals.get_all_configs();
            let config = configs
                .into_iter()
                .find(|c| c.id == id)
                .ok_or_else(|| "Terminal not found".to_string())?;

            let status_output =
                shell_command("git", &["status", "--porcelain", "--", &file_path])
                    .current_dir(&config.working_directory)
                    .output()
                    .map_err(|e| format!("Failed to run git status: {}", e))?;

            let status_str =
                String::from_utf8_lossy(&status_output.stdout).trim().to_string();
            let file_status = if status_str.len() >= 2 {
                status_str[..2].trim().to_string()
            } else {
                String::new()
            };

            (config.working_directory.clone(), file_status)
        };

        let is_new_file = file_status == "??" || file_status == "A";
        let is_deleted_file = file_status == "D";
        let diff_text =
            compute_diff_text(&working_directory, &file_path, &file_status, staged)?;
        let is_binary =
            diff_text.contains("Binary files") && diff_text.contains("differ");

        Ok(FileDiffResult {
            file_path,
            diff_text,
            is_new_file,
            is_deleted_file,
            is_binary,
        })
    })
    .await
}

#[command]
pub async fn get_path_file_diff(
    state: State<'_, AppState>,
    path: String,
    file_path: String,
    staged: bool,
) -> Result<FileDiffResult, String> {
    wrap_cmd("get_path_file_diff", async move {
        validate_path_is_trusted(&state, &path).await?;

        let status_output =
            shell_command("git", &["status", "--porcelain", "--", &file_path])
                .current_dir(&path)
                .output()
                .map_err(|e| format!("Failed to run git status: {}", e))?;

        let status_str =
            String::from_utf8_lossy(&status_output.stdout).trim().to_string();
        let file_status = if status_str.len() >= 2 {
            status_str[..2].trim().to_string()
        } else {
            String::new()
        };

        let is_new_file = file_status == "??" || file_status == "A";
        let is_deleted_file = file_status == "D";
        let diff_text = compute_diff_text(&path, &file_path, &file_status, staged)?;
        let is_binary =
            diff_text.contains("Binary files") && diff_text.contains("differ");

        Ok(FileDiffResult {
            file_path,
            diff_text,
            is_new_file,
            is_deleted_file,
            is_binary,
        })
    })
    .await
}

// ─── Worktrees ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: Option<String>,
    pub head_sha: String,
    pub is_main: bool,
    pub is_bare: bool,
    pub is_detached: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorktreeDetectResult {
    pub is_git_repo: bool,
    pub is_worktree: bool,
    pub main_repo_path: Option<String>,
    pub current_branch: Option<String>,
    pub worktree_root: Option<String>,
}

#[command]
pub async fn get_worktree_info(
    state: State<'_, AppState>,
    path: String,
) -> Result<WorktreeDetectResult, String> {
    wrap_cmd("get_worktree_info", async move {
        validate_path_is_trusted(&state, &path).await?;

        let inside_wt = shell_command("git", &["rev-parse", "--is-inside-work-tree"])
            .current_dir(&path)
            .output();

        let is_git_repo = matches!(inside_wt, Ok(ref o) if o.status.success()
            && String::from_utf8_lossy(&o.stdout).trim() == "true");

        if !is_git_repo {
            return Ok(WorktreeDetectResult {
                is_git_repo: false,
                is_worktree: false,
                main_repo_path: None,
                current_branch: None,
                worktree_root: None,
            });
        }

        let toplevel = shell_command("git", &["rev-parse", "--show-toplevel"])
            .current_dir(&path)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());

        let git_dir = shell_command("git", &["rev-parse", "--git-dir"])
            .current_dir(&path)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());

        let git_common_dir = shell_command("git", &["rev-parse", "--git-common-dir"])
            .current_dir(&path)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());

        let is_worktree = match (&git_dir, &git_common_dir) {
            (Some(dir), Some(common)) => {
                let dir_canon = std::path::PathBuf::from(dir).canonicalize().ok();
                let common_canon = std::path::PathBuf::from(common).canonicalize().ok();
                match (dir_canon, common_canon) {
                    (Some(d), Some(c)) => d != c,
                    _ => dir != common,
                }
            }
            _ => false,
        };

        let main_repo_path = git_common_dir.and_then(|common| {
            let p = std::path::PathBuf::from(&common);
            let canonical = p.canonicalize().ok()?;
            if canonical.file_name().map(|f| f == ".git").unwrap_or(false) {
                canonical.parent().map(|p| p.to_string_lossy().to_string())
            } else {
                Some(canonical.to_string_lossy().to_string())
            }
        });

        let current_branch = shell_command("git", &["rev-parse", "--abbrev-ref", "HEAD"])
            .current_dir(&path)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| {
                let b = String::from_utf8_lossy(&o.stdout).trim().to_string();
                if b == "HEAD" { None } else { Some(b) }
            })
            .flatten();

        Ok(WorktreeDetectResult {
            is_git_repo: true,
            is_worktree,
            main_repo_path,
            current_branch,
            worktree_root: toplevel,
        })
    })
    .await
}

/// Internal helper to list worktrees for a given path (no authorization check).
fn list_worktrees_internal(path: &str) -> Result<Vec<WorktreeInfo>, String> {
    let output = shell_command("git", &["worktree", "list", "--porcelain"])
        .current_dir(path)
        .output()
        .map_err(|e| format!("Failed to run git worktree list: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut worktrees = Vec::new();
    let mut is_first = true;

    for block in stdout.split("\n\n") {
        let block = block.trim();
        if block.is_empty() {
            continue;
        }

        let mut wt_path = String::new();
        let mut head_sha = String::new();
        let mut branch: Option<String> = None;
        let mut is_bare = false;
        let mut is_detached = false;

        for line in block.lines() {
            if let Some(p) = line.strip_prefix("worktree ") {
                wt_path = p.to_string();
            } else if let Some(h) = line.strip_prefix("HEAD ") {
                head_sha = h[..7.min(h.len())].to_string();
            } else if let Some(b) = line.strip_prefix("branch ") {
                branch = Some(
                    b.strip_prefix("refs/heads/")
                        .unwrap_or(b)
                        .to_string(),
                );
            } else if line == "bare" {
                is_bare = true;
            } else if line == "detached" {
                is_detached = true;
            }
        }

        if !wt_path.is_empty() {
            worktrees.push(WorktreeInfo {
                path: wt_path,
                branch,
                head_sha,
                is_main: is_first,
                is_bare,
                is_detached,
            });
        }
        is_first = false;
    }

    Ok(worktrees)
}

#[command]
pub async fn list_worktrees(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<WorktreeInfo>, String> {
    wrap_cmd("list_worktrees", async move {
        validate_path_is_trusted(&state, &path).await?;
        list_worktrees_internal(&path)
    })
    .await
}

#[command]
pub async fn get_repo_branches(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<String>, String> {
    wrap_cmd("get_repo_branches", async move {
        validate_path_is_trusted(&state, &path).await?;

        let output = shell_command("git", &["branch", "--format=%(refname:short)"])
            .current_dir(&path)
            .output()
            .map_err(|e| format!("Failed to list branches: {}", e))?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let branches: Vec<String> = stdout
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect();

        Ok(branches)
    })
    .await
}

// ─── Stash ───────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct StashEntry {
    pub reference: String,
    pub message: String,
    pub branch: Option<String>,
}

#[command]
pub async fn git_stage_files(
    state: State<'_, AppState>,
    path: String,
    files: Vec<String>,
) -> Result<(), String> {
    wrap_cmd("git_stage_files", async move {
        validate_path_is_trusted(&state, &path).await?;
        validate_file_list(&files)?;
        let mut args: Vec<&str> = vec!["add", "--"];
        for f in &files {
            args.push(f);
        }
        run_git(&path, &args).map(|_| ())
    })
    .await
}

#[command]
pub async fn git_unstage_files(
    state: State<'_, AppState>,
    path: String,
    files: Vec<String>,
) -> Result<(), String> {
    wrap_cmd("git_unstage_files", async move {
        validate_path_is_trusted(&state, &path).await?;
        validate_file_list(&files)?;
        let mut args: Vec<&str> = vec!["reset", "HEAD", "--"];
        for f in &files {
            args.push(f);
        }
        match run_git(&path, &args) {
            Ok(_) => Ok(()),
            Err(e) => {
                if e.contains("ambiguous argument 'HEAD'") || e.contains("unknown revision") {
                    let mut fb: Vec<&str> = vec!["rm", "--cached", "--"];
                    for f in &files {
                        fb.push(f);
                    }
                    run_git(&path, &fb).map(|_| ())
                } else {
                    Err(e)
                }
            }
        }
    })
    .await
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum AutoStageMode {
    None,
    Tracked,
    All,
}

#[command]
pub async fn git_commit(
    state: State<'_, AppState>,
    path: String,
    message: String,
    auto_stage: AutoStageMode,
) -> Result<(), String> {
    wrap_cmd("git_commit", async move {
        validate_path_is_trusted(&state, &path).await?;
        if message.trim().is_empty() {
            return Err("Commit message cannot be empty".to_string());
        }
        match auto_stage {
            AutoStageMode::None => {
                let status = run_git(&path, &["diff", "--cached", "--name-only"])?;
                if status.trim().is_empty() {
                    return Err(
                        "Nothing is staged — stage files first or choose 'stage all'"
                            .to_string(),
                    );
                }
            }
            AutoStageMode::Tracked => {
                run_git(&path, &["add", "-u"])?;
            }
            AutoStageMode::All => {
                run_git(&path, &["add", "-A"])?;
            }
        }

        let tmp = std::env::temp_dir().join(format!(
            "ct-commit-msg-{}.txt",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        ));
        std::fs::write(&tmp, message.as_bytes())
            .map_err(|e| format!("Failed to write commit message: {}", e))?;
        let tmp_str = tmp.to_string_lossy().to_string();
        let res = run_git(&path, &["commit", "-F", &tmp_str]);
        let _ = std::fs::remove_file(&tmp);
        res.map(|_| ())
    })
    .await
}

#[command]
pub async fn git_push(
    state: State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    wrap_cmd("git_push", async move {
        validate_path_is_trusted(&state, &path).await?;
        run_git(&path, &["push"]).map(|_| ())
    })
    .await
}

#[command]
pub async fn git_stash_push(
    state: State<'_, AppState>,
    path: String,
    message: Option<String>,
    include_untracked: bool,
) -> Result<(), String> {
    wrap_cmd("git_stash_push", async move {
        validate_path_is_trusted(&state, &path).await?;
        let mut args: Vec<String> = vec!["stash".into(), "push".into()];
        if include_untracked {
            args.push("-u".into());
        }
        if let Some(m) = message.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
            if m.chars().any(|c| c.is_control()) {
                return Err(
                    "Stash message cannot contain control characters".to_string(),
                );
            }
            args.push("-m".into());
            args.push(m.to_string());
        }
        let str_args: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        run_git(&path, &str_args).map(|_| ())
    })
    .await
}

#[command]
pub async fn git_list_stashes(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<StashEntry>, String> {
    wrap_cmd("git_list_stashes", async move {
        validate_path_is_trusted(&state, &path).await?;
        let out = run_git(&path, &["stash", "list", "--format=%gd\x1f%s"])?;
        let mut entries = Vec::new();
        for line in out.lines() {
            let mut parts = line.splitn(2, '\x1f');
            let reference = parts.next().unwrap_or("").trim().to_string();
            let subject = parts.next().unwrap_or("").trim().to_string();
            if reference.is_empty() {
                continue;
            }
            let branch = subject
                .strip_prefix("WIP on ")
                .or_else(|| subject.strip_prefix("On "))
                .and_then(|s| s.split_once(':'))
                .map(|(b, _)| b.trim().to_string());
            entries.push(StashEntry {
                reference,
                message: subject,
                branch,
            });
        }
        Ok(entries)
    })
    .await
}

#[command]
pub async fn git_stash_apply(
    state: State<'_, AppState>,
    path: String,
    reference: String,
) -> Result<(), String> {
    wrap_cmd("git_stash_apply", async move {
        validate_path_is_trusted(&state, &path).await?;
        validate_stash_ref(&reference)?;
        run_git(&path, &["stash", "apply", &reference]).map(|_| ())
    })
    .await
}

#[command]
pub async fn git_stash_pop(
    state: State<'_, AppState>,
    path: String,
    reference: String,
) -> Result<(), String> {
    wrap_cmd("git_stash_pop", async move {
        validate_path_is_trusted(&state, &path).await?;
        validate_stash_ref(&reference)?;
        run_git(&path, &["stash", "pop", &reference]).map(|_| ())
    })
    .await
}

#[command]
pub async fn git_stash_drop(
    state: State<'_, AppState>,
    path: String,
    reference: String,
) -> Result<(), String> {
    wrap_cmd("git_stash_drop", async move {
        validate_path_is_trusted(&state, &path).await?;
        validate_stash_ref(&reference)?;
        run_git(&path, &["stash", "drop", &reference]).map(|_| ())
    })
    .await
}

// ─── Branch operations ───────────────────────────────────────────────────────

#[command]
pub async fn checkout_branch(
    state: State<'_, AppState>,
    path: String,
    branch: String,
) -> Result<(), String> {
    wrap_cmd("checkout_branch", async move {
        validate_path_is_trusted(&state, &path).await?;
        if branch.is_empty() || branch.starts_with('-') {
            return Err("Invalid branch name".to_string());
        }
        if branch.chars().any(|c| {
            c.is_control()
                || c == ' '
                || c == '~'
                || c == '^'
                || c == ':'
                || c == '?'
                || c == '*'
                || c == '['
        }) {
            return Err("Invalid branch name".to_string());
        }
        let output = shell_command("git", &["checkout", &branch])
            .current_dir(&path)
            .output()
            .map_err(|e| format!("Failed to run git checkout: {}", e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            return Err(if !stderr.is_empty() { stderr } else { stdout });
        }
        Ok(())
    })
    .await
}

#[command]
pub async fn git_create_branch(
    state: State<'_, AppState>,
    path: String,
    name: String,
    base: Option<String>,
) -> Result<(), String> {
    wrap_cmd("git_create_branch", async move {
        validate_path_is_trusted(&state, &path).await?;
        reject_bad_ref(&name, "branch name")?;
        if let Some(b) = base.as_deref() {
            reject_bad_ref(b, "base ref")?;
        }

        let mut args: Vec<&str> = vec!["checkout", "-b", &name];
        if let Some(b) = base.as_deref() {
            args.push(b);
        }

        let output = shell_command("git", &args)
            .current_dir(&path)
            .output()
            .map_err(|e| format!("Failed to run git checkout -b: {}", e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            return Err(if !stderr.is_empty() { stderr } else { stdout });
        }
        Ok(())
    })
    .await
}

#[command]
pub async fn create_worktree(
    state: State<'_, AppState>,
    repo_path: String,
    worktree_path: String,
    branch: String,
    create_branch: bool,
) -> Result<WorktreeInfo, String> {
    wrap_cmd("create_worktree", async move {
        validate_path_is_trusted(&state, &repo_path).await?;

        if worktree_path.contains('\0') || worktree_path.contains("..") {
            return Err("Invalid worktree path".to_string());
        }
        let branch_regex = regex::Regex::new(r"^[a-zA-Z0-9_./-]+$")
            .map_err(|e| e.to_string())?;
        if !branch_regex.is_match(&branch) {
            return Err(
                "Invalid branch name. Use only letters, numbers, dots, hyphens, underscores, and slashes."
                    .to_string(),
            );
        }

        let output = if create_branch {
            shell_command("git", &["worktree", "add", "-b", &branch, &worktree_path])
                .current_dir(&repo_path)
                .output()
        } else {
            shell_command("git", &["worktree", "add", &worktree_path, &branch])
                .current_dir(&repo_path)
                .output()
        };

        let output = output.map_err(|e| format!("Failed to create worktree: {}", e))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }

        let worktrees = list_worktrees_internal(&repo_path)?;
        let normalized_path = std::path::PathBuf::from(&worktree_path);
        let canonical = normalized_path.canonicalize().ok();

        worktrees
            .into_iter()
            .find(|wt| {
                let wt_canon = std::path::PathBuf::from(&wt.path).canonicalize().ok();
                match (&canonical, &wt_canon) {
                    (Some(a), Some(b)) => a == b,
                    _ => wt.path == worktree_path,
                }
            })
            .ok_or_else(|| "Worktree created but not found in list".to_string())
    })
    .await
}

#[command]
pub async fn remove_worktree(
    state: State<'_, AppState>,
    repo_path: String,
    worktree_path: String,
    force: bool,
) -> Result<(), String> {
    wrap_cmd("remove_worktree", async move {
        validate_path_is_trusted(&state, &repo_path).await?;

        if worktree_path.contains('\0') || worktree_path.contains("..") {
            return Err("Invalid worktree path".to_string());
        }
        let args = if force {
            vec!["worktree", "remove", "--force", &worktree_path]
        } else {
            vec!["worktree", "remove", &worktree_path]
        };

        let output = shell_command("git", &args)
            .current_dir(&repo_path)
            .output()
            .map_err(|e| format!("Failed to remove worktree: {}", e))?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        Ok(())
    })
    .await
}

// ─── Remote / pull ───────────────────────────────────────────────────────────

#[command]
pub async fn get_repo_remote_refs(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<String>, String> {
    wrap_cmd("get_repo_remote_refs", async move {
        validate_path_is_trusted(&state, &path).await?;
        let out = run_git(
            &path,
            &["for-each-ref", "--format=%(refname:short)", "refs/remotes/"],
        )?;
        let mut refs: Vec<String> = out
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty() && !l.ends_with("/HEAD"))
            .collect();
        refs.sort();
        Ok(refs)
    })
    .await
}

#[command]
pub async fn get_upstream_branch(
    state: State<'_, AppState>,
    path: String,
) -> Result<Option<String>, String> {
    wrap_cmd("get_upstream_branch", async move {
        validate_path_is_trusted(&state, &path).await?;
        let output = shell_command(
            "git",
            &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
        )
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to run git rev-parse: {}", e))?;
        if !output.status.success() {
            return Ok(None);
        }
        let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if s.is_empty() { Ok(None) } else { Ok(Some(s)) }
    })
    .await
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
pub enum PullStrategy {
    Merge,
    Rebase,
    FfOnly,
}

#[command]
pub async fn git_pull_branch(
    state: State<'_, AppState>,
    path: String,
    remote: String,
    branch: String,
    strategy: PullStrategy,
) -> Result<String, String> {
    wrap_cmd("git_pull_branch", async move {
        validate_path_is_trusted(&state, &path).await?;
        reject_bad_ref(&remote, "remote")?;
        reject_bad_ref(&branch, "branch")?;

        let dirty = run_git(&path, &["status", "--porcelain"])?;
        if !dirty.trim().is_empty() {
            return Err(
                "Working tree has uncommitted changes — commit or stash first, then pull."
                    .into(),
            );
        }

        let mut args: Vec<&str> = vec!["pull"];
        match strategy {
            PullStrategy::Merge => {}
            PullStrategy::Rebase => args.push("--rebase"),
            PullStrategy::FfOnly => args.push("--ff-only"),
        }
        args.push("--");
        args.push(&remote);
        args.push(&branch);

        let output = shell_command("git", &args)
            .current_dir(&path)
            .output()
            .map_err(|e| format!("Failed to run git pull: {}", e))?;
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !output.status.success() {
            return Err(if !stderr.is_empty() { stderr } else { stdout });
        }
        let combined = if stderr.is_empty() {
            stdout
        } else if stdout.is_empty() {
            stderr
        } else {
            format!("{}\n{}", stdout, stderr)
        };
        Ok(combined)
    })
    .await
}

// ─── Git repo scan ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct ScannedGitRepo {
    pub path: String,
    pub relative_path: String,
    pub branch: Option<String>,
    pub is_worktree: bool,
    pub is_main_repo: bool,
    pub dirty: bool,
    pub ahead: u32,
    pub behind: u32,
}

fn git_branch_for(path: &std::path::Path) -> Option<String> {
    let out = shell_command("git", &["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(path)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let b = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if b == "HEAD" || b.is_empty() { None } else { Some(b) }
}

fn git_is_worktree(path: &std::path::Path) -> bool {
    let git_dir = shell_command("git", &["rev-parse", "--git-dir"])
        .current_dir(path)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    let common = shell_command("git", &["rev-parse", "--git-common-dir"])
        .current_dir(path)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    match (git_dir, common) {
        (Some(d), Some(c)) => {
            let dc = std::path::PathBuf::from(&d).canonicalize().ok();
            let cc = std::path::PathBuf::from(&c).canonicalize().ok();
            match (dc, cc) {
                (Some(a), Some(b)) => a != b,
                _ => d != c,
            }
        }
        _ => false,
    }
}

fn git_dirty(path: &std::path::Path) -> bool {
    shell_command("git", &["status", "--porcelain"])
        .current_dir(path)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| !o.stdout.is_empty())
        .unwrap_or(false)
}

fn git_ahead_behind(path: &std::path::Path) -> (u32, u32) {
    let out = shell_command(
        "git",
        &["rev-list", "--count", "--left-right", "HEAD...@{u}"],
    )
    .current_dir(path)
    .output();
    let Ok(out) = out else { return (0, 0); };
    if !out.status.success() {
        return (0, 0);
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let mut parts = s.split_whitespace();
    let a: u32 = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    let b: u32 = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    (a, b)
}

const SCAN_SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    ".git",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".turbo",
    ".cache",
    ".venv",
    "venv",
    "__pycache__",
    ".idea",
    ".vscode",
    "vendor",
];

fn scan_for_repos(
    root: &std::path::Path,
    current: &std::path::Path,
    depth: u32,
    max_depth: u32,
    results: &mut Vec<ScannedGitRepo>,
    limit: usize,
) {
    if results.len() >= limit { return; }
    if depth > max_depth { return; }

    let dot_git = current.join(".git");
    if dot_git.exists() {
        let branch = git_branch_for(current);
        let is_wt = git_is_worktree(current);
        let dirty = git_dirty(current);
        let (ahead, behind) = git_ahead_behind(current);
        let rel = current
            .strip_prefix(root)
            .unwrap_or(current)
            .to_string_lossy()
            .to_string();
        let relative_path = if rel.is_empty() { ".".to_string() } else { rel };
        let is_main = current == root;
        results.push(ScannedGitRepo {
            path: current.to_string_lossy().to_string(),
            relative_path,
            branch,
            is_worktree: is_wt,
            is_main_repo: is_main,
            dirty,
            ahead,
            behind,
        });
        if !is_main { return; }
    }

    let Ok(entries) = std::fs::read_dir(current) else { return; };
    for entry in entries.flatten() {
        if results.len() >= limit { return; }
        let path = entry.path();
        if !path.is_dir() { continue; }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        if name.starts_with('.') && name != ".git" { continue; }
        if SCAN_SKIP_DIRS.iter().any(|s| *s == name) { continue; }
        scan_for_repos(root, &path, depth + 1, max_depth, results, limit);
    }
}

#[command]
pub async fn scan_git_repos(
    state: State<'_, AppState>,
    root_path: String,
) -> Result<Vec<ScannedGitRepo>, String> {
    wrap_cmd("scan_git_repos", async move {
        validate_path_is_trusted(&state, &root_path).await?;
        let root = std::path::Path::new(&root_path)
            .canonicalize()
            .map_err(|e| format!("Invalid path: {}", e))?;
        let mut results = Vec::new();
        scan_for_repos(&root, &root, 0, 4, &mut results, 40);
        Ok(results)
    })
    .await
}

// ─── Package scripts ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct PackageScript {
    pub name: String,
    pub command: String,
}

#[command]
pub async fn list_package_scripts(
    state: State<'_, AppState>,
    cwd: String,
) -> Result<Vec<PackageScript>, String> {
    wrap_cmd("list_package_scripts", async move {
        validate_path_is_trusted(&state, &cwd).await?;

        let pkg_path = std::path::Path::new(&cwd).join("package.json");
        let bytes = match std::fs::read(&pkg_path) {
            Ok(b) => b,
            Err(_) => return Ok(vec![]),
        };
        let json: serde_json::Value = serde_json::from_slice(&bytes)
            .map_err(|e| format!("Invalid package.json: {}", e))?;
        let scripts = match json.get("scripts").and_then(|v| v.as_object()) {
            Some(m) => m,
            None => return Ok(vec![]),
        };
        let result: Vec<PackageScript> = scripts
            .iter()
            .filter_map(|(name, val)| {
                val.as_str().map(|command| PackageScript {
                    name: name.clone(),
                    command: command.to_string(),
                })
            })
            .collect();
        Ok(result)
    })
    .await
}

// ─── File content / discard ──────────────────────────────────────────────────

#[command]
pub async fn get_git_head_content(
    state: State<'_, AppState>,
    path: String,
    file: String,
) -> Result<String, String> {
    wrap_cmd("get_git_head_content", async move {
        validate_path_is_trusted(&state, &path).await?;
        if file.is_empty() || file.starts_with('-') {
            return Err("Invalid file path".to_string());
        }
        let normalized = file.replace('\\', "/");
        let spec = format!("HEAD:{}", normalized);
        let output = shell_command("git", &["show", &spec])
            .current_dir(&path)
            .output()
            .map_err(|e| format!("Failed to run git show: {}", e))?;
        if !output.status.success() {
            return Ok(String::new());
        }
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    })
    .await
}

#[command]
pub async fn git_discard_file(
    state: State<'_, AppState>,
    path: String,
    file: String,
    untracked: bool,
) -> Result<(), String> {
    wrap_cmd("git_discard_file", async move {
        validate_path_is_trusted(&state, &path).await?;
        if file.is_empty() || file.starts_with('-') {
            return Err("Invalid file path".to_string());
        }

        if untracked {
            let joined = std::path::Path::new(&path).join(&file);
            let canonical_target = joined.canonicalize().map_err(|e| {
                format!("Cannot resolve '{}': {}", joined.display(), e)
            })?;
            let canonical_root = std::path::Path::new(&path)
                .canonicalize()
                .map_err(|e| format!("Cannot resolve repo '{}': {}", path, e))?;
            if !canonical_target.starts_with(&canonical_root) {
                return Err(format!(
                    "Refusing to delete path outside repo: {}",
                    canonical_target.display()
                ));
            }
            let meta = std::fs::metadata(&canonical_target).map_err(|e| {
                format!("Failed to stat '{}': {}", canonical_target.display(), e)
            })?;
            if meta.is_dir() {
                std::fs::remove_dir_all(&canonical_target)
                    .map_err(|e| format!("Failed to delete directory: {}", e))?;
            } else {
                std::fs::remove_file(&canonical_target)
                    .map_err(|e| format!("Failed to delete file: {}", e))?;
            }
            return Ok(());
        }

        let output = shell_command("git", &["checkout", "HEAD", "--", &file])
            .current_dir(&path)
            .output()
            .map_err(|e| format!("Failed to run git checkout: {}", e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            return Err(
                if !stderr.is_empty() {
                    stderr
                } else if !stdout.is_empty() {
                    stdout
                } else {
                    "git checkout failed".into()
                },
            );
        }
        Ok(())
    })
    .await
}
