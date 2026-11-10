use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{FromRow, PgExecutor};
use uuid::Uuid;

#[derive(FromRow)]
pub struct PlannedSessionRow {
    pub id: Uuid,
    pub athlete_id: Uuid,
    pub author_id: Option<Uuid>,
    pub author_name: Option<String>,
    pub planned_on: NaiveDate,
    pub name: String,
    pub note: Option<String>,
    /// When its author sent it to the athlete; none while it is a draft.
    pub sent_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

#[derive(FromRow)]
pub struct PlannedSessionSummaryRow {
    pub id: Uuid,
    pub athlete_id: Uuid,
    pub author_id: Option<Uuid>,
    pub author_name: Option<String>,
    pub planned_on: NaiveDate,
    pub name: String,
    pub sent_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
    pub block_count: i64,
    pub workout_count: i64,
}

/// The planned sessions of `athlete_id`, only those written by `author_id`
/// when it is set. Drafts are listed only to their author.
pub async fn list(
    exec: impl PgExecutor<'_>,
    athlete_id: Uuid,
    author_id: Option<Uuid>,
    limit: i64,
    offset: i64,
) -> sqlx::Result<Vec<PlannedSessionSummaryRow>> {
    sqlx::query_as(include_str!("../../queries/planned_sessions/list.sql"))
        .bind(athlete_id)
        .bind(author_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(exec)
        .await
}

pub async fn count(
    exec: impl PgExecutor<'_>,
    athlete_id: Uuid,
    author_id: Option<Uuid>,
) -> sqlx::Result<i64> {
    sqlx::query_scalar(include_str!("../../queries/planned_sessions/count.sql"))
        .bind(athlete_id)
        .bind(author_id)
        .fetch_one(exec)
        .await
}

/// The planned session as `user_id` may see it: as its athlete once it is
/// sent, or as its author while the athlete still has them as a coach.
pub async fn find(
    exec: impl PgExecutor<'_>,
    id: Uuid,
    user_id: Uuid,
) -> sqlx::Result<Option<PlannedSessionRow>> {
    sqlx::query_as(include_str!("../../queries/planned_sessions/find.sql"))
        .bind(id)
        .bind(user_id)
        .fetch_optional(exec)
        .await
}

/// Callers check access with [`find`] first.
pub async fn update(
    exec: impl PgExecutor<'_>,
    id: Uuid,
    planned_on: NaiveDate,
    name: &str,
    note: Option<&str>,
) -> sqlx::Result<()> {
    sqlx::query(include_str!("../../queries/planned_sessions/update.sql"))
        .bind(id)
        .bind(planned_on)
        .bind(name)
        .bind(note)
        .execute(exec)
        .await?;
    Ok(())
}

/// Callers check access with [`find`] first.
pub async fn delete(exec: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<()> {
    sqlx::query(include_str!("../../queries/planned_sessions/delete.sql"))
        .bind(id)
        .execute(exec)
        .await?;
    Ok(())
}

/// Shows the draft to its athlete; a session already sent stays as it is.
/// Callers check access with [`find`] first.
pub async fn send(exec: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<()> {
    sqlx::query(include_str!("../../queries/planned_sessions/send.sql"))
        .bind(id)
        .execute(exec)
        .await?;
    Ok(())
}
