use std::collections::HashMap;

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
        exercises::{Chosen, EquipmentDto, ExerciseSummaryResponse, GripDto, ModeDto},
        extract::{Created, PathParams, ValidJson, ValidQuery, not_blank},
        pagination::{PageQuery, PageResponse},
    },
    auth::AuthUser,
    db::{
        self,
        workouts::{
            LoadedBlock, NewBlockExercise, NewWorkout, WorkoutChanges, WorkoutRow,
            WorkoutSummaryRow,
        },
    },
    domain::{BlockKind, Mode, SetField, SetValues, SetViolation},
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
            })
            .post_with(create, |op| {
                authenticated(op)
                    .tag("Workouts")
                    .id("createWorkout")
                    .summary("Create a workout")
                    .description(
                        "Usually logged after the session, possibly following a template. \
                         Blocks are added afterwards, all at once or one by one.",
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
                         number of exercises: 1 simple, 2 superset, 3 or more circuit.",
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
    fn new(row: WorkoutRow, blocks: Vec<LoadedBlock>) -> Self {
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
    /// exercise twice. Replacing the block gives its exercises new ids.
    pub id: Uuid,
    pub exercise: ExerciseSummaryResponse,
    /// The mode the exercise is counted in for every round of the block.
    pub mode: ModeDto,
    /// The equipment the exercise is done with for every round of the block.
    pub equipment: EquipmentDto,
    /// The grip held for every round of the block; null when not recorded.
    pub grip: Option<GripDto>,
    pub sets: Vec<SetResponse>,
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkoutRequest {
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
    ValidQuery(paging): ValidQuery<PageQuery>,
) -> AppResult<Json<PageResponse<WorkoutSummaryResponse>>> {
    let rows = db::workouts::list(&state.pool, user.id, paging.limit(), paging.offset()).await?;
    let total = db::workouts::count(&state.pool, user.id).await?;
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
    if let Some(template_id) = request.template_id
        && db::templates::find(&state.pool, template_id, user.id)
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
    let row = db::workouts::insert(&state.pool, user.id, &workout).await?;
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
    let row = db::workouts::find(&mut *conn, path.workout_id, user.id)
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
        note: request
            .note
            .as_deref()
            .map(str::trim)
            .filter(|n| !n.is_empty()),
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
    let workout = db::workouts::find(&mut *tx, path.workout_id, user.id)
        .await?
        .ok_or(AppError::NotFound)?;
    let sets = check_block(&mut tx, &user, &body).await?;
    let exercises = new_block_exercises(&body, &sets);
    let block = db::workouts::insert_block(
        &mut tx,
        workout.id,
        body.template_block_id,
        body.rest_seconds,
        &exercises,
    )
    .await?;
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
    db::workouts::find(&mut *tx, path.workout_id, user.id)
        .await?
        .ok_or(AppError::NotFound)?;
    let sets = check_block(&mut tx, &user, &body).await?;
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
    if db::workouts::find(&mut *conn, path.workout_id, user.id)
        .await?
        .is_some()
    {
        db::workouts::delete_block(&mut *conn, path.block_id, path.workout_id).await?;
    }
    Ok(NoContent)
}

/// The sets of a block exercise, with how they are done.
struct CheckedExercise {
    chosen: Chosen,
    sets: Vec<SetValues>,
}

/// Checks what field-level validation cannot: that the exercises and the
/// template block are the user's, that each exercise is counted in one of its
/// modes and done with one of its equipment and grips, and that each set fits
/// that mode and the exercise's load rule.
/// Returns the checked exercises, in request order.
async fn check_block(
    conn: &mut sqlx::PgConnection,
    user: &AuthUser,
    body: &BlockBody,
) -> AppResult<Vec<CheckedExercise>> {
    let mut errors = Vec::new();
    if let Some(template_block_id) = body.template_block_id
        && !db::templates::owns_block(&mut *conn, template_block_id, user.id).await?
    {
        errors.push(FieldError::new("templateBlockId", "unknown template block"));
    }

    let ids: Vec<Uuid> = body.exercises.iter().map(|e| e.exercise_id).collect();
    let known: HashMap<Uuid, _> = db::exercises::find_many(&mut *conn, &ids, user.id, user.locale)
        .await?
        .into_iter()
        .map(|e| (e.id, e))
        .collect();

    let mut checked = Vec::with_capacity(body.exercises.len());
    for (i, exercise) in body.exercises.iter().enumerate() {
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
            &mut errors,
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

    if errors.is_empty() {
        Ok(checked)
    } else {
        Err(AppError::Validation(errors))
    }
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
            exercise_id: exercise.exercise_id,
            mode: checked.chosen.mode,
            equipment: checked.chosen.equipment,
            grip: checked.chosen.grip,
            sets: &checked.sets,
        })
        .collect()
}
