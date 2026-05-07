#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ErrorSource {
    RustPanic,
    RustCommand,
    Frontend,
}

impl ErrorSource {
    pub fn as_tag(&self) -> &'static str {
        match self {
            ErrorSource::RustPanic => "rust_panic",
            ErrorSource::RustCommand => "rust_command",
            ErrorSource::Frontend => "frontend",
        }
    }
}

pub fn scrub(input: &str) -> String {
    use std::sync::OnceLock;
    static WIN_USER: OnceLock<regex::Regex> = OnceLock::new();
    static FILE_URI_USER: OnceLock<regex::Regex> = OnceLock::new();
    let win = WIN_USER.get_or_init(|| regex::Regex::new(r"C:\\Users\\[^\\]+\\").unwrap());
    let uri = FILE_URI_USER.get_or_init(|| regex::Regex::new(r"file:///C:/Users/[^/]+/").unwrap());
    let step1 = win.replace_all(input, r"C:\Users\<user>\");
    let step2 = uri.replace_all(&step1, "file:///C:/Users/<user>/");
    step2.into_owned()
}

pub fn fingerprint(
    source: ErrorSource,
    kind: Option<&str>,
    message: &str,
    stack: Option<&str>,
) -> String {
    use sha2::{Digest, Sha256};
    let first_line = stack
        .and_then(|s| s.lines().find(|l| !l.trim().is_empty()))
        .or_else(|| message.lines().find(|l| !l.trim().is_empty()))
        .unwrap_or("")
        .trim();
    let kind_str = kind.unwrap_or("");
    let mut h = Sha256::new();
    h.update(source.as_tag().as_bytes());
    h.update(b"|");
    h.update(kind_str.as_bytes());
    h.update(b"|");
    h.update(first_line.as_bytes());
    let digest = h.finalize();
    let mut out = String::with_capacity(16);
    for b in digest.iter().take(8) {
        use std::fmt::Write;
        write!(&mut out, "{:02x}", b).unwrap();
    }
    out
}

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const DEDUP_WINDOW: Duration = Duration::from_secs(60);

pub struct Dedup {
    map: Mutex<HashMap<String, Instant>>,
}

impl Dedup {
    pub fn new() -> Self {
        Self { map: Mutex::new(HashMap::new()) }
    }

    pub fn should_send(&self, fp: &str, now: Instant) -> bool {
        let mut map = match self.map.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(), // poisoned mutex; recover by taking the data
        };
        // Opportunistic prune: drop expired entries.
        map.retain(|_, t| now.saturating_duration_since(*t) <= DEDUP_WINDOW);
        if let Some(last) = map.get(fp) {
            if now.saturating_duration_since(*last) <= DEDUP_WINDOW {
                return false;
            }
        }
        map.insert(fp.to_string(), now);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrub_replaces_windows_user_path() {
        let input = r"thread panicked at C:\Users\alice\code\app\src\main.rs:42:10";
        let out = scrub(input);
        assert_eq!(
            out,
            r"thread panicked at C:\Users\<user>\code\app\src\main.rs:42:10"
        );
    }

    #[test]
    fn scrub_replaces_file_uri_user_path() {
        let input = "at handler (file:///C:/Users/alice/app/index.js:1:1)";
        let out = scrub(input);
        assert_eq!(out, "at handler (file:///C:/Users/<user>/app/index.js:1:1)");
    }

    #[test]
    fn scrub_leaves_other_paths_alone() {
        let input = r"C:\ProgramData\foo and /usr/share/bar";
        assert_eq!(scrub(input), input);
    }

    #[test]
    fn scrub_replaces_multiple_occurrences() {
        let input = r"C:\Users\bob\one and C:\Users\bob\two";
        assert_eq!(scrub(input), r"C:\Users\<user>\one and C:\Users\<user>\two");
    }

    #[test]
    fn source_tags_are_stable() {
        assert_eq!(ErrorSource::RustPanic.as_tag(), "rust_panic");
        assert_eq!(ErrorSource::RustCommand.as_tag(), "rust_command");
        assert_eq!(ErrorSource::Frontend.as_tag(), "frontend");
    }

    #[test]
    fn fingerprint_is_stable_for_identical_inputs() {
        let a = fingerprint(ErrorSource::RustPanic, Some("PtyOpenError"), "boom", Some("at foo\nat bar"));
        let b = fingerprint(ErrorSource::RustPanic, Some("PtyOpenError"), "boom", Some("at foo\nat bar"));
        assert_eq!(a, b);
        assert_eq!(a.len(), 16);
    }

    #[test]
    fn fingerprint_changes_with_source() {
        let a = fingerprint(ErrorSource::RustPanic, None, "boom", None);
        let b = fingerprint(ErrorSource::Frontend, None, "boom", None);
        assert_ne!(a, b);
    }

    #[test]
    fn fingerprint_uses_first_stack_line_when_present() {
        let with_stack = fingerprint(ErrorSource::Frontend, None, "ignored", Some("at A\nat B"));
        let other_stack = fingerprint(ErrorSource::Frontend, None, "ignored", Some("at A\nat C"));
        // First line is the same ("at A") so fingerprint matches even with different deeper frames.
        assert_eq!(with_stack, other_stack);
    }

    #[test]
    fn fingerprint_falls_back_to_message_when_stack_missing() {
        let a = fingerprint(ErrorSource::Frontend, None, "msg one", None);
        let b = fingerprint(ErrorSource::Frontend, None, "msg two", None);
        assert_ne!(a, b);
    }

    use std::time::{Duration, Instant};

    #[test]
    fn should_send_first_time_returns_true() {
        let dedup = Dedup::new();
        let now = Instant::now();
        assert!(dedup.should_send("abc", now));
    }

    #[test]
    fn should_send_within_window_returns_false() {
        let dedup = Dedup::new();
        let t0 = Instant::now();
        assert!(dedup.should_send("abc", t0));
        let t1 = t0 + Duration::from_secs(30);
        assert!(!dedup.should_send("abc", t1));
    }

    #[test]
    fn should_send_after_window_returns_true() {
        let dedup = Dedup::new();
        let t0 = Instant::now();
        assert!(dedup.should_send("abc", t0));
        let t1 = t0 + Duration::from_secs(61);
        assert!(dedup.should_send("abc", t1));
    }

    #[test]
    fn should_send_distinct_fingerprints_independent() {
        let dedup = Dedup::new();
        let t0 = Instant::now();
        assert!(dedup.should_send("abc", t0));
        assert!(dedup.should_send("def", t0));
    }
}
