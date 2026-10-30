use chrono::NaiveDate;
use sqlx::{FromRow, PgExecutor};
use uuid::Uuid;

use crate::domain::{Equipment, Load, Locale, Mode, Modes};

#[derive(FromRow)]
pub struct ExerciseRow {
    pub id: Uuid,
    pub owner_id: Option<Uuid>,
    /// The name in the requested locale, or the other one when missing.
    pub name: String,
    pub name_fr: Option<String>,
    pub name_en: Option<String>,
    #[sqlx(try_from = "Vec<String>")]
    pub modes: Modes,
    #[sqlx(try_from = "String")]
    pub default_mode: Mode,
    #[sqlx(try_from = "String")]
    pub load: Load,
    #[sqlx(try_from = "String")]
    pub equipment: Equipment,
    pub unilateral: bool,
    pub last_used_on: Option<NaiveDate>,
}

#[derive(Clone, FromRow)]
pub struct ExerciseSummaryRow {
    pub id: Uuid,
    pub name: String,
    #[sqlx(try_from = "Vec<String>")]
    pub modes: Modes,
    #[sqlx(try_from = "String")]
    pub default_mode: Mode,
    #[sqlx(try_from = "String")]
    pub load: Load,
    #[sqlx(try_from = "String")]
    pub equipment: Equipment,
    pub unilateral: bool,
}

#[derive(FromRow)]
pub struct PerformanceRow {
    pub block_exercise_id: Uuid,
    pub workout_id: Uuid,
    pub workout_name: String,
    pub performed_on: NaiveDate,
    #[sqlx(try_from = "String")]
    pub mode: Mode,
    pub block_exercise_count: i64,
}

/// At least one of the names is set.
pub struct NewExercise<'a> {
    pub name_fr: Option<&'a str>,
    pub name_en: Option<&'a str>,
    pub modes: Modes,
    pub default_mode: Mode,
    pub load: Load,
    pub equipment: Equipment,
    pub unilateral: bool,
}

pub async fn list(
    exec: impl PgExecutor<'_>,
    user_id: Uuid,
    search: Option<&str>,
    by_last_use: bool,
    locale: Locale,
    limit: i64,
    offset: i64,
) -> sqlx::Result<Vec<ExerciseRow>> {
    sqlx::query_as(include_str!("../../queries/exercises/list.sql"))
        .bind(user_id)
        .bind(search)
        .bind(by_last_use)
        .bind(limit)
        .bind(offset)
        .bind(locale.as_str())
        .fetch_all(exec)
        .await
}

pub async fn count(
    exec: impl PgExecutor<'_>,
    user_id: Uuid,
    search: Option<&str>,
) -> sqlx::Result<i64> {
    sqlx::query_scalar(include_str!("../../queries/exercises/count.sql"))
        .bind(user_id)
        .bind(search)
        .fetch_one(exec)
        .await
}

pub async fn find(
    exec: impl PgExecutor<'_>,
    id: Uuid,
    user_id: Uuid,
    locale: Locale,
) -> sqlx::Result<Option<ExerciseRow>> {
    sqlx::query_as(include_str!("../../queries/exercises/find.sql"))
        .bind(id)
        .bind(user_id)
        .bind(locale.as_str())
        .fetch_optional(exec)
        .await
}

/// Whether an exercise visible to the user already has one of the names.
pub async fn name_taken(
    exec: impl PgExecutor<'_>,
    user_id: Uuid,
    exercise: &NewExercise<'_>,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(include_str!("../../queries/exercises/name_taken.sql"))
        .bind(user_id)
        .bind(exercise.name_fr)
        .bind(exercise.name_en)
        .fetch_one(exec)
        .await
}

pub async fn builtin_name_taken(
    exec: impl PgExecutor<'_>,
    exercise: &NewExercise<'_>,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(include_str!(
        "../../queries/exercises/name_taken_builtin.sql"
    ))
    .bind(exercise.name_fr)
    .bind(exercise.name_en)
    .fetch_one(exec)
    .await
}

/// Whether another exercise sharing the visibility of the one being renamed
/// (its owner's, or the built-in catalog) already has one of the names.
pub async fn name_taken_except(
    exec: impl PgExecutor<'_>,
    id: Uuid,
    exercise: &NewExercise<'_>,
    owner_id: Option<Uuid>,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(include_str!(
        "../../queries/exercises/name_taken_except.sql"
    ))
    .bind(id)
    .bind(exercise.name_fr)
    .bind(exercise.name_en)
    .bind(owner_id)
    .fetch_one(exec)
    .await
}

pub async fn insert(
    exec: impl PgExecutor<'_>,
    user_id: Uuid,
    exercise: &NewExercise<'_>,
    locale: Locale,
) -> sqlx::Result<ExerciseRow> {
    sqlx::query_as(include_str!("../../queries/exercises/insert.sql"))
        .bind(user_id)
        .bind(exercise.name_fr)
        .bind(exercise.name_en)
        .bind(exercise.modes.as_strs())
        .bind(exercise.default_mode.as_str())
        .bind(exercise.load.as_str())
        .bind(exercise.equipment.as_str())
        .bind(exercise.unilateral)
        .bind(locale.as_str())
        .fetch_one(exec)
        .await
}

pub async fn insert_builtin(
    exec: impl PgExecutor<'_>,
    exercise: &NewExercise<'_>,
    locale: Locale,
) -> sqlx::Result<ExerciseRow> {
    sqlx::query_as(include_str!("../../queries/exercises/insert_builtin.sql"))
        .bind(exercise.name_fr)
        .bind(exercise.name_en)
        .bind(exercise.modes.as_strs())
        .bind(exercise.default_mode.as_str())
        .bind(exercise.load.as_str())
        .bind(exercise.equipment.as_str())
        .bind(exercise.unilateral)
        .bind(locale.as_str())
        .fetch_one(exec)
        .await
}

/// `viewer_id` and `locale` are the user whose last use and language the
/// returned row reflects.
pub async fn update(
    exec: impl PgExecutor<'_>,
    id: Uuid,
    exercise: &NewExercise<'_>,
    viewer_id: Uuid,
    locale: Locale,
) -> sqlx::Result<ExerciseRow> {
    sqlx::query_as(include_str!("../../queries/exercises/update.sql"))
        .bind(id)
        .bind(exercise.name_fr)
        .bind(exercise.name_en)
        .bind(exercise.modes.as_strs())
        .bind(exercise.default_mode.as_str())
        .bind(exercise.load.as_str())
        .bind(exercise.equipment.as_str())
        .bind(exercise.unilateral)
        .bind(viewer_id)
        .bind(locale.as_str())
        .fetch_one(exec)
        .await
}

pub async fn delete(exec: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<()> {
    sqlx::query(include_str!("../../queries/exercises/delete.sql"))
        .bind(id)
        .execute(exec)
        .await?;
    Ok(())
}

/// Whether any user logged sets of the exercise in one of `modes`.
pub async fn has_sets(exec: impl PgExecutor<'_>, id: Uuid, modes: &[Mode]) -> sqlx::Result<bool> {
    sqlx::query_scalar(include_str!("../../queries/exercises/has_sets.sql"))
        .bind(id)
        .bind(modes.iter().map(|m| m.as_str()).collect::<Vec<_>>())
        .fetch_one(exec)
        .await
}

/// The exercises among `ids` that the user may use; unknown or foreign ids are
/// simply absent from the result.
pub async fn find_many(
    exec: impl PgExecutor<'_>,
    ids: &[Uuid],
    user_id: Uuid,
    locale: Locale,
) -> sqlx::Result<Vec<ExerciseSummaryRow>> {
    sqlx::query_as(include_str!("../../queries/exercises/find_many.sql"))
        .bind(ids)
        .bind(user_id)
        .bind(locale.as_str())
        .fetch_all(exec)
        .await
}

/// Which of a user's performances of an exercise to list.
pub struct PerformanceFilter {
    pub exercise_id: Uuid,
    pub user_id: Uuid,
    /// Keeps only the workouts that come before this one.
    pub before_workout_id: Option<Uuid>,
    /// Keeps only the blocks that counted the exercise in this mode.
    pub mode: Option<Mode>,
}

pub async fn list_performances(
    exec: impl PgExecutor<'_>,
    filter: &PerformanceFilter,
    limit: i64,
    offset: i64,
) -> sqlx::Result<Vec<PerformanceRow>> {
    sqlx::query_as(include_str!(
        "../../queries/exercises/list_performances.sql"
    ))
    .bind(filter.exercise_id)
    .bind(filter.user_id)
    .bind(limit)
    .bind(offset)
    .bind(filter.before_workout_id)
    .bind(filter.mode.map(Mode::as_str))
    .fetch_all(exec)
    .await
}

pub async fn count_performances(
    exec: impl PgExecutor<'_>,
    filter: &PerformanceFilter,
) -> sqlx::Result<i64> {
    sqlx::query_scalar(include_str!(
        "../../queries/exercises/count_performances.sql"
    ))
    .bind(filter.exercise_id)
    .bind(filter.user_id)
    .bind(filter.before_workout_id)
    .bind(filter.mode.map(Mode::as_str))
    .fetch_one(exec)
    .await
}
