use std::collections::HashMap;

use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgExecutor};
use uuid::Uuid;

#[derive(FromRow)]
pub struct CommentRow {
    pub id: Uuid,
    pub block_exercise_id: Uuid,
    pub author_id: Option<Uuid>,
    pub author_name: Option<String>,
    pub text: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// A comment with the workout it is on, to decide who may read and change it.
#[derive(FromRow)]
pub struct CommentAccessRow {
    #[sqlx(flatten)]
    pub comment: CommentRow,
    pub workout_id: Uuid,
    pub owner_id: Uuid,
}

/// The comments of each block exercise, oldest first.
pub async fn list(
    exec: impl PgExecutor<'_>,
    block_exercise_ids: &[Uuid],
) -> sqlx::Result<HashMap<Uuid, Vec<CommentRow>>> {
    let rows: Vec<CommentRow> = sqlx::query_as(include_str!("../../queries/comments/list.sql"))
        .bind(block_exercise_ids)
        .fetch_all(exec)
        .await?;
    let mut comments: HashMap<Uuid, Vec<CommentRow>> = HashMap::new();
    for row in rows {
        comments.entry(row.block_exercise_id).or_default().push(row);
    }
    Ok(comments)
}

pub async fn find(exec: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<Option<CommentAccessRow>> {
    sqlx::query_as(include_str!("../../queries/comments/find.sql"))
        .bind(id)
        .fetch_optional(exec)
        .await
}

pub async fn insert(
    exec: impl PgExecutor<'_>,
    block_exercise_id: Uuid,
    author_id: Uuid,
    text: &str,
) -> sqlx::Result<CommentRow> {
    sqlx::query_as(include_str!("../../queries/comments/insert.sql"))
        .bind(block_exercise_id)
        .bind(author_id)
        .bind(text)
        .fetch_one(exec)
        .await
}

/// Starts the threads of block `block_id`, logged from the planned block
/// `template_block_id`, with the notes its coach wrote for its exercises.
pub async fn insert_planned_notes(
    exec: impl PgExecutor<'_>,
    block_id: Uuid,
    template_block_id: Uuid,
) -> sqlx::Result<()> {
    sqlx::query(include_str!(
        "../../queries/comments/insert_planned_notes.sql"
    ))
    .bind(block_id)
    .bind(template_block_id)
    .execute(exec)
    .await?;
    Ok(())
}

pub async fn update(exec: impl PgExecutor<'_>, id: Uuid, text: &str) -> sqlx::Result<CommentRow> {
    sqlx::query_as(include_str!("../../queries/comments/update.sql"))
        .bind(id)
        .bind(text)
        .fetch_one(exec)
        .await
}

pub async fn delete(exec: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<()> {
    sqlx::query(include_str!("../../queries/comments/delete.sql"))
        .bind(id)
        .execute(exec)
        .await?;
    Ok(())
}
