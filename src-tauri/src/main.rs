#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod terminal;
mod config;
mod database;
mod telemetry;
mod error_reporter;

use tauri::{Emitter, Manager};
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct AppState {
    pub terminals: Arc<Mutex<terminal::TerminalManager>>,
    pub db: Arc<Mutex<database::Database>>,
}

fn main() {
    // In release builds (panic = "abort"), panic reports are best-effort:
    // the spawned send task usually doesn't get to flush before abort.
    std::panic::set_hook(Box::new(|info| {
        let msg = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "unknown panic".into());
        let kind = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()));
        let backtrace = std::backtrace::Backtrace::force_capture().to_string();
        error_reporter::report_blocking(
            error_reporter::ErrorSource::RustPanic,
            kind,
            msg,
            Some(backtrace),
        );
    }));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    use tauri_plugin_global_shortcut::ShortcutState;
                    if event.state() == ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("main") {
                            let visible = window.is_visible().unwrap_or(false);
                            let focused = window.is_focused().unwrap_or(false);
                            if visible && focused {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            let db = database::Database::new()?;
            let installation_id = db.get_or_create_installation_id().unwrap_or_default();
            let app_version = app.package_info().version.to_string();
            error_reporter::init(installation_id, app_version);

            let terminal_manager = terminal::TerminalManager::new();

            app.manage(AppState {
                terminals: Arc::new(Mutex::new(terminal_manager)),
                db: Arc::new(Mutex::new(db)),
            });

            // ── macOS native menubar ──────────────────────────────────────────
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};

                let app_submenu = SubmenuBuilder::new(app, "Claude Terminal")
                    .about(None)
                    .separator()
                    .services()
                    .separator()
                    .hide()
                    .hide_others()
                    .show_all()
                    .separator()
                    .quit()
                    .build()?;

                let new_term = MenuItemBuilder::with_id("menu-new-terminal", "New Terminal")
                    .accelerator("CmdOrCtrl+T")
                    .build(app)?;
                let close_term =
                    MenuItemBuilder::with_id("menu-close-terminal", "Close Terminal")
                        .accelerator("CmdOrCtrl+W")
                        .build(app)?;
                let file_submenu = SubmenuBuilder::new(app, "File")
                    .item(&new_term)
                    .item(&close_term)
                    .build()?;

                let find = MenuItemBuilder::with_id("menu-find", "Find...")
                    .accelerator("CmdOrCtrl+F")
                    .build(app)?;
                let edit_submenu = SubmenuBuilder::new(app, "Edit")
                    .undo()
                    .redo()
                    .separator()
                    .cut()
                    .copy()
                    .paste()
                    .select_all()
                    .separator()
                    .item(&find)
                    .build()?;

                let toggle_sidebar =
                    MenuItemBuilder::with_id("menu-toggle-sidebar", "Toggle Sidebar")
                        .accelerator("CmdOrCtrl+B")
                        .build(app)?;
                let toggle_hints =
                    MenuItemBuilder::with_id("menu-toggle-hints", "Toggle Hints Panel")
                        .accelerator("F1")
                        .build(app)?;
                let toggle_grid =
                    MenuItemBuilder::with_id("menu-toggle-grid", "Toggle Grid View")
                        .accelerator("CmdOrCtrl+G")
                        .build(app)?;
                let view_submenu = SubmenuBuilder::new(app, "View")
                    .item(&toggle_sidebar)
                    .item(&toggle_hints)
                    .item(&toggle_grid)
                    .build()?;

                let zoom = PredefinedMenuItem::maximize(app, Some("Zoom"))?;
                let window_submenu = SubmenuBuilder::new(app, "Window")
                    .minimize()
                    .item(&zoom)
                    .build()?;

                let docs =
                    MenuItemBuilder::with_id("menu-docs", "Documentation").build(app)?;
                let report =
                    MenuItemBuilder::with_id("menu-report-issue", "Report Issue").build(app)?;
                let help_submenu = SubmenuBuilder::new(app, "Help")
                    .item(&docs)
                    .item(&report)
                    .build()?;

                let menu = MenuBuilder::new(app)
                    .item(&app_submenu)
                    .item(&file_submenu)
                    .item(&edit_submenu)
                    .item(&view_submenu)
                    .item(&window_submenu)
                    .item(&help_submenu)
                    .build()?;

                app.set_menu(menu)?;
                app.on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        id @ ("menu-new-terminal" | "menu-close-terminal"
                        | "menu-toggle-sidebar" | "menu-toggle-hints"
                        | "menu-toggle-grid" | "menu-find") => {
                            let _ = app.emit("menu-event", id);
                        }
                        "menu-docs" => {
                            let _ = open::that(
                                "https://github.com/hemzaz/claude-terminal#readme",
                            );
                        }
                        "menu-report-issue" => {
                            let _ = open::that(
                                "https://github.com/hemzaz/claude-terminal/issues/new",
                            );
                        }
                        _ => {}
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // terminal
            commands::terminal::create_terminal,
            commands::terminal::write_to_terminal,
            commands::terminal::resize_terminal,
            commands::terminal::close_terminal,
            commands::terminal::get_terminals,
            commands::terminal::update_terminal_label,
            commands::terminal::update_terminal_nickname,
            commands::terminal::set_terminal_pinned,
            commands::terminal::create_script_terminal,
            commands::terminal::create_shell_terminal,
            // profile
            commands::profile::save_profile,
            commands::profile::get_profiles,
            commands::profile::delete_profile,
            commands::profile::update_profile_last_used,
            // system
            commands::system::get_claude_version,
            commands::system::check_claude_update,
            commands::system::update_claude_code,
            commands::system::get_hints,
            commands::system::check_system_requirements,
            commands::system::install_claude_code,
            commands::system::open_external_url,
            commands::system::send_notification,
            commands::system::check_quarantine,
            commands::system::remove_quarantine,
            commands::system::set_global_hotkey,
            // workspace
            commands::workspace::get_workspaces,
            commands::workspace::delete_workspace,
            commands::workspace::save_workspace,
            commands::workspace::load_workspace,
            commands::workspace::save_session_for_restore,
            commands::workspace::get_last_session,
            commands::workspace::clear_last_session,
            // git
            commands::git::get_terminal_changes,
            commands::git::get_path_changes,
            commands::git::get_file_diff,
            commands::git::get_path_file_diff,
            commands::git::git_create_branch,
            commands::git::get_repo_remote_refs,
            commands::git::get_upstream_branch,
            commands::git::git_pull_branch,
            commands::git::get_worktree_info,
            commands::git::list_worktrees,
            commands::git::get_repo_branches,
            commands::git::checkout_branch,
            commands::git::git_commit,
            commands::git::git_push,
            commands::git::git_stage_files,
            commands::git::git_unstage_files,
            commands::git::git_stash_push,
            commands::git::git_list_stashes,
            commands::git::git_stash_apply,
            commands::git::git_stash_pop,
            commands::git::git_stash_drop,
            commands::git::create_worktree,
            commands::git::remove_worktree,
            commands::git::scan_git_repos,
            commands::git::git_discard_file,
            commands::git::get_git_head_content,
            commands::git::list_package_scripts,
            // session
            commands::session::get_session_history,
            commands::session::get_session_log,
            commands::session::read_log_file,
            commands::session::delete_session_history,
            commands::session::summarize_session,
            commands::session::save_session_summary,
            commands::session::get_session_summary,
            commands::session::export_session,
            commands::session::search_session_history,
            // snippet
            commands::snippet::save_snippet,
            commands::snippet::get_snippets,
            commands::snippet::delete_snippet,
            // team
            commands::team::get_active_teams,
            commands::team::get_team_tasks,
            // claude_config
            commands::claude_config::read_claude_settings,
            commands::claude_config::write_claude_settings,
            commands::claude_config::list_claude_agents,
            commands::claude_config::read_claude_agent,
            commands::claude_config::write_claude_agent,
            commands::claude_config::delete_claude_agent,
            commands::claude_config::list_claude_commands,
            commands::claude_config::read_claude_command,
            commands::claude_config::write_claude_command,
            commands::claude_config::delete_claude_command,
            commands::claude_config::list_memory_files,
            commands::claude_config::read_memory_file,
            commands::claude_config::write_memory_file,
            commands::claude_config::list_claude_md_files,
            // telemetry
            commands::telemetry::get_installation_id,
            commands::telemetry::send_telemetry_heartbeat,
            // fs
            commands::fs::list_directory,
            commands::fs::read_text_file,
            commands::fs::write_text_file,
            commands::fs::search_in_files,
            // error
            commands::error::report_error,
            commands::error::set_error_reporting_enabled,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let app_state = window.state::<AppState>();
                let terminals = app_state.terminals.clone();
                let db = app_state.db.clone();
                tauri::async_runtime::block_on(async {
                    // Read configs and save session (short lock)
                    let configs = {
                        let manager = terminals.lock().await;
                        manager.get_all_configs()
                    };
                    {
                        let db = db.lock().await;
                        if let Err(e) = db.save_last_session(&configs) {
                            eprintln!("Failed to save last session on exit: {}", e);
                        }
                    }
                    // Gracefully shut down all PTY children: SIGTERM → 2 s wait → SIGKILL
                    {
                        let mut manager = terminals.lock().await;
                        manager.shutdown_all_graceful();
                    }
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
