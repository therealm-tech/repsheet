use sqlx::{FromRow, PgConnection, PgExecutor};
use uuid::Uuid;

#[derive(FromRow)]
pub struct LabelRow {
    pub name: String,
    pub exercise_count: i64,
}

/// Makes `labels` the user's labels on the exercise, and returns them.
pub async fn replace(
    conn: &mut PgConnection,
    user_id: Uuid,
    exercise_id: Uuid,
    labels: &[&str],
) -> sqlx::Result<Vec<String>> {
    sqlx::query(include_str!(
        "../../queries/exercise_labels/delete_except.sql"
    ))
    .bind(user_id)
    .bind(exercise_id)
    .bind(labels)
    .execute(&mut *conn)
    .await?;
    sqlx::query(include_str!("../../queries/exercise_labels/insert.sql"))
        .bind(user_id)
        .bind(exercise_id)
        .bind(labels)
        .execute(&mut *conn)
        .await?;
    sqlx::query_scalar(include_str!(
        "../../queries/exercise_labels/of_exercise.sql"
    ))
    .bind(user_id)
    .bind(exercise_id)
    .fetch_one(&mut *conn)
    .await
}

pub async fn list(
    exec: impl PgExecutor<'_>,
    user_id: Uuid,
    limit: i64,
    offset: i64,
) -> sqlx::Result<Vec<LabelRow>> {
    sqlx::query_as(include_str!("../../queries/exercise_labels/list.sql"))
        .bind(user_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(exec)
        .await
}

pub async fn count(exec: impl PgExecutor<'_>, user_id: Uuid) -> sqlx::Result<i64> {
    sqlx::query_scalar(include_str!("../../queries/exercise_labels/count.sql"))
        .bind(user_id)
        .fetch_one(exec)
        .await
}
