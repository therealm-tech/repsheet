use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgExecutor};
use uuid::Uuid;

use crate::domain::WeightUnit;

/// A coach at the other end of a coaching link, seen by their athlete.
#[derive(FromRow)]
pub struct LinkedAccountRow {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    pub linked_at: DateTime<Utc>,
}

/// An athlete at the other end of a coaching link, seen by their coach: an
/// account, or a profile with no email that the coach manages.
#[derive(FromRow)]
pub struct AthleteRow {
    pub id: Uuid,
    pub name: String,
    pub email: Option<String>,
    #[sqlx(try_from = "String")]
    pub weight_unit: WeightUnit,
    pub managed: bool,
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

/// Whether `coach_id` manages the profile of `athlete_id`; `None` when they
/// do not coach them at all.
pub async fn manages(
    exec: impl PgExecutor<'_>,
    athlete_id: Uuid,
    coach_id: Uuid,
) -> sqlx::Result<Option<bool>> {
    sqlx::query_scalar(include_str!("../../queries/coaching/manages.sql"))
        .bind(athlete_id)
        .bind(coach_id)
        .fetch_optional(exec)
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
) -> sqlx::Result<Option<AthleteRow>> {
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
) -> sqlx::Result<Vec<AthleteRow>> {
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
