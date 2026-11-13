use std::collections::{HashMap, HashSet};

use aide::axum::{
    ApiRouter,
    routing::{get_with, post_with, put_with},
};
use axum::{Json, extract::State, response::NoContent};
use chrono::NaiveDate;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use validator::{Validate, ValidationErrors};

use crate::{
    api::{
        AppState, authenticated,
        coaching::{Coached, require_coach, require_manager},
        comments::CommentResponse,
        exercises::{Chosen, EquipmentDto, ExerciseSummaryResponse, GripDto, ModeDto},
        extract::{Created, PathParams, ValidJson, ValidQuery, not_blank, trimmed},
        pagination::{MAX_PER_PAGE, PageQuery, PageResponse},
    },
    auth::AuthUser,
    db::{
        self,
        workouts::{
            LoadedBlock, NewBlockExercise, NewWorkout, WorkoutChanges, WorkoutRow,
            WorkoutSummaryRow,
        },
    },
    domain::{BlockKind, Locale, Mode, SetField, SetValues, SetViolation},
    error::{AppError, AppResult, FieldError},
};

pub fn routes() -> ApiRouter<AppState> {
    ApiRouter::new()
        .api_route(
            "/v1/workouts",
            get_with(list, |op| {
                authenticated(op)
                    .tag("Workouts")
                    .id("listWorkouts")
                    .summary("List workouts, newest first")
                    .description(
                        "Without `athleteId`, the caller's workouts. With it, the workouts \
                         that athlete shared with the caller, who must be their coach (403 \
                         otherwise), or all of them for a profile the caller manages.",
                    )
            })
            .post_with(create, |op| {
                authenticated(op)
                    .tag("Workouts")
                    .id("createWorkout")
                    .summary("Create a workout")
                    .description(
                        "Usually logged after the session, possibly following a template \
                         or a planned session. Blocks are added afterwards, all at once or \
                         one by one. With `athleteId`, it is logged for a profile the caller \
                         manages, who then writes it as their own.",
                    )
            }),
        )
        .api_route(
            "/v1/workouts/{workoutId}",
            get_with(get, |op| {
                authenticated(op)
                    .tag("Workouts")
                    .id("getWorkout")
                    .summary("Get a workout with its blocks")
                    .description(
                        "Readable by its owner and by the coach who manages the owner's \
                         profile, and by a coach the owner has while the workout is shared \
                         with them or was logged from a session they planned.",
                    )
            })
            .put_with(update, |op| {
                authenticated(op)
                    .tag("Workouts")
                    .id("updateWorkout")
                    .summary("Replace a workout's details")
                    .description("Blocks are left untouched.")
            })
            .delete_with(delete, |op| {
                authenticated(op)
                    .tag("Workouts")
                    .id("deleteWorkout")
                    .summary("Delete a workout and its blocks")
            }),
        )
        .api_route(
            "/v1/workouts/{workoutId}/blocks",
            post_with(create_block, |op| {
                authenticated(op)
                    .tag("Workouts")
                    .id("createBlock")
                    .summary("Log a block")
                    .description(
                        "Appends a block to the workout. Its kind follows from its \
                         number of exercises: 1 simple, 2 superset, 3 or more circuit. \
                         Logged from a planned block, each exercise's thread starts with \
                         the note the coach wrote for it, as a comment of theirs.",
                    )
            }),
        )
        .api_route(
            "/v1/workouts/{workoutId}/blocks/{blockId}",
            put_with(update_block, |op| {
                authenticated(op)
                    .tag("Workouts")
                    .id("updateBlock")
                    .summary("Replace a block's exercises and sets")
            })
            .delete_with(delete_block, |op| {
                authenticated(op)
                    .tag("Workouts")
                    .id("deleteBlock")
                    .summary("Delete a block")
            }),
        )
        .api_route(
            "/v1/workouts/{workoutId}/blocks/{blockId}/position",
            put_with(update_block_position, |op| {
                authenticated(op)
                    .tag("Workouts")
                    .id("updateBlockPosition")
                    .summary("Move a block")
                    .description(
                        "Puts the block at `position`, counted from 1, and renumbers the \
                         others from 1 in their order, so that positions stay contiguous and \
                         unique. Returns the workout with its blocks in their new order.",
                    )
            }),
        )
}

#[derive(Clone, Copy, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(rename = "BlockKind")]
pub enum BlockKindDto {
    Simple,
    Superset,
    Circuit,
}

impl From<BlockKind> for BlockKindDto {
    fn from(kind: BlockKind) -> Self {
        match kind {
            BlockKind::Simple => Self::Simple,
            BlockKind::Superset => Self::Superset,
            BlockKind::Circuit => Self::Circuit,
        }
    }
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetResponse {
    /// 1-based round of the block the set belongs to.
    pub round: i32,
    pub reps: Option<i32>,
    pub weight_kg: Option<f64>,
    pub duration_seconds: Option<i32>,
    pub distance_meters: Option<i32>,
    pub warmup: bool,
}

impl From<SetValues> for SetResponse {
    fn from(set: SetValues) -> Self {
        Self {
            round: set.round,
            reps: set.reps,
            weight_kg: set.weight_kg,
            duration_seconds: set.duration_seconds,
            distance_meters: set.distance_meters,
            warmup: set.warmup,
        }
    }
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkoutSummaryResponse {
    pub id: Uuid,
    pub name: String,
    pub template_id: Option<Uuid>,
    pub performed_on: NaiveDate,
    pub duration_minutes: Option<i32>,
    pub block_count: i64,
}

impl From<WorkoutSummaryRow> for WorkoutSummaryResponse {
    fn from(row: WorkoutSummaryRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            template_id: row.template_id,
            performed_on: row.performed_on,
            duration_minutes: row.duration_minutes,
            block_count: row.block_count,
        }
    }
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkoutResponse {
    pub id: Uuid,
    pub name: String,
    pub template_id: Option<Uuid>,
    pub note: Option<String>,
    /// The day the session took place on.
    pub performed_on: NaiveDate,
    pub duration_minutes: Option<i32>,
    pub blocks: Vec<BlockResponse>,
}

impl WorkoutResponse {
    pub(super) fn new(row: WorkoutRow, blocks: Vec<LoadedBlock>) -> Self {
        Self {
            id: row.id,
            name: row.name,
            template_id: row.template_id,
            note: row.note,
            performed_on: row.performed_on,
            duration_minutes: row.duration_minutes,
            blocks: blocks.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BlockResponse {
    pub id: Uuid,
    pub position: i32,
    pub kind: BlockKindDto,
    /// The template block this block was logged from, if any.
    pub template_block_id: Option<Uuid>,
    pub rest_seconds: Option<i32>,
    pub exercises: Vec<BlockExerciseResponse>,
}

impl From<LoadedBlock> for BlockResponse {
    fn from(block: LoadedBlock) -> Self {
        Self {
            id: block.row.id,
            position: block.row.position,
            kind: BlockKind::from_exercise_count(block.exercises.len()).into(),
            template_block_id: block.row.template_block_id,
            rest_seconds: block.row.rest_seconds,
            exercises: block
                .exercises
                .into_iter()
                .map(|e| BlockExerciseResponse {
                    id: e.id,
                    exercise: e.exercise.into(),
                    mode: e.mode.into(),
                    equipment: e.equipment.into(),
                    grip: e.grip.map(Into::into),
                    comments: e.comments.into_iter().map(Into::into).collect(),
                    sets: e.sets.into_iter().map(Into::into).collect(),
                })
                .collect(),
        }
    }
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BlockExerciseResponse {
    /// Tells apart the exercises of the block, which may hold the same
    /// exercise twice. Stays the same when the block is updated with this id,
    /// and so does the exercise's thread of comments.
    pub id: Uuid,
    pub exercise: ExerciseSummaryResponse,
    /// The mode the exercise is counted in for every round of the block.
    pub mode: ModeDto,
    /// The equipment the exercise is done with for every round of the block.
    pub equipment: EquipmentDto,
    /// The grip held for every round of the block; null when not recorded.
    pub grip: Option<GripDto>,
    /// Oldest first.
    pub comments: Vec<CommentResponse>,
    pub sets: Vec<SetResponse>,
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkoutRequest {
    /// A profile the caller manages, to log the workout for them; the
    /// caller's own workout when omitted. 403 for an athlete with an account.
    pub athlete_id: Option<Uuid>,
    #[validate(length(min = 1, max = 100), custom(function = not_blank))]
    pub name: String,
    pub template_id: Option<Uuid>,
    /// The day the session took place on, in the user's calendar.
    pub performed_on: NaiveDate,
    #[validate(range(min = 1, max = 1440))]
    pub duration_minutes: Option<i32>,
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWorkoutRequest {
    #[validate(length(min = 1, max = 100), custom(function = not_blank))]
    pub name: String,
    #[validate(length(max = 2000))]
    pub note: Option<String>,
    pub performed_on: NaiveDate,
    #[validate(range(min = 1, max = 1440))]
    pub duration_minutes: Option<i32>,
}

#[derive(Serialize, Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct SetRequest {
    #[validate(range(min = 1, max = 100))]
    pub round: i32,
    #[validate(range(min = 0, max = 1000))]
    pub reps: Option<i32>,
    /// Kilograms; negative for an assisted bodyweight exercise.
    #[validate(range(min = -500.0, max = 1000.0))]
    pub weight_kg: Option<f64>,
    #[validate(range(min = 0, max = 86_400))]
    pub duration_seconds: Option<i32>,
    #[validate(range(min = 0, max = 1_000_000))]
    pub distance_meters: Option<i32>,
    #[serde(default)]
    pub warmup: bool,
}

impl From<&SetRequest> for SetValues {
    fn from(set: &SetRequest) -> Self {
        Self {
            round: set.round,
            reps: set.reps,
            weight_kg: set.weight_kg,
            duration_seconds: set.duration_seconds,
            distance_meters: set.distance_meters,
            warmup: set.warmup,
        }
    }
}

#[derive(Serialize, Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct BlockExerciseRequest {
    /// On update, the id of one of the block's exercises, to keep its identity
    /// and its comments, whether `exerciseId` is still the same exercise or
    /// one that replaces it; a new one otherwise.
    pub id: Option<Uuid>,
    pub exercise_id: Uuid,
    /// One of the exercise's modes; its default mode when omitted. Each set
    /// carries the field of this mode, and a weight as the exercise's load
    /// rule says.
    pub mode: Option<ModeDto>,
    /// One of the exercise's equipment; its default equipment when omitted.
    pub equipment: Option<EquipmentDto>,
    /// One of the exercise's grips. Null or omitted records that the grip is
    /// not known, the only value an exercise offering no grip takes: unlike
    /// `mode` and `equipment`, it never defaults to the exercise's.
    pub grip: Option<GripDto>,
    #[validate(length(min = 1, max = 50), nested)]
    pub sets: Vec<SetRequest>,
}

/// The content of a block, shared by its creation and its full replacement.
#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct BlockBody {
    pub template_block_id: Option<Uuid>,
    #[validate(range(min = 0, max = 3600))]
    pub rest_seconds: Option<i32>,
    /// In the order they are performed within a round.
    #[validate(length(min = 1, max = 10), nested)]
    pub exercises: Vec<BlockExerciseRequest>,
}

#[derive(Deserialize, JsonSchema)]
pub struct CreateBlockRequest {
    #[serde(flatten)]
    pub block: BlockBody,
}

impl Validate for CreateBlockRequest {
    fn validate(&self) -> Result<(), ValidationErrors> {
        self.block.validate()
    }
}

#[derive(Deserialize, JsonSchema)]
pub struct UpdateBlockRequest {
    #[serde(flatten)]
    pub block: BlockBody,
}

impl Validate for UpdateBlockRequest {
    fn validate(&self) -> Result<(), ValidationErrors> {
        self.block.validate()
    }
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBlockPositionRequest {
    /// From 1 to the workout's number of blocks.
    #[validate(range(min = 1))]
    pub position: i32,
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct ListWorkoutsQuery {
    /// An athlete who has the caller as a coach, to list what they shared,
    /// or every workout of a profile the caller manages.
    pub athlete_id: Option<Uuid>,
    /// 1-based page number (default 1)
    #[validate(range(min = 1))]
    pub page: Option<u32>,
    /// Items per page (default 50, at most 100)
    #[validate(range(min = 1, max = MAX_PER_PAGE))]
    pub per_page: Option<u32>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkoutPath {
    pub workout_id: Uuid,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BlockPath {
    pub workout_id: Uuid,
    pub block_id: Uuid,
}

async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    ValidQuery(query): ValidQuery<ListWorkoutsQuery>,
) -> AppResult<Json<PageResponse<WorkoutSummaryResponse>>> {
    let paging = PageQuery {
        page: query.page,
        per_page: query.per_page,
    };
    let mut conn = state.pool.acquire().await?;
    let athlete = match query.athlete_id {
        Some(athlete_id) => Some((
            athlete_id,
            require_coach(&mut conn, &user, athlete_id).await?,
        )),
        None => None,
    };
    let (rows, total) = if let Some((athlete_id, Coached::Account)) = athlete {
        let rows = db::workouts::list_shared(
            &mut *conn,
            athlete_id,
            user.id,
            paging.limit(),
            paging.offset(),
        )
        .await?;
        (
            rows,
            db::workouts::count_shared(&mut *conn, athlete_id, user.id).await?,
        )
    } else {
        let owner_id = athlete.map_or(user.id, |(athlete_id, _)| athlete_id);
        let rows =
            db::workouts::list(&mut *conn, owner_id, paging.limit(), paging.offset()).await?;
        (rows, db::workouts::count(&mut *conn, owner_id).await?)
    };
    Ok(Json(paging.respond(
        rows.into_iter().map(Into::into).collect(),
        total,
    )))
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    ValidJson(request): ValidJson<CreateWorkoutRequest>,
) -> AppResult<Created<WorkoutResponse>> {
    let mut conn = state.pool.acquire().await?;
    let owner_id = match request.athlete_id {
        Some(athlete_id) => {
            require_manager(&mut conn, &user, athlete_id).await?;
            athlete_id
        }
        None => user.id,
    };
    if let Some(template_id) = request.template_id
        && db::templates::find(&mut *conn, template_id, owner_id)
            .await?
            .is_none()
    {
        return Err(AppError::Validation(vec![FieldError::new(
            "templateId",
            "unknown template",
        )]));
    }
    let workout = NewWorkout {
        template_id: request.template_id,
        name: request.name.trim(),
        performed_on: request.performed_on,
        duration_minutes: request.duration_minutes,
    };
    let row = db::workouts::insert(&mut *conn, owner_id, &workout).await?;
    tracing::debug!(workout_id = %row.id, template_id = ?row.template_id, "workout created");
    Ok(Created {
        location: format!("/v1/workouts/{}", row.id),
        body: WorkoutResponse::new(row, Vec::new()),
    })
}

async fn get(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<WorkoutPath>,
) -> AppResult<Json<WorkoutResponse>> {
    let mut conn = state.pool.acquire().await?;
    let row = db::workouts::find_readable(&mut *conn, path.workout_id, user.id)
        .await?
        .ok_or(AppError::NotFound)?;
    let blocks = db::workouts::list_blocks(&mut *conn, row.id).await?;
    let blocks = db::workouts::load_blocks(&mut conn, blocks, user.locale).await?;
    Ok(Json(WorkoutResponse::new(row, blocks)))
}

async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<WorkoutPath>,
    ValidJson(request): ValidJson<UpdateWorkoutRequest>,
) -> AppResult<Json<WorkoutResponse>> {
    let mut conn = state.pool.acquire().await?;
    let changes = WorkoutChanges {
        name: request.name.trim(),
        note: trimmed(request.note.as_deref()),
        performed_on: request.performed_on,
        duration_minutes: request.duration_minutes,
    };
    let row = db::workouts::update(&mut *conn, path.workout_id, user.id, &changes)
        .await?
        .ok_or(AppError::NotFound)?;
    let blocks = db::workouts::list_blocks(&mut *conn, row.id).await?;
    let blocks = db::workouts::load_blocks(&mut conn, blocks, user.locale).await?;
    Ok(Json(WorkoutResponse::new(row, blocks)))
}

async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<WorkoutPath>,
) -> AppResult<NoContent> {
    db::workouts::delete(&state.pool, path.workout_id, user.id).await?;
    Ok(NoContent)
}

async fn create_block(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<WorkoutPath>,
    ValidJson(request): ValidJson<CreateBlockRequest>,
) -> AppResult<Created<BlockResponse>> {
    let body = request.block;
    let mut tx = state.pool.begin().await?;
    let found = db::workouts::find_writable(&mut *tx, path.workout_id, user.id)
        .await?
        .ok_or(AppError::NotFound)?;
    let workout = found.workout;
    let sets = check_block(&mut tx, found.owner_id, user.locale, &body, &HashSet::new()).await?;
    let exercises = new_block_exercises(&body, &sets);
    let block = db::workouts::insert_block(
        &mut tx,
        workout.id,
        body.template_block_id,
        body.rest_seconds,
        &exercises,
    )
    .await?;
    if let Some(template_block_id) = body.template_block_id {
        db::comments::insert_planned_notes(&mut *tx, block.id, template_block_id).await?;
    }
    let mut loaded = db::workouts::load_blocks(&mut tx, vec![block], user.locale).await?;
    tx.commit().await?;
    let block = BlockResponse::from(loaded.remove(0));
    tracing::debug!(workout_id = %workout.id, block_id = %block.id, "block logged");
    Ok(Created {
        location: format!("/v1/workouts/{}/blocks/{}", workout.id, block.id),
        body: block,
    })
}

async fn update_block(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<BlockPath>,
    ValidJson(request): ValidJson<UpdateBlockRequest>,
) -> AppResult<Json<BlockResponse>> {
    let body = request.block;
    let mut tx = state.pool.begin().await?;
    let found = db::workouts::find_writable(&mut *tx, path.workout_id, user.id)
        .await?
        .ok_or(AppError::NotFound)?;
    let existing = db::workouts::block_exercise_ids(&mut *tx, path.block_id, path.workout_id)
        .await?
        .ok_or(AppError::NotFound)?;
    let sets = check_block(&mut tx, found.owner_id, user.locale, &body, &existing).await?;
    let exercises = new_block_exercises(&body, &sets);
    let block = db::workouts::update_block(
        &mut tx,
        path.block_id,
        path.workout_id,
        body.template_block_id,
        body.rest_seconds,
        &exercises,
    )
    .await?
    .ok_or(AppError::NotFound)?;
    let mut loaded = db::workouts::load_blocks(&mut tx, vec![block], user.locale).await?;
    tx.commit().await?;
    Ok(Json(loaded.remove(0).into()))
}

async fn delete_block(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<BlockPath>,
) -> AppResult<NoContent> {
    let mut conn = state.pool.acquire().await?;
    if db::workouts::find_writable(&mut *conn, path.workout_id, user.id)
        .await?
        .is_some()
    {
        db::workouts::delete_block(&mut *conn, path.block_id, path.workout_id).await?;
    }
    Ok(NoContent)
}

async fn update_block_position(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<BlockPath>,
    ValidJson(request): ValidJson<UpdateBlockPositionRequest>,
) -> AppResult<Json<WorkoutResponse>> {
    let mut tx = state.pool.begin().await?;
    let workout = db::workouts::find_writable(&mut *tx, path.workout_id, user.id)
        .await?
        .ok_or(AppError::NotFound)?
        .workout;
    let ids = db::workouts::lock_block_ids(&mut *tx, workout.id).await?;
    check_block_position(&ids, path.block_id, request.position)?;
    db::workouts::move_block(&mut *tx, path.block_id, workout.id, request.position).await?;
    let blocks = db::workouts::list_blocks(&mut *tx, workout.id).await?;
    let blocks = db::workouts::load_blocks(&mut tx, blocks, user.locale).await?;
    tx.commit().await?;
    tracing::debug!(
        workout_id = %workout.id,
        block_id = %path.block_id,
        position = request.position,
        "block moved"
    );
    Ok(Json(WorkoutResponse::new(workout, blocks)))
}

/// Checks that `block_id` is one of `ids`, the blocks it moves among, and that
/// `position` is within them.
pub(super) fn check_block_position(ids: &[Uuid], block_id: Uuid, position: i32) -> AppResult<()> {
    if !ids.contains(&block_id) {
        return Err(AppError::NotFound);
    }
    if usize::try_from(position).is_ok_and(|p| p > ids.len()) {
        return Err(AppError::Validation(vec![FieldError::new(
            "position",
            format!("at most {}, the number of blocks", ids.len()),
        )]));
    }
    Ok(())
}

/// The sets of a block exercise, with how they are done.
pub(super) struct CheckedExercise {
    pub chosen: Chosen,
    pub sets: Vec<SetValues>,
}

/// An exercise of a block and its sets, as a request gives them.
pub(super) struct ExerciseSets<'a> {
    pub exercise_id: Uuid,
    pub mode: Option<ModeDto>,
    pub equipment: Option<EquipmentDto>,
    pub grip: Option<GripDto>,
    pub sets: &'a [SetRequest],
}

/// Checks what field-level validation cannot: that the exercises and the
/// template block are ones the workout's owner may use, that each `id` names one of the block's
/// `existing` block exercises, at most once, and the exercises' sets as
/// [`check_sets`] does.
/// Returns the checked exercises, in request order.
async fn check_block(
    conn: &mut sqlx::PgConnection,
    owner_id: Uuid,
    locale: Locale,
    body: &BlockBody,
    existing: &HashSet<Uuid>,
) -> AppResult<Vec<CheckedExercise>> {
    let mut errors = Vec::new();
    let mut kept = HashSet::new();
    for (i, exercise) in body.exercises.iter().enumerate() {
        if let Some(id) = exercise.id
            && (!existing.contains(&id) || !kept.insert(id))
        {
            errors.push(FieldError::new(
                format!("exercises[{i}].id"),
                "not an exercise of this block",
            ));
        }
    }
    if let Some(template_block_id) = body.template_block_id
        && !db::templates::owns_block(&mut *conn, template_block_id, owner_id).await?
    {
        errors.push(FieldError::new("templateBlockId", "unknown template block"));
    }
    let exercises: Vec<ExerciseSets> = body
        .exercises
        .iter()
        .map(|e| ExerciseSets {
            exercise_id: e.exercise_id,
            mode: e.mode,
            equipment: e.equipment,
            grip: e.grip,
            sets: &e.sets,
        })
        .collect();
    let checked = check_sets(conn, owner_id, locale, &exercises, &mut errors).await?;
    if errors.is_empty() {
        Ok(checked)
    } else {
        Err(AppError::Validation(errors))
    }
}

/// Checks that each exercise is one `owner_id` can use, counted in one of its
/// modes and done with one of its equipment and grips, and that each set fits
/// that mode and the exercise's load rule. Adds what is wrong to `errors`, by
/// field path from `exercises[i]`; returns the checked exercises, in order.
pub(super) async fn check_sets(
    conn: &mut sqlx::PgConnection,
    owner_id: Uuid,
    locale: Locale,
    exercises: &[ExerciseSets<'_>],
    errors: &mut Vec<FieldError>,
) -> AppResult<Vec<CheckedExercise>> {
    let ids: Vec<Uuid> = exercises.iter().map(|e| e.exercise_id).collect();
    let known: HashMap<Uuid, _> = db::exercises::find_many(&mut *conn, &ids, owner_id, locale)
        .await?
        .into_iter()
        .map(|e| (e.id, e))
        .collect();

    let mut checked = Vec::with_capacity(exercises.len());
    for (i, exercise) in exercises.iter().enumerate() {
        let sets: Vec<SetValues> = exercise.sets.iter().map(Into::into).collect();
        let Some(known) = known.get(&exercise.exercise_id) else {
            errors.push(FieldError::new(
                format!("exercises[{i}].exerciseId"),
                "unknown exercise",
            ));
            continue;
        };
        let Some(chosen) = Chosen::check(
            known,
            exercise.mode,
            exercise.equipment,
            exercise.grip,
            &format!("exercises[{i}]"),
            errors,
        ) else {
            continue;
        };
        let mode = chosen.mode;
        for (j, set) in sets.iter().enumerate() {
            errors.extend(mode.check(known.load, set).into_iter().map(|violation| {
                let field = match violation {
                    SetViolation::Missing(field) | SetViolation::Unexpected(field) => field,
                };
                FieldError::new(
                    format!("exercises[{i}].sets[{j}].{}", set_field_name(field)),
                    violation_message(violation, mode),
                )
            }));
        }
        checked.push(CheckedExercise { chosen, sets });
    }
    Ok(checked)
}

fn violation_message(violation: SetViolation, mode: Mode) -> String {
    match violation {
        SetViolation::Missing(SetField::WeightKg) => {
            "required: the exercise needs a load".to_owned()
        }
        SetViolation::Unexpected(SetField::WeightKg) => {
            "not allowed: the exercise takes no load".to_owned()
        }
        SetViolation::Missing(_) => format!("required in {mode} mode"),
        SetViolation::Unexpected(_) => format!("not allowed in {mode} mode"),
    }
}

fn set_field_name(field: SetField) -> &'static str {
    match field {
        SetField::Reps => "reps",
        SetField::WeightKg => "weightKg",
        SetField::DurationSeconds => "durationSeconds",
        SetField::DistanceMeters => "distanceMeters",
    }
}

fn new_block_exercises<'a>(
    body: &BlockBody,
    checked: &'a [CheckedExercise],
) -> Vec<NewBlockExercise<'a>> {
    body.exercises
        .iter()
        .zip(checked)
        .map(|(exercise, checked)| NewBlockExercise {
            id: exercise.id,
            exercise_id: exercise.exercise_id,
            mode: checked.chosen.mode,
            equipment: checked.chosen.equipment,
            grip: checked.chosen.grip,
            sets: &checked.sets,
        })
        .collect()
}
