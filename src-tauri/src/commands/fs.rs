use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::{command, State};

use super::shared::{validate_path_is_trusted, wrap_cmd};

#[derive(Debug, Serialize)]
pub struct DirEntryInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
}

/// List the immediate children of a directory. Does NOT recurse — the UI
/// requests children lazily when the user expands a folder.
#[command]
pub async fn list_directory(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<DirEntryInfo>, String> {
    wrap_cmd("list_directory", async move {
        validate_path_is_trusted(&state, &path).await?;

        let mut entries: Vec<DirEntryInfo> = Vec::new();
        let read_dir =
            std::fs::read_dir(&path).map_err(|e| format!("Failed to read directory: {}", e))?;
        for entry in read_dir.flatten() {
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let file_name = entry.file_name().to_string_lossy().to_string();
            let full_path = entry.path().to_string_lossy().to_string();
            entries.push(DirEntryInfo {
                name: file_name,
                path: full_path,
                is_dir: meta.is_dir(),
                is_symlink: meta.file_type().is_symlink(),
                size: if meta.is_file() { meta.len() } else { 0 },
            });
        }

        // VS Code ordering: folders first, then files, each alphabetical (case-insensitive).
        entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });

        Ok(entries)
    })
    .await
}

/// Read a file as UTF-8 text. Refuses binary files and very large files so the
/// editor can't be used to OOM the app.
#[command]
pub async fn read_text_file(state: State<'_, AppState>, path: String) -> Result<String, String> {
    wrap_cmd("read_text_file", async move {
        validate_path_is_trusted(&state, &path).await?;

        let meta = std::fs::metadata(&path).map_err(|e| format!("Failed to stat file: {}", e))?;
        if meta.is_dir() {
            return Err("Path is a directory".to_string());
        }
        const MAX_BYTES: u64 = 5 * 1024 * 1024; // 5 MB
        if meta.len() > MAX_BYTES {
            return Err(format!(
                "File is too large to edit in-app ({} bytes, max {}).",
                meta.len(),
                MAX_BYTES
            ));
        }

        let bytes = std::fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))?;
        // Quick binary sniff: any NUL byte in the first 8 KB → binary.
        let sniff_len = bytes.len().min(8192);
        if bytes[..sniff_len].contains(&0u8) {
            return Err("File appears to be binary and cannot be edited as text.".to_string());
        }
        String::from_utf8(bytes).map_err(|_| "File is not valid UTF-8.".to_string())
    })
    .await
}

/// Write UTF-8 text back to a file. Refuses to create new paths — the file must
/// already exist in a trusted location.
#[command]
pub async fn write_text_file(
    state: State<'_, AppState>,
    path: String,
    content: String,
) -> Result<(), String> {
    wrap_cmd("write_text_file", async move {
        validate_path_is_trusted(&state, &path).await?;

        let meta = std::fs::metadata(&path).map_err(|e| format!("Failed to stat file: {}", e))?;
        if meta.is_dir() {
            return Err("Path is a directory".to_string());
        }
        std::fs::write(&path, content.as_bytes())
            .map_err(|e| format!("Failed to write file: {}", e))?;
        Ok(())
    })
    .await
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchMatch {
    pub line: u32,
    pub column: u32,
    pub line_text: String,
    pub match_length: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileSearchResult {
    pub file_path: String,
    pub relative_path: String,
    pub matches: Vec<SearchMatch>,
    pub name_match: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchSummary {
    pub results: Vec<FileSearchResult>,
    pub total_matches: u32,
    pub total_files: u32,
    pub truncated: bool,
}

const SEARCH_IGNORE_DIRS: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".turbo",
    ".cache",
    ".parcel-cache",
    ".vscode",
    ".idea",
    "__pycache__",
    ".pytest_cache",
    ".venv",
    "venv",
    "vendor",
    "coverage",
    ".vite",
];

const SEARCH_MAX_FILE_BYTES: u64 = 2 * 1024 * 1024; // 2 MB per file
const SEARCH_MAX_FILES: u32 = 5000;
const SEARCH_MAX_TOTAL_MATCHES: u32 = 5000;
const SEARCH_MAX_PER_FILE: usize = 200;

fn search_should_skip_dir(name: &str) -> bool {
    if SEARCH_IGNORE_DIRS.contains(&name) {
        return true;
    }
    name.starts_with('.') && name.len() > 1
}

struct SearchWalkContext<'a> {
    root: &'a std::path::Path,
    query_lower: &'a str,
    query_raw: &'a str,
    case_sensitive: bool,
    include_files: bool,
}

struct SearchWalkState<'a> {
    results: &'a mut Vec<FileSearchResult>,
    total_matches: &'a mut u32,
    files_seen: &'a mut u32,
}

fn search_walk(
    ctx: &SearchWalkContext<'_>,
    dir: &std::path::Path,
    state: &mut SearchWalkState<'_>,
) -> bool {
    // Returns false to signal "stop walking" when a hard cap is hit.
    let read_dir = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return true,
    };
    for entry in read_dir.flatten() {
        if *state.total_matches >= SEARCH_MAX_TOTAL_MATCHES || *state.files_seen >= SEARCH_MAX_FILES
        {
            return false;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            if search_should_skip_dir(&name) {
                continue;
            }
            if !search_walk(ctx, &path, state) {
                return false;
            }
            continue;
        }
        if !meta.is_file() {
            continue;
        }
        *state.files_seen += 1;
        let relative = path
            .strip_prefix(ctx.root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");

        // Filename match (always cheap, ignores file size).
        let name_lower = name.to_lowercase();
        let name_matches = if ctx.case_sensitive {
            name.contains(ctx.query_raw)
        } else {
            name_lower.contains(ctx.query_lower)
        };

        // Skip content scan for huge files, but still let filename matches through.
        let scan_content = ctx.include_files && meta.len() <= SEARCH_MAX_FILE_BYTES;

        let mut matches: Vec<SearchMatch> = Vec::new();
        if scan_content {
            if let Ok(bytes) = std::fs::read(&path) {
                let sniff_len = bytes.len().min(8192);
                if !bytes[..sniff_len].contains(&0u8) {
                    if let Ok(text) = std::str::from_utf8(&bytes) {
                        for (line_no, line) in (1_u32..).zip(text.lines()) {
                            if matches.len() >= SEARCH_MAX_PER_FILE {
                                break;
                            }
                            let haystack_lower;
                            let haystack: &str = if ctx.case_sensitive {
                                line
                            } else {
                                haystack_lower = line.to_lowercase();
                                &haystack_lower
                            };
                            let needle: &str = if ctx.case_sensitive {
                                ctx.query_raw
                            } else {
                                ctx.query_lower
                            };
                            let mut start = 0;
                            while let Some(idx) = haystack[start..].find(needle) {
                                let abs_idx = start + idx;
                                // Trim very long lines for transport.
                                let truncated_line = if line.len() > 400 {
                                    let cut = line
                                        .char_indices()
                                        .nth(400)
                                        .map(|(i, _)| i)
                                        .unwrap_or(line.len());
                                    format!("{}…", &line[..cut])
                                } else {
                                    line.to_string()
                                };
                                matches.push(SearchMatch {
                                    line: line_no,
                                    column: (abs_idx as u32) + 1,
                                    line_text: truncated_line,
                                    match_length: needle.chars().count() as u32,
                                });
                                *state.total_matches += 1;
                                if *state.total_matches >= SEARCH_MAX_TOTAL_MATCHES
                                    || matches.len() >= SEARCH_MAX_PER_FILE
                                {
                                    break;
                                }
                                start = abs_idx + needle.len().max(1);
                                if start >= haystack.len() {
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        if !matches.is_empty() || name_matches {
            state.results.push(FileSearchResult {
                file_path: path.to_string_lossy().replace('\\', "/"),
                relative_path: relative,
                matches,
                name_match: name_matches,
            });
        }
    }
    true
}

/// Search for `query` across all files under `path`. Walks the tree, skipping
/// common ignore directories (.git, node_modules, target, …) and files that
/// look binary. Returns matches grouped by file with line/column metadata.
#[command]
pub async fn search_in_files(
    state: State<'_, AppState>,
    path: String,
    query: String,
    case_sensitive: bool,
    include_file_contents: bool,
) -> Result<SearchSummary, String> {
    wrap_cmd("search_in_files", async move {
        validate_path_is_trusted(&state, &path).await?;

        if query.trim().is_empty() {
            return Ok(SearchSummary {
                results: Vec::new(),
                total_matches: 0,
                total_files: 0,
                truncated: false,
            });
        }

        let root = std::path::PathBuf::from(&path)
            .canonicalize()
            .map_err(|e| format!("Invalid root: {}", e))?;
        if !root.is_dir() {
            return Err("Search root is not a directory".to_string());
        }

        let query_lower = query.to_lowercase();
        let mut results: Vec<FileSearchResult> = Vec::new();
        let mut total_matches: u32 = 0;
        let mut files_seen: u32 = 0;

        let ctx = SearchWalkContext {
            root: &root,
            query_lower: &query_lower,
            query_raw: &query,
            case_sensitive,
            include_files: include_file_contents,
        };
        let mut walk_state = SearchWalkState {
            results: &mut results,
            total_matches: &mut total_matches,
            files_seen: &mut files_seen,
        };
        let completed = search_walk(&ctx, &root, &mut walk_state);

        // Show files with content matches first, then filename-only matches.
        results.sort_by(|a, b| {
            let a_only_name = a.matches.is_empty();
            let b_only_name = b.matches.is_empty();
            match (a_only_name, b_only_name) {
                (false, true) => std::cmp::Ordering::Less,
                (true, false) => std::cmp::Ordering::Greater,
                _ => a
                    .relative_path
                    .to_lowercase()
                    .cmp(&b.relative_path.to_lowercase()),
            }
        });

        Ok(SearchSummary {
            total_files: results.len() as u32,
            total_matches,
            truncated: !completed,
            results,
        })
    })
    .await
}
