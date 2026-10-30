use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgExecutor};
use uuid::Uuid;

use crate::domain::{Locale, Role};

pub async fn insert(
    exec: impl PgExecutor<'_>,
    user_id: Uuid,
    digest: &[u8],
    expires_at: DateTime<Utc>,
) -> sqlx::Result<()> {
    sqlx::query(include_str!("../../queries/tokens/insert.sql"))
        .bind(user_id)
        .bind(digest)
        .bind(expires_at)
        .execute(exec)
        .await?;
    Ok(())
}

#[derive(FromRow)]
pub struct TokenUserRow {
    pub id: Uuid,
    #[sqlx(try_from = "String")]
    pub role: Role,
    #[sqlx(try_from = "String")]
    pub locale: Locale,
}

/// The user a live token belongs to.
pub async fn find_user(
    exec: impl PgExecutor<'_>,
    digest: &[u8],
) -> sqlx::Result<Option<TokenUserRow>> {
    sqlx::query_as(include_str!("../../queries/tokens/find_user.sql"))
        .bind(digest)
        .fetch_optional(exec)
        .await
}

pub async fn delete(exec: impl PgExecutor<'_>, digest: &[u8]) -> sqlx::Result<()> {
    sqlx::query(include_str!("../../queries/tokens/delete.sql"))
        .bind(digest)
        .execute(exec)
        .await?;
    Ok(())
}
