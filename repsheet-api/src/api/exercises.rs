use aide::axum::{ApiRouter, routing::get_with};
use axum::{Json, extract::State, response::NoContent};
use chrono::NaiveDate;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use validator::{Validate, ValidationError};

use crate::{
    api::{
        AppState, authenticated,
        extract::{Created, PathParams, ValidJson, ValidQuery, not_blank},
        pagination::{MAX_PER_PAGE, PageQuery, PageResponse},
        search::search_text,
        workouts::{BlockKindDto, SetResponse},
    },
    auth::AuthUser,
    db::{
        self,
        exercises::{ExerciseRow, ExerciseSummaryRow, NewExercise, PerformanceFilter},
    },
    domain::{BlockKind, Equipment, EquipmentSet, Load, Mode, Modes},
    error::{AppError, AppResult, Conflict, FieldError, conflict_on_reference, conflict_on_unique},
};

pub fn routes() -> ApiRouter<AppState> {
    ApiRouter::new()
        .api_route(
            "/v1/exercises",
            get_with(list, |op| {
                authenticated(op)
                    .tag("Exercises")
                    .id("listExercises")
                    .summary("List the exercises the user can log")
            })
            .post_with(create, |op| {
                authenticated(op)
                    .tag("Exercises")
                    .id("createExercise")
                    .summary("Create an exercise")
                    .description(
                        "Creates a custom exercise, visible to its creator only, or with \
                         `builtIn` a catalog exercise visible to everyone (super admins only).",
                    )
            }),
        )
        .api_route(
            "/v1/exercises/{exerciseId}",
            get_with(get, |op| {
                authenticated(op)
                    .tag("Exercises")
                    .id("getExercise")
                    .summary("Get an exercise")
            })
            .put_with(update, |op| {
                authenticated(op)
                    .tag("Exercises")
                    .id("updateExercise")
                    .summary("Replace an exercise")
                    .description(
                        "Custom exercises by their owner, built-in ones by super admins. A mode \
                         or equipment the exercise was logged with cannot be removed; template \
                         exercises counted in another removed mode, or done with other removed \
                         equipment, move to the default one.",
                    )
            })
            .delete_with(delete, |op| {
                authenticated(op)
                    .tag("Exercises")
                    .id("deleteExercise")
                    .summary("Delete an exercise")
                    .description(
                        "Custom exercises by their owner, built-in ones by super admins. An \
                         exercise used in a workout or a template cannot be deleted.",
                    )
            }),
        )
        .api_route(
            "/v1/exercises/{exerciseId}/performances",
            get_with(list_performances, |op| {
                authenticated(op)
                    .tag("Exercises")
                    .id("listExercisePerformances")
                    .summary("List the times the user performed an exercise")
                    .description("Newest first, one item per block the exercise was logged in.")
            }),
        )
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(rename = "Mode")]
/// How a set is counted: `reps` records reps, `time` a duration, `distance` a
/// distance.
pub enum ModeDto {
    Reps,
    Time,
    Distance,
}

impl From<ModeDto> for Mode {
    fn from(mode: ModeDto) -> Self {
        match mode {
            ModeDto::Reps => Self::Reps,
            ModeDto::Time => Self::Time,
            ModeDto::Distance => Self::Distance,
        }
    }
}

impl From<Mode> for ModeDto {
    fn from(mode: Mode) -> Self {
        match mode {
            Mode::Reps => Self::Reps,
            Mode::Time => Self::Time,
            Mode::Distance => Self::Distance,
        }
    }
}

#[derive(Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(rename = "Load")]
/// Whether a set of the exercise carries a weight: `none` never, `optional`
/// an extra load (negative when assisted), `required` always.
pub enum LoadDto {
    None,
    Optional,
    Required,
}

impl From<LoadDto> for Load {
    fn from(load: LoadDto) -> Self {
        match load {
            LoadDto::None => Self::None,
            LoadDto::Optional => Self::Optional,
            LoadDto::Required => Self::Required,
        }
    }
}

impl From<Load> for LoadDto {
    fn from(load: Load) -> Self {
        match load {
            Load::None => Self::None,
            Load::Optional => Self::Optional,
            Load::Required => Self::Required,
        }
    }
}

fn mode_dtos(modes: &Modes) -> Vec<ModeDto> {
    modes.iter().map(Into::into).collect()
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(rename = "Equipment")]
pub enum EquipmentDto {
    Barbell,
    Dumbbell,
    Kettlebell,
    Machine,
    Cable,
    Bodyweight,
    Other,
}

impl From<EquipmentDto> for Equipment {
    fn from(equipment: EquipmentDto) -> Self {
        match equipment {
            EquipmentDto::Barbell => Self::Barbell,
            EquipmentDto::Dumbbell => Self::Dumbbell,
            EquipmentDto::Kettlebell => Self::Kettlebell,
            EquipmentDto::Machine => Self::Machine,
            EquipmentDto::Cable => Self::Cable,
            EquipmentDto::Bodyweight => Self::Bodyweight,
            EquipmentDto::Other => Self::Other,
        }
    }
}

impl From<Equipment> for EquipmentDto {
    fn from(equipment: Equipment) -> Self {
        match equipment {
            Equipment::Barbell => Self::Barbell,
            Equipment::Dumbbell => Self::Dumbbell,
            Equipment::Kettlebell => Self::Kettlebell,
            Equipment::Machine => Self::Machine,
            Equipment::Cable => Self::Cable,
            Equipment::Bodyweight => Self::Bodyweight,
            Equipment::Other => Self::Other,
        }
    }
}

fn equipment_dtos(equipment: &EquipmentSet) -> Vec<EquipmentDto> {
    equipment.iter().map(Into::into).collect()
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExerciseResponse {
    pub id: Uuid,
    /// The name in the user's language, or the other one when it has none.
    pub name: String,
    /// Every name of the exercise, to edit them.
    pub names: ExerciseNamesResponse,
    /// The ways a set of the exercise can be counted, in a fixed order.
    pub modes: Vec<ModeDto>,
    /// The mode a new block counts the exercise in.
    pub default_mode: ModeDto,
    pub load: LoadDto,
    /// The equipment the exercise can be done with, in a fixed order.
    pub equipment: Vec<EquipmentDto>,
    /// The equipment a new block does the exercise with.
    pub default_equipment: EquipmentDto,
    /// Reps and loads are counted per side.
    pub unilateral: bool,
    /// Created by the user rather than part of the built-in catalog.
    pub custom: bool,
    /// Day of the user's latest workout that includes the exercise.
    pub last_used_on: Option<NaiveDate>,
}

impl From<ExerciseRow> for ExerciseResponse {
    fn from(row: ExerciseRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            names: ExerciseNamesResponse {
                fr: row.name_fr,
                en: row.name_en,
            },
            modes: mode_dtos(&row.modes),
            default_mode: row.default_mode.into(),
            load: row.load.into(),
            equipment: equipment_dtos(&row.equipment),
            default_equipment: row.default_equipment.into(),
            unilateral: row.unilateral,
            custom: row.owner_id.is_some(),
            last_used_on: row.last_used_on,
        }
    }
}

/// The exercise as embedded in blocks.
#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExerciseSummaryResponse {
    pub id: Uuid,
    pub name: String,
    pub modes: Vec<ModeDto>,
    pub default_mode: ModeDto,
    pub load: LoadDto,
    pub equipment: Vec<EquipmentDto>,
    pub default_equipment: EquipmentDto,
    pub unilateral: bool,
}

impl From<ExerciseSummaryRow> for ExerciseSummaryResponse {
    fn from(row: ExerciseSummaryRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            modes: mode_dtos(&row.modes),
            default_mode: row.default_mode.into(),
            load: row.load.into(),
            equipment: equipment_dtos(&row.equipment),
            default_equipment: row.default_equipment.into(),
            unilateral: row.unilateral,
        }
    }
}

#[derive(Clone, Copy, Default, Deserialize, JsonSchema)]
#[schemars(rename = "ExerciseSort")]
pub enum ExerciseSortDto {
    #[default]
    #[serde(rename = "name")]
    Name,
    /// Most recently used first, never used last.
    #[serde(rename = "-lastUsedOn")]
    LastUsedDesc,
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct ListExercisesQuery {
    /// Case- and accent-insensitive search in the name
    #[validate(length(max = 100))]
    pub q: Option<String>,
    #[serde(default)]
    pub sort: ExerciseSortDto,
    /// 1-based page number (default 1)
    #[validate(range(min = 1))]
    pub page: Option<u32>,
    /// Items per page (default 50, at most 100)
    #[validate(range(min = 1, max = MAX_PER_PAGE))]
    pub per_page: Option<u32>,
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExerciseNamesResponse {
    pub fr: Option<String>,
    pub en: Option<String>,
}

/// The exercise's name per language: at least one, and both for a catalog
/// exercise.
#[derive(Serialize, Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
#[validate(schema(function = at_least_one_name))]
pub struct ExerciseNamesRequest {
    #[validate(length(min = 1, max = 100), custom(function = not_blank))]
    pub fr: Option<String>,
    #[validate(length(min = 1, max = 100), custom(function = not_blank))]
    pub en: Option<String>,
}

fn at_least_one_name(names: &ExerciseNamesRequest) -> Result<(), ValidationError> {
    if names.fr.is_none() && names.en.is_none() {
        let mut error = ValidationError::new("no_name");
        error.message = Some("give the exercise a name in at least one language".into());
        return Err(error);
    }
    Ok(())
}

impl ExerciseNamesRequest {
    fn fr(&self) -> Option<&str> {
        self.fr.as_deref().map(str::trim)
    }

    fn en(&self) -> Option<&str> {
        self.en.as_deref().map(str::trim)
    }

    /// A catalog exercise is shown to everyone, so it needs both names.
    fn require_both(&self) -> AppResult<()> {
        let missing: Vec<FieldError> = [("names.fr", &self.fr), ("names.en", &self.en)]
            .into_iter()
            .filter(|(_, name)| name.is_none())
            .map(|(field, _)| FieldError::new(field, "required for a catalog exercise"))
            .collect();
        if missing.is_empty() {
            Ok(())
        } else {
            Err(AppError::Validation(missing))
        }
    }
}

fn distinct_modes(modes: &[ModeDto]) -> Result<(), ValidationError> {
    if modes
        .iter()
        .enumerate()
        .any(|(i, mode)| modes[..i].contains(mode))
    {
        let mut error = ValidationError::new("duplicate_mode");
        error.message = Some("a mode appears twice".into());
        return Err(error);
    }
    Ok(())
}

/// The modes and the default mode of a create or update request; the default
/// mode must be one of the modes.
fn counting(modes: &[ModeDto], default_mode: ModeDto) -> AppResult<(Modes, Mode)> {
    let modes = Modes::new(modes.iter().copied().map(Mode::from)).ok_or_else(|| {
        AppError::Validation(vec![FieldError::new(
            "modes",
            "give at least one mode, each once",
        )])
    })?;
    let default_mode = Mode::from(default_mode);
    if !modes.contains(default_mode) {
        return Err(AppError::Validation(vec![FieldError::new(
            "defaultMode",
            "must be one of the modes",
        )]));
    }
    Ok((modes, default_mode))
}

fn distinct_equipment(equipment: &[EquipmentDto]) -> Result<(), ValidationError> {
    if equipment
        .iter()
        .enumerate()
        .any(|(i, kind)| equipment[..i].contains(kind))
    {
        let mut error = ValidationError::new("duplicate_equipment");
        error.message = Some("an equipment appears twice".into());
        return Err(error);
    }
    Ok(())
}

/// The equipment and the default equipment of a create or update request; the
/// default must be one of the equipment.
fn equipping(
    equipment: &[EquipmentDto],
    default_equipment: EquipmentDto,
) -> AppResult<(EquipmentSet, Equipment)> {
    let equipment =
        EquipmentSet::new(equipment.iter().copied().map(Equipment::from)).ok_or_else(|| {
            AppError::Validation(vec![FieldError::new(
                "equipment",
                "give at least one equipment, each once",
            )])
        })?;
    let default_equipment = Equipment::from(default_equipment);
    if !equipment.contains(default_equipment) {
        return Err(AppError::Validation(vec![FieldError::new(
            "defaultEquipment",
            "must be one of the equipment",
        )]));
    }
    Ok((equipment, default_equipment))
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct CreateExerciseRequest {
    #[validate(nested)]
    pub names: ExerciseNamesRequest,
    /// Distinct modes, at least one.
    #[validate(length(min = 1, max = 3), custom(function = distinct_modes))]
    pub modes: Vec<ModeDto>,
    /// One of `modes`.
    pub default_mode: ModeDto,
    pub load: LoadDto,
    /// Distinct equipment, at least one.
    #[validate(length(min = 1, max = 7), custom(function = distinct_equipment))]
    pub equipment: Vec<EquipmentDto>,
    /// One of `equipment`.
    pub default_equipment: EquipmentDto,
    #[serde(default)]
    pub unilateral: bool,
    /// Add the exercise to the built-in catalog (super admins only).
    #[serde(default)]
    pub built_in: bool,
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct UpdateExerciseRequest {
    #[validate(nested)]
    pub names: ExerciseNamesRequest,
    /// Distinct modes, at least one. A mode the exercise was logged in cannot
    /// be removed.
    #[validate(length(min = 1, max = 3), custom(function = distinct_modes))]
    pub modes: Vec<ModeDto>,
    /// One of `modes`.
    pub default_mode: ModeDto,
    /// Applies to the sets logged from now on.
    pub load: LoadDto,
    /// Distinct equipment, at least one. Equipment the exercise was logged
    /// with cannot be removed.
    #[validate(length(min = 1, max = 7), custom(function = distinct_equipment))]
    pub equipment: Vec<EquipmentDto>,
    /// One of `equipment`.
    pub default_equipment: EquipmentDto,
    pub unilateral: bool,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExercisePath {
    pub exercise_id: Uuid,
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct ListPerformancesQuery {
    /// Only the workouts that come before this one: by day, then by creation
    /// for a same day. What "last time" means when logging that workout.
    pub before_workout_id: Option<Uuid>,
    /// Only the blocks that counted the exercise in this mode.
    pub mode: Option<ModeDto>,
    /// Only the blocks that did the exercise with this equipment.
    pub equipment: Option<EquipmentDto>,
    /// 1-based page number (default 1)
    #[validate(range(min = 1))]
    pub page: Option<u32>,
    /// Items per page (default 50, at most 100)
    #[validate(range(min = 1, max = MAX_PER_PAGE))]
    pub per_page: Option<u32>,
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceResponse {
    pub workout_id: Uuid,
    pub workout_name: String,
    pub performed_on: NaiveDate,
    pub block_kind: BlockKindDto,
    /// The mode the exercise was counted in for this block.
    pub mode: ModeDto,
    /// The equipment the exercise was done with for this block.
    pub equipment: EquipmentDto,
    pub sets: Vec<SetResponse>,
}

async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    ValidQuery(query): ValidQuery<ListExercisesQuery>,
) -> AppResult<Json<PageResponse<ExerciseResponse>>> {
    let paging = PageQuery {
        page: query.page,
        per_page: query.per_page,
    };
    let search = search_text(query.q.as_deref());
    let by_last_use = matches!(query.sort, ExerciseSortDto::LastUsedDesc);
    let rows = db::exercises::list(
        &state.pool,
        user.id,
        search.as_deref(),
        by_last_use,
        user.locale,
        paging.limit(),
        paging.offset(),
    )
    .await?;
    let total = db::exercises::count(&state.pool, user.id, search.as_deref()).await?;
    Ok(Json(paging.respond(
        rows.into_iter().map(Into::into).collect(),
        total,
    )))
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    ValidJson(request): ValidJson<CreateExerciseRequest>,
) -> AppResult<Created<ExerciseResponse>> {
    let (modes, default_mode) = counting(&request.modes, request.default_mode)?;
    let (equipment, default_equipment) = equipping(&request.equipment, request.default_equipment)?;
    let exercise = NewExercise {
        name_fr: request.names.fr(),
        name_en: request.names.en(),
        modes,
        default_mode,
        load: request.load.into(),
        equipment,
        default_equipment,
        unilateral: request.unilateral,
    };
    let row = if request.built_in {
        user.require_super_admin()?;
        request.names.require_both()?;
        if db::exercises::builtin_name_taken(&state.pool, &exercise).await? {
            return Err(AppError::Conflict(Conflict::ExerciseNameTaken));
        }
        db::exercises::insert_builtin(&state.pool, &exercise, user.locale).await
    } else {
        if db::exercises::name_taken(&state.pool, user.id, &exercise).await? {
            return Err(AppError::Conflict(Conflict::ExerciseNameTaken));
        }
        db::exercises::insert(&state.pool, user.id, &exercise, user.locale).await
    }
    .map_err(|e| conflict_on_unique(e, Conflict::ExerciseNameTaken))?;
    tracing::debug!(exercise_id = %row.id, built_in = request.built_in, "exercise created");
    Ok(Created {
        location: format!("/v1/exercises/{}", row.id),
        body: row.into(),
    })
}

/// The exercise, provided the caller may change it: their own, or a built-in
/// one for a super admin.
async fn find_editable(state: &AppState, user: &AuthUser, id: Uuid) -> AppResult<ExerciseRow> {
    let row = db::exercises::find(&state.pool, id, user.id, user.locale)
        .await?
        .ok_or(AppError::NotFound)?;
    if row.owner_id.is_none() {
        user.require_super_admin()?;
    }
    Ok(row)
}

async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<ExercisePath>,
    ValidJson(request): ValidJson<UpdateExerciseRequest>,
) -> AppResult<Json<ExerciseResponse>> {
    let current = find_editable(&state, &user, path.exercise_id).await?;
    if current.owner_id.is_none() {
        request.names.require_both()?;
    }
    let (modes, default_mode) = counting(&request.modes, request.default_mode)?;
    let (equipment, default_equipment) = equipping(&request.equipment, request.default_equipment)?;
    let exercise = NewExercise {
        name_fr: request.names.fr(),
        name_en: request.names.en(),
        modes,
        default_mode,
        load: request.load.into(),
        equipment,
        default_equipment,
        unilateral: request.unilateral,
    };
    let removed: Vec<Mode> = current
        .modes
        .iter()
        .filter(|mode| !exercise.modes.contains(*mode))
        .collect();
    let removed_equipment: Vec<Equipment> = current
        .equipment
        .iter()
        .filter(|kind| !exercise.equipment.contains(*kind))
        .collect();
    let mut tx = state.pool.begin().await?;
    if !removed.is_empty() && db::exercises::has_sets(&mut *tx, current.id, &removed).await? {
        return Err(AppError::Conflict(Conflict::ModeLocked));
    }
    if !removed_equipment.is_empty()
        && db::exercises::equipment_used(&mut *tx, current.id, &removed_equipment).await?
    {
        return Err(AppError::Conflict(Conflict::EquipmentLocked));
    }
    if db::exercises::name_taken_except(&mut *tx, current.id, &exercise, current.owner_id).await? {
        return Err(AppError::Conflict(Conflict::ExerciseNameTaken));
    }
    let row = db::exercises::update(&mut *tx, current.id, &exercise, user.id, user.locale)
        .await
        .map_err(|e| conflict_on_unique(e, Conflict::ExerciseNameTaken))?;
    if !removed.is_empty() {
        db::templates::reset_modes(&mut *tx, row.id, &row.modes, row.default_mode).await?;
    }
    if !removed_equipment.is_empty() {
        db::templates::reset_equipment(&mut *tx, row.id, &row.equipment, row.default_equipment)
            .await?;
    }
    tx.commit().await?;
    tracing::debug!(
        exercise_id = %row.id,
        removed_modes = removed.len(),
        removed_equipment = removed_equipment.len(),
        "exercise updated"
    );
    Ok(Json(row.into()))
}

async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<ExercisePath>,
) -> AppResult<NoContent> {
    let current = match find_editable(&state, &user, path.exercise_id).await {
        Err(AppError::NotFound) => return Ok(NoContent),
        other => other?,
    };
    db::exercises::delete(&state.pool, current.id)
        .await
        .map_err(|e| conflict_on_reference(e, Conflict::ExerciseInUse))?;
    tracing::debug!(exercise_id = %current.id, "exercise deleted");
    Ok(NoContent)
}

async fn get(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<ExercisePath>,
) -> AppResult<Json<ExerciseResponse>> {
    let row = db::exercises::find(&state.pool, path.exercise_id, user.id, user.locale)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(row.into()))
}

async fn list_performances(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<ExercisePath>,
    ValidQuery(query): ValidQuery<ListPerformancesQuery>,
) -> AppResult<Json<PageResponse<PerformanceResponse>>> {
    db::exercises::find(&state.pool, path.exercise_id, user.id, user.locale)
        .await?
        .ok_or(AppError::NotFound)?;
    let paging = PageQuery {
        page: query.page,
        per_page: query.per_page,
    };
    let filter = PerformanceFilter {
        exercise_id: path.exercise_id,
        user_id: user.id,
        before_workout_id: query.before_workout_id,
        mode: query.mode.map(Into::into),
        equipment: query.equipment.map(Into::into),
    };
    let rows =
        db::exercises::list_performances(&state.pool, &filter, paging.limit(), paging.offset())
            .await?;
    let total = db::exercises::count_performances(&state.pool, &filter).await?;
    let ids: Vec<Uuid> = rows.iter().map(|r| r.block_exercise_id).collect();
    let mut sets = db::workouts::load_sets(&state.pool, &ids).await?;
    let items = rows
        .into_iter()
        .map(|row| PerformanceResponse {
            block_kind: BlockKind::from_exercise_count(
                usize::try_from(row.block_exercise_count).unwrap_or(1),
            )
            .into(),
            mode: row.mode.into(),
            equipment: row.equipment.into(),
            sets: sets
                .remove(&row.block_exercise_id)
                .unwrap_or_default()
                .into_iter()
                .map(Into::into)
                .collect(),
            workout_id: row.workout_id,
            workout_name: row.workout_name,
            performed_on: row.performed_on,
        })
        .collect();
    Ok(Json(paging.respond(items, total)))
}
