//! IPC command modules — split from the original monolithic `commands.rs`.
//! Each sub-module owns one logical domain; `shared` provides cross-cutting
//! helpers (shell execution, path trust validation, error wrapping).
//!
//! The `pub use` re-exports below maintain a flat `commands::*` namespace for
//! any callers that prefer it; `generate_handler!` in main.rs uses the full
//! submodule paths to resolve `#[command]`-generated symbols.
#![allow(unused_imports)]

mod shared;

pub mod claude_config;
pub mod error;
pub mod fs;
pub mod git;
pub mod keybindings;
pub mod profile;
pub mod session;
pub mod snippet;
pub mod system;
pub mod team;
pub mod telemetry;
pub mod terminal;
pub mod workspace;

// ─── Re-exports ───────────────────────────────────────────────────────────────
// Flatten every public item so callers can still write `commands::create_terminal`
// etc., and `generate_handler![]` in main.rs continues to compile unchanged.

pub use claude_config::{
    read_claude_settings, write_claude_settings,
    list_claude_agents, read_claude_agent, write_claude_agent, delete_claude_agent,
    list_claude_commands, read_claude_command, write_claude_command, delete_claude_command,
    list_memory_files, read_memory_file, write_memory_file, list_claude_md_files,
    MemoryFileInfo, ClaudeMdInfo,
};

pub use error::{report_error, set_error_reporting_enabled, FrontendErrorPayload};

pub use fs::{
    list_directory, read_text_file, write_text_file, search_in_files,
    DirEntryInfo, SearchMatch, FileSearchResult, SearchSummary,
};

pub use git::{
    get_terminal_changes, get_path_changes,
    get_file_diff, get_path_file_diff,
    get_worktree_info, list_worktrees,
    get_repo_branches,
    git_stage_files, git_unstage_files, git_commit, git_push,
    git_stash_push, git_list_stashes, git_stash_apply, git_stash_pop, git_stash_drop,
    checkout_branch, git_create_branch,
    create_worktree, remove_worktree,
    get_repo_remote_refs, get_upstream_branch, git_pull_branch,
    scan_git_repos, list_package_scripts,
    get_git_head_content, git_discard_file,
    FileChange, FileChangesResult, FileDiffResult,
    WorktreeInfo, WorktreeDetectResult,
    StashEntry, AutoStageMode, PullStrategy,
    ScannedGitRepo, PackageScript,
};

pub use profile::{save_profile, get_profiles, delete_profile};

pub use session::{
    get_session_history, read_log_file, delete_session_history,
    get_session_log, summarize_session, save_session_summary, get_session_summary,
};

pub use snippet::{save_snippet, get_snippets, delete_snippet};

pub use system::{
    get_claude_version, check_claude_update, update_claude_code,
    get_hints, check_system_requirements, install_claude_code,
    send_notification, open_external_url,
    UpdateCheckResult, SystemStatus,
};

pub use team::{get_team_tasks, get_active_teams, TaskInfo, TeamMember, TeamConfig, TeamInfo};

pub use telemetry::{get_installation_id, send_telemetry_heartbeat};

pub use terminal::{
    create_terminal, write_to_terminal, resize_terminal, close_terminal,
    get_terminals, update_terminal_label, update_terminal_nickname,
    create_script_terminal, create_shell_terminal,
    CreateTerminalRequest,
};

pub use workspace::{
    get_workspaces, delete_workspace, save_workspace, load_workspace,
    save_session_for_restore, get_last_session, clear_last_session,
};

// Re-export wrap_cmd for any callers outside this module that need it.
pub use shared::wrap_cmd;
