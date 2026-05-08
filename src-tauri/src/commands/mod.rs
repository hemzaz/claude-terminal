//! IPC command modules — split from the original monolithic `commands.rs`.
//! Each sub-module owns one logical domain; `shared` provides cross-cutting
//! helpers (shell execution, path trust validation, error wrapping).
//!
//! `generate_handler!` in main.rs uses fully-qualified submodule paths
//! (e.g. `commands::terminal::create_terminal`), so no flat re-exports are
//! needed here. Add specific re-exports only when a real call site requires
//! the shorter `commands::foo` form.

mod shared;

pub mod claude_config;
pub mod cost;
pub mod error;
pub mod fs;
pub mod git;
pub mod keybindings;
pub mod layout;
pub mod profile;
pub mod session;
pub mod snippet;
pub mod system;
pub mod team;
pub mod telemetry;
pub mod terminal;
pub mod workspace;
