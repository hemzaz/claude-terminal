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
}
