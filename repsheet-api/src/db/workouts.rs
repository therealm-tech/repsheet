use std::collections::HashMap;

use chrono::NaiveDate;
use sqlx::{FromRow, PgConnection, PgExecutor};
use uuid::Uuid;

use crate::{
    db::{
        comments::{self, CommentRow},
        exercises::ExerciseSummaryRow,
    },
    domain::{Equipment, Grip, Locale, Mode, SetValues},
};

#[derive(FromRow)]
pub struct WorkoutRow {
    pub id: Uuid,
    pub template_id: Option<Uuid>,
    pub name: String,
    pub note: Option<String>,
    pub performed_on: NaiveDate,
    pub duration_minutes: Option<i32>,
}

#[derive(FromRow)]
pub struct WorkoutSummaryRow {
    pub id: Uuid,
    pub name: String,
    pub template_id: Option<Uuid>,
    pub performed_on: NaiveDate,
    pub duration_minutes: Option<i32>,
    pub block_count: i64,
}

#[derive(FromRow)]
pub struct BlockRow {
    pub id: Uuid,
    pub template_block_id: Option<Uuid>,
    pub position: i32,
    pub rest_seconds: Option<i32>,
}

#[derive(FromRow)]
struct WorkoutBlockRow {
    workout_id: Uuid,
    #[sqlx(flatten)]
    block: BlockRow,
}

#[derive(FromRow)]
struct BlockExerciseRow {
    block_exercise_id: Uuid,
    block_id: Uuid,
    #[sqlx(try_from = "String")]
    mode: Mode,
    #[sqlx(rename = "chosen_equipment", try_from = "String")]
    equipment: Equipment,
    #[sqlx(rename = "chosen_grip")]
    grip: Option<Grip>,
    #[sqlx(flatten)]
    exercise: ExerciseSummaryRow,
}

#[derive(FromRow)]
struct SetRow {
    block_exercise_id: Uuid,
    round: i32,
    reps: Option<i32>,
    weight_kg: Option<f64>,
    duration_seconds: Option<i32>,
    distance_meters: Option<i32>,
    warmup: bool,
}

pub struct LoadedBlock {
    pub row: BlockRow,
    pub exercises: Vec<LoadedBlockExercise>,
}

pub struct LoadedBlockExercise {
    pub id: Uuid,
    pub exercise: ExerciseSummaryRow,
    pub mode: Mode,
    pub equipment: Equipment,
    pub grip: Option<Grip>,
    pub comments: Vec<CommentRow>,
    pub sets: Vec<SetValues>,
}

pub struct WorkoutChanges<'a> {
    pub name: &'a str,
    pub note: Option<&'a str>,
    pub performed_on: NaiveDate,
    pub duration_minutes: Option<i32>,
}

pub struct NewBlockExercise<'a> {
    /// Set to keep the identity of one of the block's exercises on update.
    pub id: Option<Uuid>,
    pub exercise_id: Uuid,
    pub mode: Mode,
    pub equipment: Equipment,
    pub grip: Option<Grip>,
    pub sets: &'a [SetValues],
}

pub async fn list(
    exec: impl PgExecutor<'_>,
    user_id: Uuid,
    limit: i64,
    offset: i64,
) -> sqlx::Result<Vec<WorkoutSummaryRow>> {
    sqlx::query_as(include_str!("../../queries/workouts/list.sql"))
        .bind(user_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(exec)
        .await
}

pub async fn count(exec: impl PgExecutor<'_>, user_id: Uuid) -> sqlx::Result<i64> {
    sqlx::query_scalar(include_str!("../../queries/workouts/count.sql"))
        .bind(user_id)
        .fetch_one(exec)
        .await
}

pub struct NewWorkout<'a> {
    pub template_id: Option<Uuid>,
    pub name: &'a str,
    pub performed_on: NaiveDate,
    pub duration_minutes: Option<i32>,
}

pub async fn insert(
    exec: impl PgExecutor<'_>,
    user_id: Uuid,
    workout: &NewWorkout<'_>,
) -> sqlx::Result<WorkoutRow> {
    sqlx::query_as(include_str!("../../queries/workouts/insert.sql"))
        .bind(user_id)
        .bind(workout.template_id)
        .bind(workout.name)
        .bind(workout.performed_on)
        .bind(workout.duration_minutes)
        .fetch_one(exec)
        .await
}

pub async fn find(
    exec: impl PgExecutor<'_>,
    id: Uuid,
    user_id: Uuid,
) -> sqlx::Result<Option<WorkoutRow>> {
    sqlx::query_as(include_str!("../../queries/workouts/find.sql"))
        .bind(id)
        .bind(user_id)
        .fetch_optional(exec)
        .await
}

/// A workout as someone who may write it finds it, with its owner.
#[derive(FromRow)]
pub struct WritableWorkoutRow {
    #[sqlx(rename = "user_id")]
    pub owner_id: Uuid,
    #[sqlx(flatten)]
    pub workout: WorkoutRow,
}

/// The workout as `user_id` may write it: their own, or one of a profile
/// they manage.
pub async fn find_writable(
    exec: impl PgExecutor<'_>,
    id: Uuid,
    user_id: Uuid,
) -> sqlx::Result<Option<WritableWorkoutRow>> {
    sqlx::query_as(include_str!("../../queries/workouts/find_writable.sql"))
        .bind(id)
        .bind(user_id)
        .fetch_optional(exec)
        .await
}

/// The workout as `user_id` may read it: as its owner, or as a coach the
/// owner still has, who planned the session it was logged from or was shared
/// it.
pub async fn find_readable(
    exec: impl PgExecutor<'_>,
    id: Uuid,
    user_id: Uuid,
) -> sqlx::Result<Option<WorkoutRow>> {
    sqlx::query_as(include_str!("../../queries/workouts/find_readable.sql"))
        .bind(id)
        .bind(user_id)
        .fetch_optional(exec)
        .await
}

/// The workouts `athlete_id` shared with `coach_id`, newest first.
pub async fn list_shared(
    exec: impl PgExecutor<'_>,
    athlete_id: Uuid,
    coach_id: Uuid,
    limit: i64,
    offset: i64,
) -> sqlx::Result<Vec<WorkoutSummaryRow>> {
    sqlx::query_as(include_str!("../../queries/workouts/list_shared.sql"))
        .bind(athlete_id)
        .bind(coach_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(exec)
        .await
}

pub async fn count_shared(
    exec: impl PgExecutor<'_>,
    athlete_id: Uuid,
    coach_id: Uuid,
) -> sqlx::Result<i64> {
    sqlx::query_scalar(include_str!("../../queries/workouts/count_shared.sql"))
        .bind(athlete_id)
        .bind(coach_id)
        .fetch_one(exec)
        .await
}

pub async fn update(
    exec: impl PgExecutor<'_>,
    id: Uuid,
    user_id: Uuid,
    changes: &WorkoutChanges<'_>,
) -> sqlx::Result<Option<WorkoutRow>> {
    sqlx::query_as(include_str!("../../queries/workouts/update.sql"))
        .bind(id)
        .bind(user_id)
        .bind(changes.name)
        .bind(changes.note)
        .bind(changes.performed_on)
        .bind(changes.duration_minutes)
        .fetch_optional(exec)
        .await
}

pub async fn delete(exec: impl PgExecutor<'_>, id: Uuid, user_id: Uuid) -> sqlx::Result<()> {
    sqlx::query(include_str!("../../queries/workouts/delete.sql"))
        .bind(id)
        .bind(user_id)
        .execute(exec)
        .await?;
    Ok(())
}

/// The workouts logged from a template, newest first.
pub async fn list_by_template(
    exec: impl PgExecutor<'_>,
    template_id: Uuid,
    limit: i64,
    offset: i64,
) -> sqlx::Result<Vec<WorkoutRow>> {
    sqlx::query_as(include_str!("../../queries/workouts/list_by_template.sql"))
        .bind(template_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(exec)
        .await
}

pub async fn count_by_template(exec: impl PgExecutor<'_>, template_id: Uuid) -> sqlx::Result<i64> {
    sqlx::query_scalar(include_str!("../../queries/workouts/count_by_template.sql"))
        .bind(template_id)
        .fetch_one(exec)
        .await
}

/// The loaded blocks of several workouts, by workout.
pub async fn load_workouts_blocks(
    conn: &mut PgConnection,
    workout_ids: &[Uuid],
    locale: Locale,
) -> sqlx::Result<HashMap<Uuid, Vec<LoadedBlock>>> {
    let rows: Vec<WorkoutBlockRow> =
        sqlx::query_as(include_str!("../../queries/blocks/list_many.sql"))
            .bind(workout_ids)
            .fetch_all(&mut *conn)
            .await?;
    let owners: Vec<Uuid> = rows.iter().map(|r| r.workout_id).collect();
    let loaded = load_blocks(conn, rows.into_iter().map(|r| r.block).collect(), locale).await?;
    let mut by_workout: HashMap<Uuid, Vec<LoadedBlock>> = HashMap::new();
    for (workout_id, block) in owners.into_iter().zip(loaded) {
        by_workout.entry(workout_id).or_default().push(block);
    }
    Ok(by_workout)
}

pub async fn list_blocks(
    exec: impl PgExecutor<'_>,
    workout_id: Uuid,
) -> sqlx::Result<Vec<BlockRow>> {
    sqlx::query_as(include_str!("../../queries/blocks/list.sql"))
        .bind(workout_id)
        .fetch_all(exec)
        .await
}

/// Attaches the exercises and sets of each block, keeping the input order.
pub async fn load_blocks(
    conn: &mut PgConnection,
    blocks: Vec<BlockRow>,
    locale: Locale,
) -> sqlx::Result<Vec<LoadedBlock>> {
    let block_ids: Vec<Uuid> = blocks.iter().map(|b| b.id).collect();
    let exercise_rows: Vec<BlockExerciseRow> =
        sqlx::query_as(include_str!("../../queries/blocks/list_exercises.sql"))
            .bind(&block_ids)
            .bind(locale.as_str())
            .fetch_all(&mut *conn)
            .await?;
    let block_exercise_ids: Vec<Uuid> = exercise_rows.iter().map(|r| r.block_exercise_id).collect();
    let mut sets = load_sets(&mut *conn, &block_exercise_ids).await?;
    let mut comments = comments::list(conn, &block_exercise_ids).await?;

    let mut exercises_by_block: HashMap<Uuid, Vec<LoadedBlockExercise>> = HashMap::new();
    for row in exercise_rows {
        exercises_by_block
            .entry(row.block_id)
            .or_default()
            .push(LoadedBlockExercise {
                id: row.block_exercise_id,
                sets: sets.remove(&row.block_exercise_id).unwrap_or_default(),
                comments: comments.remove(&row.block_exercise_id).unwrap_or_default(),
                mode: row.mode,
                equipment: row.equipment,
                grip: row.grip,
                exercise: row.exercise,
            });
    }
    Ok(blocks
        .into_iter()
        .map(|row| LoadedBlock {
            exercises: exercises_by_block.remove(&row.id).unwrap_or_default(),
            row,
        })
        .collect())
}

/// The sets of each block exercise, ordered by round.
pub async fn load_sets(
    exec: impl PgExecutor<'_>,
    block_exercise_ids: &[Uuid],
) -> sqlx::Result<HashMap<Uuid, Vec<SetValues>>> {
    let rows: Vec<SetRow> = sqlx::query_as(include_str!("../../queries/blocks/list_sets.sql"))
        .bind(block_exercise_ids)
        .fetch_all(exec)
        .await?;
    let mut sets: HashMap<Uuid, Vec<SetValues>> = HashMap::new();
    for row in rows {
        sets.entry(row.block_exercise_id)
            .or_default()
            .push(SetValues {
                round: row.round,
                reps: row.reps,
                weight_kg: row.weight_kg,
                duration_seconds: row.duration_seconds,
                distance_meters: row.distance_meters,
                warmup: row.warmup,
            });
    }
    Ok(sets)
}

pub async fn insert_block(
    conn: &mut PgConnection,
    workout_id: Uuid,
    template_block_id: Option<Uuid>,
    rest_seconds: Option<i32>,
    exercises: &[NewBlockExercise<'_>],
) -> sqlx::Result<BlockRow> {
    let block: BlockRow = sqlx::query_as(include_str!("../../queries/blocks/insert.sql"))
        .bind(workout_id)
        .bind(template_block_id)
        .bind(rest_seconds)
        .fetch_one(&mut *conn)
        .await?;
    write_block_exercises(conn, block.id, exercises).await?;
    Ok(block)
}

/// The exercises of block `id` of workout `workout_id`, by block exercise id,
/// with the exercise each one is; `None` when the workout has no such block.
pub async fn block_exercise_ids(
    exec: impl PgExecutor<'_>,
    id: Uuid,
    workout_id: Uuid,
) -> sqlx::Result<Option<HashMap<Uuid, Uuid>>> {
    let rows: Vec<(Option<Uuid>, Option<Uuid>)> =
        sqlx::query_as(include_str!("../../queries/blocks/exercise_ids.sql"))
            .bind(id)
            .bind(workout_id)
            .fetch_all(exec)
            .await?;
    if rows.is_empty() {
        return Ok(None);
    }
    Ok(Some(
        rows.into_iter()
            .filter_map(|(id, exercise_id)| Some((id?, exercise_id?)))
            .collect(),
    ))
}

/// Replaces the block's exercises and sets. An exercise carrying the `id` of
/// one of the block's keeps its identity, and what hangs off it; the others
/// are created, and the block's exercises left out are deleted.
pub async fn update_block(
    conn: &mut PgConnection,
    id: Uuid,
    workout_id: Uuid,
    template_block_id: Option<Uuid>,
    rest_seconds: Option<i32>,
    exercises: &[NewBlockExercise<'_>],
) -> sqlx::Result<Option<BlockRow>> {
    let Some(block): Option<BlockRow> =
        sqlx::query_as(include_str!("../../queries/blocks/update.sql"))
            .bind(id)
            .bind(workout_id)
            .bind(template_block_id)
            .bind(rest_seconds)
            .fetch_optional(&mut *conn)
            .await?
    else {
        return Ok(None);
    };
    let kept: Vec<Uuid> = exercises.iter().filter_map(|e| e.id).collect();
    sqlx::query(include_str!(
        "../../queries/blocks/delete_exercises_except.sql"
    ))
    .bind(block.id)
    .bind(&kept)
    .execute(&mut *conn)
    .await?;
    write_block_exercises(conn, block.id, exercises).await?;
    Ok(Some(block))
}

pub async fn delete_block(
    exec: impl PgExecutor<'_>,
    id: Uuid,
    workout_id: Uuid,
) -> sqlx::Result<()> {
    sqlx::query(include_str!("../../queries/blocks/delete.sql"))
        .bind(id)
        .bind(workout_id)
        .execute(exec)
        .await?;
    Ok(())
}

async fn write_block_exercises(
    conn: &mut PgConnection,
    block_id: Uuid,
    exercises: &[NewBlockExercise<'_>],
) -> sqlx::Result<()> {
    for (position, exercise) in (1..).zip(exercises) {
        let block_exercise_id = if let Some(id) = exercise.id {
            sqlx::query(include_str!("../../queries/blocks/update_exercise.sql"))
                .bind(id)
                .bind(block_id)
                .bind::<i32>(position)
                .bind(exercise.mode.as_str())
                .bind(exercise.equipment.as_str())
                .bind(exercise.grip.map(Grip::as_str))
                .execute(&mut *conn)
                .await?;
            sqlx::query(include_str!("../../queries/blocks/delete_sets.sql"))
                .bind(id)
                .execute(&mut *conn)
                .await?;
            id
        } else {
            sqlx::query_scalar(include_str!("../../queries/blocks/insert_exercise.sql"))
                .bind(block_id)
                .bind::<i32>(position)
                .bind(exercise.exercise_id)
                .bind(exercise.mode.as_str())
                .bind(exercise.equipment.as_str())
                .bind(exercise.grip.map(Grip::as_str))
                .fetch_one(&mut *conn)
                .await?
        };
        let sets = exercise.sets;
        sqlx::query(include_str!("../../queries/blocks/insert_sets.sql"))
            .bind(block_exercise_id)
            .bind(sets.iter().map(|s| s.round).collect::<Vec<_>>())
            .bind(sets.iter().map(|s| s.reps).collect::<Vec<_>>())
            .bind(sets.iter().map(|s| s.weight_kg).collect::<Vec<_>>())
            .bind(sets.iter().map(|s| s.duration_seconds).collect::<Vec<_>>())
            .bind(sets.iter().map(|s| s.distance_meters).collect::<Vec<_>>())
            .bind(sets.iter().map(|s| s.warmup).collect::<Vec<_>>())
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}

/// The workout block exercise `id` belongs to.
pub async fn block_exercise_workout(
    exec: impl PgExecutor<'_>,
    id: Uuid,
) -> sqlx::Result<Option<Uuid>> {
    sqlx::query_scalar(include_str!("../../queries/blocks/exercise_workout.sql"))
        .bind(id)
        .fetch_optional(exec)
        .await
}
