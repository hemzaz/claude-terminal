use chrono::{DateTime, Local};
use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;
use tauri::command;

/// Aggregated cost statistics returned to the frontend.
#[derive(Debug, Serialize, Clone)]
pub struct CostStats {
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cost_usd: f64,
    pub daily: Vec<DailyCostEntry>,
    pub sessions: Vec<SessionCostEntry>,
}

/// Per-day aggregated cost entry (used for sparkline).
#[derive(Debug, Serialize, Clone)]
pub struct DailyCostEntry {
    pub date: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd: f64,
}

/// Per-session cost entry (top-10 by cost).
#[derive(Debug, Serialize, Clone)]
pub struct SessionCostEntry {
    pub session_id: String,
    pub date: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd: f64,
}

/// Parsed token counts from a single log file.
#[derive(Debug, Default, Clone)]
struct TokenCounts {
    input: u64,
    output: u64,
}

/// Calculate cost in USD given token counts and per-million rates.
fn calculate_cost(
    input_tokens: u64,
    output_tokens: u64,
    input_cost_per_million: f64,
    output_cost_per_million: f64,
) -> f64 {
    (input_tokens as f64 / 1_000_000.0) * input_cost_per_million
        + (output_tokens as f64 / 1_000_000.0) * output_cost_per_million
}

/// Parse token counts from a log file's text content.
///
/// Three formats emitted by Claude Code are supported (tried in priority order):
///   1. Slash:  `Tokens: 1234 in / 5678 out`
///   2. Noun:   `1234 input tokens` / `5678 output tokens` (separate lines)
///   3. Label:  `Input tokens: 1234` / `Output tokens: 5678`
///
/// `[^\S\n]+` is used instead of `\s+` so patterns never match across newlines.
fn parse_tokens_from_log(content: &str) -> TokenCounts {
    let slash_re =
        Regex::new(r"Tokens:[^\S\n]+(\d+)[^\S\n]+in[^\S\n]*/[^\S\n]+(\d+)[^\S\n]+out")
            .expect("valid regex");
    let input_noun_re = Regex::new(r"(\d+)[^\S\n]+input[^\S\n]+tokens").expect("valid regex");
    let output_noun_re = Regex::new(r"(\d+)[^\S\n]+output[^\S\n]+tokens").expect("valid regex");
    let input_label_re =
        Regex::new(r"(?i)input[^\S\n]+tokens:[^\S\n]+(\d+)").expect("valid regex");
    let output_label_re =
        Regex::new(r"(?i)output[^\S\n]+tokens:[^\S\n]+(\d+)").expect("valid regex");

    let mut total = TokenCounts::default();

    // Priority 1 — slash format; sum all occurrences within the file
    let mut found_slash = false;
    for cap in slash_re.captures_iter(content) {
        total.input = total.input.saturating_add(cap[1].parse().unwrap_or(0));
        total.output = total.output.saturating_add(cap[2].parse().unwrap_or(0));
        found_slash = true;
    }
    if found_slash {
        return total;
    }

    // Priority 2 — noun format
    let mut found_noun = false;
    for cap in input_noun_re.captures_iter(content) {
        total.input = total.input.saturating_add(cap[1].parse().unwrap_or(0));
        found_noun = true;
    }
    for cap in output_noun_re.captures_iter(content) {
        total.output = total.output.saturating_add(cap[1].parse().unwrap_or(0));
        found_noun = true;
    }
    if found_noun {
        return total;
    }

    // Priority 3 — label format
    for cap in input_label_re.captures_iter(content) {
        total.input = total.input.saturating_add(cap[1].parse().unwrap_or(0));
    }
    for cap in output_label_re.captures_iter(content) {
        total.output = total.output.saturating_add(cap[1].parse().unwrap_or(0));
    }

    total
}

/// Walk the logs directory and aggregate token/cost data across all `.log` files.
fn collect_cost_stats(
    input_cost_per_million: f64,
    output_cost_per_million: f64,
) -> Result<CostStats, String> {
    let logs_dir = directories::ProjectDirs::from("com", "claudeterminal", "ClaudeTerminal")
        .ok_or("Failed to get project directories")?
        .data_dir()
        .join("logs");

    if !logs_dir.exists() {
        return Ok(CostStats {
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_cost_usd: 0.0,
            daily: vec![],
            sessions: vec![],
        });
    }

    let entries = std::fs::read_dir(&logs_dir)
        .map_err(|e| format!("Failed to read logs directory: {e}"))?;

    let mut daily_map: HashMap<String, (u64, u64)> = HashMap::new();
    let mut sessions: Vec<SessionCostEntry> = Vec::new();
    let mut total_input: u64 = 0;
    let mut total_output: u64 = 0;

    for entry_res in entries {
        let entry = match entry_res {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("log") {
            continue;
        }

        let session_id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();

        let date_str = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .map(|t| {
                let dt: DateTime<Local> = t.into();
                dt.format("%Y-%m-%d").to_string()
            })
            .unwrap_or_else(|| "unknown".to_string());

        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let tokens = parse_tokens_from_log(&content);
        if tokens.input == 0 && tokens.output == 0 {
            continue;
        }

        total_input = total_input.saturating_add(tokens.input);
        total_output = total_output.saturating_add(tokens.output);

        let cost = calculate_cost(
            tokens.input,
            tokens.output,
            input_cost_per_million,
            output_cost_per_million,
        );

        sessions.push(SessionCostEntry {
            session_id,
            date: date_str.clone(),
            input_tokens: tokens.input,
            output_tokens: tokens.output,
            cost_usd: cost,
        });

        let day = daily_map.entry(date_str).or_insert((0, 0));
        day.0 = day.0.saturating_add(tokens.input);
        day.1 = day.1.saturating_add(tokens.output);
    }

    // Top-10 sessions by cost
    sessions.sort_by(|a, b| {
        b.cost_usd
            .partial_cmp(&a.cost_usd)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    sessions.truncate(10);

    // Daily entries sorted by date, last 30 days only
    let mut daily: Vec<DailyCostEntry> = daily_map
        .into_iter()
        .map(|(date, (input, output))| DailyCostEntry {
            cost_usd: calculate_cost(input, output, input_cost_per_million, output_cost_per_million),
            date,
            input_tokens: input,
            output_tokens: output,
        })
        .collect();
    daily.sort_by(|a, b| a.date.cmp(&b.date));
    if daily.len() > 30 {
        let skip = daily.len() - 30;
        daily = daily.into_iter().skip(skip).collect();
    }

    let total_cost_usd =
        calculate_cost(total_input, total_output, input_cost_per_million, output_cost_per_million);

    Ok(CostStats {
        total_input_tokens: total_input,
        total_output_tokens: total_output,
        total_cost_usd,
        daily,
        sessions,
    })
}

/// Return aggregated cost statistics for the dashboard.
#[command]
pub async fn get_cost_stats(
    input_cost_per_million: f64,
    output_cost_per_million: f64,
) -> Result<CostStats, String> {
    collect_cost_stats(input_cost_per_million, output_cost_per_million)
}

/// Export cost data as a CSV string.
#[command]
pub async fn export_cost_csv(
    input_cost_per_million: f64,
    output_cost_per_million: f64,
) -> Result<String, String> {
    let stats = collect_cost_stats(input_cost_per_million, output_cost_per_million)?;

    let mut csv = String::from("session_id,date,input_tokens,output_tokens,cost_usd\n");
    for s in &stats.sessions {
        csv.push_str(&format!(
            "{},{},{},{},{:.6}\n",
            s.session_id, s.date, s.input_tokens, s.output_tokens, s.cost_usd
        ));
    }
    Ok(csv)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calculate_cost_zero_tokens() {
        assert_eq!(calculate_cost(0, 0, 3.0, 15.0), 0.0);
    }

    #[test]
    fn calculate_cost_one_million_each() {
        let cost = calculate_cost(1_000_000, 1_000_000, 3.0, 15.0);
        assert!((cost - 18.0).abs() < 1e-9);
    }

    #[test]
    fn parse_slash_format_single() {
        let t = parse_tokens_from_log("some text\nTokens: 1000 in / 500 out\nmore");
        assert_eq!(t.input, 1000);
        assert_eq!(t.output, 500);
    }

    #[test]
    fn parse_slash_format_multiple_occurrences() {
        let t = parse_tokens_from_log("Tokens: 100 in / 200 out\nTokens: 300 in / 400 out");
        assert_eq!(t.input, 400);
        assert_eq!(t.output, 600);
    }

    #[test]
    fn parse_noun_format() {
        let t = parse_tokens_from_log("1234 input tokens\n5678 output tokens\n");
        assert_eq!(t.input, 1234);
        assert_eq!(t.output, 5678);
    }

    #[test]
    fn parse_label_format() {
        let t = parse_tokens_from_log("Input tokens: 2000\nOutput tokens: 8000\n");
        assert_eq!(t.input, 2000);
        assert_eq!(t.output, 8000);
    }

    #[test]
    fn parse_empty_content() {
        let t = parse_tokens_from_log("no token data here");
        assert_eq!(t.input, 0);
        assert_eq!(t.output, 0);
    }

    #[test]
    fn noun_regex_does_not_cross_newlines() {
        // "2000\nOutput tokens:" must NOT match output_noun_re
        let t = parse_tokens_from_log("2000\nOutput tokens: 8000\n");
        assert_eq!(t.output, 8000);
    }

    #[test]
    fn slash_takes_priority_over_noun() {
        let t = parse_tokens_from_log("Tokens: 10 in / 20 out\n30 input tokens\n40 output tokens");
        assert_eq!(t.input, 10);
        assert_eq!(t.output, 20);
    }
}
