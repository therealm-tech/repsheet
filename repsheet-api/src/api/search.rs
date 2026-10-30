/// Turns a `q` parameter into the text the SQL matches with `LIKE`: trimmed,
/// absent when blank, and with the wildcards escaped so that `50%` means what
/// it says.
pub fn search_text(q: Option<&str>) -> Option<String> {
    q.map(str::trim).filter(|q| !q.is_empty()).map(|q| {
        q.replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_like_wildcards() {
        assert_eq!(
            search_text(Some(" 50%_\\ ")).as_deref(),
            Some("50\\%\\_\\\\")
        );
    }

    #[test]
    fn blank_means_no_search() {
        assert_eq!(search_text(Some("   ")), None);
        assert_eq!(search_text(None), None);
    }
}
