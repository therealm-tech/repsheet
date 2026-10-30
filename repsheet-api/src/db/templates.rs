use std::collections::HashMap;

use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgConnection, PgExecutor};
use uuid::Uuid;

use crate::{
    db::exercises::ExerciseSummaryRow,
    domain::{Locale, Mode, Modes},
};

#[derive(FromRow)]
pub struct TemplateRow {
    pub id: Uuid,
    pub name: String,
    pub note: Option<String>,
    pub updated_at: DateTime<Utc>,
}

#[derive(FromRow)]
pub struct TemplateSummaryRow {
    pub id: Uuid,
    pub name: String,
    pub updated_at: DateTime<Utc>,
    pub block_count: i64,
}

#[derive(FromRow)]
pub struct TemplateBlockRow {
    pub id: Uuid,
    pub position: i32,
    pub rounds: Option<i32>,
    pub rest_seconds: Option<i32>,
}

#[derive(FromRow)]
struct TemplateBlockExerciseRow {
    template_block_id: Uuid,
    #[sqlx(try_from = "String")]
    mode: Mode,
    target: Option<String>,
    #[sqlx(flatten)]
    exercise: ExerciseSummaryRow,
}

pub struct LoadedTemplateBlock {
    pub row: TemplateBlockRow,
    pub exercises: Vec<LoadedTemplateExercise>,
}

pub struct LoadedTemplateExercise {
    pub exercise: ExerciseSummaryRow,
    pub mode: Mode,
    pub target: Option<String>,
}

pub struct TemplateExerciseInput<'a> {
    pub exercise_id: Uuid,
    pub mode: Mode,
    pub target: Option<&'a str>,
}

pub struct TemplateBlockInput<'a> {
    /// Set to keep the identity of an existing block on update.
    pub id: Option<Uuid>,
    pub rounds: Option<i32>,
    pub rest_seconds: Option<i32>,
    pub exercises: Vec<TemplateExerciseInput<'a>>,
}

pub async fn list(
    exec: impl PgExecutor<'_>,
    user_id: Uuid,
    limit: i64,
    offset: i64,
) -> sqlx::Result<Vec<TemplateSummaryRow>> {
    sqlx::query_as(include_str!("../../queries/templates/list.sql"))
        .bind(user_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(exec)
        .await
}

pub async fn count(exec: impl PgExecutor<'_>, user_id: Uuid) -> sqlx::Result<i64> {
    sqlx::query_scalar(include_str!("../../queries/templates/count.sql"))
        .bind(user_id)
        .fetch_one(exec)
        .await
}

pub async fn find(
    exec: impl PgExecutor<'_>,
    id: Uuid,
    user_id: Uuid,
) -> sqlx::Result<Option<TemplateRow>> {
    sqlx::query_as(include_str!("../../queries/templates/find.sql"))
        .bind(id)
        .bind(user_id)
        .fetch_optional(exec)
        .await
}

pub async fn insert(
    conn: &mut PgConnection,
    user_id: Uuid,
    name: &str,
    note: Option<&str>,
    blocks: &[TemplateBlockInput<'_>],
) -> sqlx::Result<TemplateRow> {
    let template: TemplateRow = sqlx::query_as(include_str!("../../queries/templates/insert.sql"))
        .bind(user_id)
        .bind(name)
        .bind(note)
        .fetch_one(&mut *conn)
        .await?;
    write_blocks(conn, template.id, blocks).await?;
    Ok(template)
}

/// Updates the template and reconciles its blocks: blocks carrying a known id
/// are updated in place, the others are created, and the missing ones deleted.
/// Callers check beforehand that every given id belongs to the template.
pub async fn update(
    conn: &mut PgConnection,
    id: Uuid,
    user_id: Uuid,
    name: &str,
    note: Option<&str>,
    blocks: &[TemplateBlockInput<'_>],
) -> sqlx::Result<Option<TemplateRow>> {
    let Some(template): Option<TemplateRow> =
        sqlx::query_as(include_str!("../../queries/templates/update.sql"))
            .bind(id)
            .bind(user_id)
            .bind(name)
            .bind(note)
            .fetch_optional(&mut *conn)
            .await?
    else {
        return Ok(None);
    };
    let kept: Vec<Uuid> = blocks.iter().filter_map(|b| b.id).collect();
    sqlx::query(include_str!(
        "../../queries/templates/delete_blocks_except.sql"
    ))
    .bind(template.id)
    .bind(&kept)
    .execute(&mut *conn)
    .await?;
    write_blocks(conn, template.id, blocks).await?;
    Ok(Some(template))
}

pub async fn delete(exec: impl PgExecutor<'_>, id: Uuid, user_id: Uuid) -> sqlx::Result<()> {
    sqlx::query(include_str!("../../queries/templates/delete.sql"))
        .bind(id)
        .bind(user_id)
        .execute(exec)
        .await?;
    Ok(())
}

pub async fn block_ids(exec: impl PgExecutor<'_>, template_id: Uuid) -> sqlx::Result<Vec<Uuid>> {
    sqlx::query_scalar(include_str!("../../queries/templates/block_ids.sql"))
        .bind(template_id)
        .fetch_all(exec)
        .await
}

pub async fn owns_block(
    exec: impl PgExecutor<'_>,
    template_block_id: Uuid,
    user_id: Uuid,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(include_str!("../../queries/templates/owned_block.sql"))
        .bind(template_block_id)
        .bind(user_id)
        .fetch_one(exec)
        .await
}

/// Points the template exercises counted in a mode the exercise no longer has
/// at its default mode.
pub async fn reset_modes(
    exec: impl PgExecutor<'_>,
    exercise_id: Uuid,
    modes: &Modes,
    default_mode: Mode,
) -> sqlx::Result<()> {
    sqlx::query(include_str!("../../queries/templates/reset_modes.sql"))
        .bind(exercise_id)
        .bind(default_mode.as_str())
        .bind(modes.as_strs())
        .execute(exec)
        .await?;
    Ok(())
}

pub async fn load_blocks(
    conn: &mut PgConnection,
    template_id: Uuid,
    locale: Locale,
) -> sqlx::Result<Vec<LoadedTemplateBlock>> {
    let blocks: Vec<TemplateBlockRow> =
        sqlx::query_as(include_str!("../../queries/templates/list_blocks.sql"))
            .bind(template_id)
            .fetch_all(&mut *conn)
            .await?;
    let block_ids: Vec<Uuid> = blocks.iter().map(|b| b.id).collect();
    let rows: Vec<TemplateBlockExerciseRow> = sqlx::query_as(include_str!(
        "../../queries/templates/list_block_exercises.sql"
    ))
    .bind(&block_ids)
    .bind(locale.as_str())
    .fetch_all(&mut *conn)
    .await?;
    let mut exercises_by_block: HashMap<Uuid, Vec<LoadedTemplateExercise>> = HashMap::new();
    for row in rows {
        exercises_by_block
            .entry(row.template_block_id)
            .or_default()
            .push(LoadedTemplateExercise {
                mode: row.mode,
                target: row.target,
                exercise: row.exercise,
            });
    }
    Ok(blocks
        .into_iter()
        .map(|row| LoadedTemplateBlock {
            exercises: exercises_by_block.remove(&row.id).unwrap_or_default(),
            row,
        })
        .collect())
}

async fn write_blocks(
    conn: &mut PgConnection,
    template_id: Uuid,
    blocks: &[TemplateBlockInput<'_>],
) -> sqlx::Result<()> {
    for (position, block) in (1..).zip(blocks) {
        let block_id = if let Some(id) = block.id {
            sqlx::query(include_str!("../../queries/templates/update_block.sql"))
                .bind(id)
                .bind(template_id)
                .bind::<i32>(position)
                .bind(block.rounds)
                .bind(block.rest_seconds)
                .execute(&mut *conn)
                .await?;
            sqlx::query(include_str!(
                "../../queries/templates/delete_block_exercises.sql"
            ))
            .bind(id)
            .execute(&mut *conn)
            .await?;
            id
        } else {
            sqlx::query_scalar(include_str!("../../queries/templates/insert_block.sql"))
                .bind(template_id)
                .bind::<i32>(position)
                .bind(block.rounds)
                .bind(block.rest_seconds)
                .fetch_one(&mut *conn)
                .await?
        };
        let positions: Vec<i32> = (1..).take(block.exercises.len()).collect();
        sqlx::query(include_str!(
            "../../queries/templates/insert_block_exercises.sql"
        ))
        .bind(block_id)
        .bind(&positions)
        .bind(
            block
                .exercises
                .iter()
                .map(|e| e.exercise_id)
                .collect::<Vec<_>>(),
        )
        .bind(
            block
                .exercises
                .iter()
                .map(|e| e.mode.as_str())
                .collect::<Vec<_>>(),
        )
        .bind(block.exercises.iter().map(|e| e.target).collect::<Vec<_>>())
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}
