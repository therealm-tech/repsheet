use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgExecutor};
use uuid::Uuid;

/// The account at the other end of a coaching link, seen from one end.
#[derive(FromRow)]
pub struct LinkedAccountRow {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    pub linked_at: DateTime<Utc>,
}

/// Links `coach_id` to `athlete_id`; a unique violation when it already is.
pub async fn insert(
    exec: impl PgExecutor<'_>,
    athlete_id: Uuid,
    coach_id: Uuid,
) -> sqlx::Result<LinkedAccountRow> {
    sqlx::query_as(include_str!("../../queries/coaching/insert.sql"))
        .bind(athlete_id)
        .bind(coach_id)
        .fetch_one(exec)
        .await
}

pub async fn delete(
    exec: impl PgExecutor<'_>,
    athlete_id: Uuid,
    coach_id: Uuid,
) -> sqlx::Result<()> {
    sqlx::query(include_str!("../../queries/coaching/delete.sql"))
        .bind(athlete_id)
        .bind(coach_id)
        .execute(exec)
        .await?;
    Ok(())
}

pub async fn is_coach(
    exec: impl PgExecutor<'_>,
    athlete_id: Uuid,
    coach_id: Uuid,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(include_str!("../../queries/coaching/exists.sql"))
        .bind(athlete_id)
        .bind(coach_id)
        .fetch_one(exec)
        .await
}

pub async fn find_coach(
    exec: impl PgExecutor<'_>,
    athlete_id: Uuid,
    coach_id: Uuid,
) -> sqlx::Result<Option<LinkedAccountRow>> {
    sqlx::query_as(include_str!("../../queries/coaching/find_coach.sql"))
        .bind(athlete_id)
        .bind(coach_id)
        .fetch_optional(exec)
        .await
}

pub async fn find_athlete(
    exec: impl PgExecutor<'_>,
    coach_id: Uuid,
    athlete_id: Uuid,
) -> sqlx::Result<Option<LinkedAccountRow>> {
    sqlx::query_as(include_str!("../../queries/coaching/find_athlete.sql"))
        .bind(coach_id)
        .bind(athlete_id)
        .fetch_optional(exec)
        .await
}

pub async fn list_coaches(
    exec: impl PgExecutor<'_>,
    athlete_id: Uuid,
    limit: i64,
    offset: i64,
) -> sqlx::Result<Vec<LinkedAccountRow>> {
    sqlx::query_as(include_str!("../../queries/coaching/list_coaches.sql"))
        .bind(athlete_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(exec)
        .await
}

pub async fn count_coaches(exec: impl PgExecutor<'_>, athlete_id: Uuid) -> sqlx::Result<i64> {
    sqlx::query_scalar(include_str!("../../queries/coaching/count_coaches.sql"))
        .bind(athlete_id)
        .fetch_one(exec)
        .await
}

pub async fn list_athletes(
    exec: impl PgExecutor<'_>,
    coach_id: Uuid,
    limit: i64,
    offset: i64,
) -> sqlx::Result<Vec<LinkedAccountRow>> {
    sqlx::query_as(include_str!("../../queries/coaching/list_athletes.sql"))
        .bind(coach_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(exec)
        .await
}

pub async fn count_athletes(exec: impl PgExecutor<'_>, coach_id: Uuid) -> sqlx::Result<i64> {
    sqlx::query_scalar(include_str!("../../queries/coaching/count_athletes.sql"))
        .bind(coach_id)
        .fetch_one(exec)
        .await
}
