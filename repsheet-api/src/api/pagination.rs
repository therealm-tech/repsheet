use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use validator::Validate;

const DEFAULT_PER_PAGE: u32 = 50;
pub const MAX_PER_PAGE: u32 = 100;

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct PageQuery {
    /// 1-based page number (default 1)
    #[validate(range(min = 1))]
    pub page: Option<u32>,
    /// Items per page (default 50, at most 100)
    #[validate(range(min = 1, max = MAX_PER_PAGE))]
    pub per_page: Option<u32>,
}

impl PageQuery {
    pub fn page(&self) -> u32 {
        self.page.unwrap_or(1)
    }

    pub fn per_page(&self) -> u32 {
        self.per_page.unwrap_or(DEFAULT_PER_PAGE)
    }

    pub fn limit(&self) -> i64 {
        i64::from(self.per_page())
    }

    pub fn offset(&self) -> i64 {
        i64::from(self.page() - 1) * self.limit()
    }

    pub fn respond<T>(&self, items: Vec<T>, total: i64) -> PageResponse<T> {
        PageResponse {
            items,
            page: self.page(),
            per_page: self.per_page(),
            total,
        }
    }
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PageResponse<T> {
    pub items: Vec<T>,
    pub page: u32,
    pub per_page: u32,
    /// Number of matching items across all pages.
    pub total: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_the_first_page_of_fifty() {
        let query = PageQuery {
            page: None,
            per_page: None,
        };
        assert_eq!((query.limit(), query.offset()), (50, 0));
    }

    #[test]
    fn offset_skips_the_previous_pages() {
        let query = PageQuery {
            page: Some(3),
            per_page: Some(20),
        };
        assert_eq!((query.limit(), query.offset()), (20, 40));
    }

    #[test]
    fn rejects_oversized_pages() {
        let query = PageQuery {
            page: Some(1),
            per_page: Some(MAX_PER_PAGE + 1),
        };
        assert!(query.validate().is_err());
    }
}
