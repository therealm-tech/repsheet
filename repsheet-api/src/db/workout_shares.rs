use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgExecutor};
use uuid::Uuid;

#[derive(FromRow)]
pub struct WorkoutShareRow {
    pub coach_id: Uuid,
    pub shared_at: DateTime<Utc>,
}

/// Shares the workout with the coach; sharing it again changes nothing.
pub async fn insert(
    exec: impl PgExecutor<'_>,
    workout_id: Uuid,
    coach_id: Uuid,
) -> sqlx::Result<()> {
    sqlx::query(include_str!("../../queries/workout_shares/insert.sql"))
        .bind(workout_id)
        .bind(coach_id)
        .execute(exec)
        .await?;
    Ok(())
}

pub async fn delete(
    exec: impl PgExecutor<'_>,
    workout_id: Uuid,
    coach_id: Uuid,
) -> sqlx::Result<()> {
    sqlx::query(include_str!("../../queries/workout_shares/delete.sql"))
        .bind(workout_id)
        .bind(coach_id)
        .execute(exec)
        .await?;
    Ok(())
}

/// Removes every share `athlete_id` made with `coach_id`.
pub async fn delete_for_coach(
    exec: impl PgExecutor<'_>,
    athlete_id: Uuid,
    coach_id: Uuid,
) -> sqlx::Result<()> {
    sqlx::query(include_str!(
        "../../queries/workout_shares/delete_for_coach.sql"
    ))
    .bind(athlete_id)
    .bind(coach_id)
    .execute(exec)
    .await?;
    Ok(())
}

pub async fn list(
    exec: impl PgExecutor<'_>,
    workout_id: Uuid,
    limit: i64,
    offset: i64,
) -> sqlx::Result<Vec<WorkoutShareRow>> {
    sqlx::query_as(include_str!("../../queries/workout_shares/list.sql"))
        .bind(workout_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(exec)
        .await
}

pub async fn count(exec: impl PgExecutor<'_>, workout_id: Uuid) -> sqlx::Result<i64> {
    sqlx::query_scalar(include_str!("../../queries/workout_shares/count.sql"))
        .bind(workout_id)
        .fetch_one(exec)
        .await
}
