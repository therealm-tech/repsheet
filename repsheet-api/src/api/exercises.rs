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
        coaching::{Coached, require_coach},
        comments::CommentResponse,
        exercise_labels::MAX_LABEL_LENGTH,
        extract::{Created, PathParams, ValidJson, ValidQuery, not_blank, trimmed},
        pagination::{MAX_PER_PAGE, PageQuery, PageResponse},
        search::search_text,
        workouts::{BlockKindDto, SetResponse},
    },
    auth::AuthUser,
    db::{
        self,
        exercises::{
            ExerciseFilter, ExerciseRow, ExerciseSummaryRow, GripFilter, NewExercise,
            PerformanceFilter,
        },
    },
    domain::{BlockKind, Choices, Equipment, Grip, Load, Mode, TextEnum},
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
                        "Custom exercises by their owner, built-in ones by super admins. A mode, \
                         equipment or grip the exercise was logged with cannot be removed; \
                         template exercises counted in another removed mode, or done with other \
                         removed equipment or grip, move to the default one, or to no grip when \
                         the exercise offers none.",
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
                    .description(
                        "Newest first, one item per block the exercise was logged in. With \
                         `athleteId`, the times that athlete performed it in the workouts the \
                         caller reads as their coach (403 when the caller is not): shared \
                         with them, or logged from a session they planned; all of them for a \
                         profile the caller manages.",
                    )
            }),
        )
}

/// Converts both ways between a wire enum and the domain enum with the same
/// variants.
macro_rules! mirror_enum {
    ($dto:ident, $domain:ident, [$($variant:ident),+ $(,)?]) => {
        impl From<$dto> for $domain {
            fn from(value: $dto) -> Self {
                match value {
                    $($dto::$variant => Self::$variant),+
                }
            }
        }

        impl From<$domain> for $dto {
            fn from(value: $domain) -> Self {
                match value {
                    $($domain::$variant => Self::$variant),+
                }
            }
        }
    };
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

mirror_enum!(ModeDto, Mode, [Reps, Time, Distance]);

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

mirror_enum!(LoadDto, Load, [None, Optional, Required]);

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

mirror_enum!(
    EquipmentDto,
    Equipment,
    [
        Barbell, Dumbbell, Kettlebell, Machine, Cable, Bodyweight, Other
    ]
);

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(rename = "Grip")]
/// How the hands hold the bar or the handles: `pronation` palms facing down
/// or away, `supination` palms facing up or towards the body, `neutral` palms
/// facing each other, `mixed` one hand each way.
pub enum GripDto {
    Pronation,
    Supination,
    Neutral,
    Mixed,
}

mirror_enum!(GripDto, Grip, [Pronation, Supination, Neutral, Mixed]);

#[derive(Clone, Copy, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(rename = "GripFilter")]
/// A grip, or `none` for the blocks that recorded no grip.
pub enum GripFilterDto {
    Pronation,
    Supination,
    Neutral,
    Mixed,
    None,
}

impl From<GripFilterDto> for GripFilter {
    fn from(filter: GripFilterDto) -> Self {
        match filter {
            GripFilterDto::Pronation => Self::Held(Grip::Pronation),
            GripFilterDto::Supination => Self::Held(Grip::Supination),
            GripFilterDto::Neutral => Self::Held(Grip::Neutral),
            GripFilterDto::Mixed => Self::Held(Grip::Mixed),
            GripFilterDto::None => Self::Unrecorded,
        }
    }
}

fn dtos<T: TextEnum, D: From<T>>(choices: &Choices<T>) -> Vec<D> {
    choices.iter().map(Into::into).collect()
}

/// How a block or template exercise is done, among what its exercise offers.
pub struct Chosen {
    pub mode: Mode,
    pub equipment: Equipment,
    pub grip: Option<Grip>,
}

impl Chosen {
    /// What a block or template exercise asks for: the mode and the
    /// equipment default to the exercise's own, while a missing grip stays
    /// unknown. Files an error under `path` for each value the exercise does
    /// not offer.
    pub fn check(
        exercise: &ExerciseSummaryRow,
        mode: Option<ModeDto>,
        equipment: Option<EquipmentDto>,
        grip: Option<GripDto>,
        path: &str,
        errors: &mut Vec<FieldError>,
    ) -> Option<Self> {
        let mode = mode.map_or(exercise.default_mode, Mode::from);
        let equipment = equipment.map_or(exercise.default_equipment, Equipment::from);
        let grip = grip.map(Grip::from);
        let before = errors.len();
        errors.extend(
            [
                (
                    exercise.modes.contains(mode),
                    "mode",
                    "not a mode of the exercise",
                ),
                (
                    exercise.equipment.contains(equipment),
                    "equipment",
                    "not an equipment of the exercise",
                ),
                (
                    grip.is_none_or(|grip| exercise.grips.contains(grip)),
                    "grip",
                    "not a grip of the exercise",
                ),
            ]
            .into_iter()
            .filter(|(offered, ..)| !offered)
            .map(|(_, field, message)| FieldError::new(format!("{path}.{field}"), message)),
        );
        (errors.len() == before).then_some(Self {
            mode,
            equipment,
            grip,
        })
    }
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
    /// The grips the exercise can be done with, in a fixed order; none when
    /// the grip does not apply to it.
    pub grips: Vec<GripDto>,
    /// The grip a new block holds; null exactly when `grips` is empty.
    pub default_grip: Option<GripDto>,
    /// Reps and loads are counted per side.
    pub unilateral: bool,
    /// Created by the user rather than part of the built-in catalog.
    pub custom: bool,
    /// The user's own labels on the exercise, in alphabetical order; nobody
    /// else sees them.
    pub labels: Vec<String>,
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
            modes: dtos(&row.modes),
            default_mode: row.default_mode.into(),
            load: row.load.into(),
            equipment: dtos(&row.equipment),
            default_equipment: row.default_equipment.into(),
            grips: dtos(&row.grips),
            default_grip: row.default_grip.map(Into::into),
            unilateral: row.unilateral,
            custom: row.owner_id.is_some(),
            labels: row.labels,
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
    pub grips: Vec<GripDto>,
    pub default_grip: Option<GripDto>,
    pub unilateral: bool,
}

impl From<ExerciseSummaryRow> for ExerciseSummaryResponse {
    fn from(row: ExerciseSummaryRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            modes: dtos(&row.modes),
            default_mode: row.default_mode.into(),
            load: row.load.into(),
            equipment: dtos(&row.equipment),
            default_equipment: row.default_equipment.into(),
            grips: dtos(&row.grips),
            default_grip: row.default_grip.map(Into::into),
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
    /// Only the exercises the user put this label on, compared ignoring case
    /// and accents
    #[validate(length(max = MAX_LABEL_LENGTH))]
    pub label: Option<String>,
    /// Only the custom exercises the user created, not the catalog (default
    /// false)
    #[serde(default)]
    pub mine: bool,
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

fn distinct<T: PartialEq>(values: &[T]) -> Result<(), ValidationError> {
    if values
        .iter()
        .enumerate()
        .any(|(i, value)| values[..i].contains(value))
    {
        let mut error = ValidationError::new("duplicate");
        error.message = Some("a value appears twice".into());
        return Err(error);
    }
    Ok(())
}

/// The values an exercise offers for one choice, from a create or update
/// request, checked against the default one the request gives with them.
fn offered<T: TextEnum>(
    values: impl IntoIterator<Item = impl Into<T>>,
    default: Option<impl Into<T>>,
    field: &str,
    default_field: &str,
) -> AppResult<Choices<T>> {
    let choices = Choices::new(values.into_iter().map(Into::into)).ok_or_else(|| {
        AppError::Validation(vec![FieldError::new(field, "give each value once")])
    })?;
    let default = default.map(Into::into);
    if !choices.admits_default(default) {
        let message = if default.is_some() {
            format!("must be one of `{field}`")
        } else {
            format!("required when `{field}` is not empty")
        };
        return Err(AppError::Validation(vec![FieldError::new(
            default_field,
            message,
        )]));
    }
    Ok(choices)
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct CreateExerciseRequest {
    #[validate(nested)]
    pub names: ExerciseNamesRequest,
    /// Distinct modes, at least one.
    #[validate(length(min = 1, max = 3), custom(function = distinct))]
    pub modes: Vec<ModeDto>,
    /// One of `modes`.
    pub default_mode: ModeDto,
    pub load: LoadDto,
    /// Distinct equipment, at least one.
    #[validate(length(min = 1, max = 7), custom(function = distinct))]
    pub equipment: Vec<EquipmentDto>,
    /// One of `equipment`.
    pub default_equipment: EquipmentDto,
    /// Distinct grips; empty when the grip does not apply to the exercise.
    #[validate(length(max = 4), custom(function = distinct))]
    pub grips: Vec<GripDto>,
    /// One of `grips`; null or omitted exactly when `grips` is empty.
    pub default_grip: Option<GripDto>,
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
    #[validate(length(min = 1, max = 3), custom(function = distinct))]
    pub modes: Vec<ModeDto>,
    /// One of `modes`.
    pub default_mode: ModeDto,
    /// Applies to the sets logged from now on.
    pub load: LoadDto,
    /// Distinct equipment, at least one. Equipment the exercise was logged
    /// with cannot be removed.
    #[validate(length(min = 1, max = 7), custom(function = distinct))]
    pub equipment: Vec<EquipmentDto>,
    /// One of `equipment`.
    pub default_equipment: EquipmentDto,
    /// Distinct grips; empty when the grip does not apply to the exercise. A
    /// grip the exercise was logged with cannot be removed.
    #[validate(length(max = 4), custom(function = distinct))]
    pub grips: Vec<GripDto>,
    /// One of `grips`; null or omitted exactly when `grips` is empty.
    pub default_grip: Option<GripDto>,
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
    /// An athlete who has the caller as a coach, whose performances to list
    /// instead of the caller's.
    pub athlete_id: Option<Uuid>,
    /// Only the workouts that come before this one: by day, then by creation
    /// for a same day. What "last time" means when logging that workout. With
    /// `athleteId`, only for a profile the caller manages.
    pub before_workout_id: Option<Uuid>,
    /// Only the blocks that counted the exercise in this mode.
    pub mode: Option<ModeDto>,
    /// Only the blocks that did the exercise with this equipment.
    pub equipment: Option<EquipmentDto>,
    /// Only the blocks that held this grip, or with `none` only those that
    /// recorded no grip. Every block, whatever its grip, when omitted.
    pub grip: Option<GripFilterDto>,
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
    /// The block exercise this performance is, unique in the list.
    pub block_exercise_id: Uuid,
    pub workout_id: Uuid,
    pub workout_name: String,
    pub performed_on: NaiveDate,
    pub block_kind: BlockKindDto,
    /// The mode the exercise was counted in for this block.
    pub mode: ModeDto,
    /// The equipment the exercise was done with for this block.
    pub equipment: EquipmentDto,
    /// The grip held for this block; null when not recorded.
    pub grip: Option<GripDto>,
    /// The thread on the exercise in this block, oldest first.
    pub comments: Vec<CommentResponse>,
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
    let filter = ExerciseFilter {
        user_id: user.id,
        search: search.as_deref(),
        label: trimmed(query.label.as_deref()),
        mine: query.mine,
    };
    let by_last_use = matches!(query.sort, ExerciseSortDto::LastUsedDesc);
    let rows = db::exercises::list(
        &state.pool,
        &filter,
        by_last_use,
        user.locale,
        paging.limit(),
        paging.offset(),
    )
    .await?;
    let total = db::exercises::count(&state.pool, &filter).await?;
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
    let exercise = NewExercise {
        name_fr: request.names.fr(),
        name_en: request.names.en(),
        modes: offered(
            request.modes.iter().copied(),
            Some(request.default_mode),
            "modes",
            "defaultMode",
        )?,
        default_mode: request.default_mode.into(),
        load: request.load.into(),
        equipment: offered(
            request.equipment.iter().copied(),
            Some(request.default_equipment),
            "equipment",
            "defaultEquipment",
        )?,
        default_equipment: request.default_equipment.into(),
        grips: offered(
            request.grips.iter().copied(),
            request.default_grip,
            "grips",
            "defaultGrip",
        )?,
        default_grip: request.default_grip.map(Into::into),
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
    let exercise = NewExercise {
        name_fr: request.names.fr(),
        name_en: request.names.en(),
        modes: offered(
            request.modes.iter().copied(),
            Some(request.default_mode),
            "modes",
            "defaultMode",
        )?,
        default_mode: request.default_mode.into(),
        load: request.load.into(),
        equipment: offered(
            request.equipment.iter().copied(),
            Some(request.default_equipment),
            "equipment",
            "defaultEquipment",
        )?,
        default_equipment: request.default_equipment.into(),
        grips: offered(
            request.grips.iter().copied(),
            request.default_grip,
            "grips",
            "defaultGrip",
        )?,
        default_grip: request.default_grip.map(Into::into),
        unilateral: request.unilateral,
    };
    let removed_modes: Vec<Mode> = current.modes.removed(&exercise.modes).collect();
    let removed_equipment: Vec<Equipment> =
        current.equipment.removed(&exercise.equipment).collect();
    let removed_grips: Vec<Grip> = current.grips.removed(&exercise.grips).collect();
    let narrowed =
        !(removed_modes.is_empty() && removed_equipment.is_empty() && removed_grips.is_empty());
    let mut tx = state.pool.begin().await?;
    if narrowed {
        let logged = db::exercises::logged_choices(&mut *tx, current.id).await?;
        for (locked, conflict) in [
            (
                removed_modes.iter().any(|&m| logged.modes.contains(m)),
                Conflict::ModeLocked,
            ),
            (
                removed_equipment
                    .iter()
                    .any(|&e| logged.equipment.contains(e)),
                Conflict::EquipmentLocked,
            ),
            (
                removed_grips.iter().any(|&g| logged.grips.contains(g)),
                Conflict::GripLocked,
            ),
        ] {
            if locked {
                return Err(AppError::Conflict(conflict));
            }
        }
    }
    if db::exercises::name_taken_except(&mut *tx, current.id, &exercise, current.owner_id).await? {
        return Err(AppError::Conflict(Conflict::ExerciseNameTaken));
    }
    let row = db::exercises::update(&mut *tx, current.id, &exercise, user.id, user.locale)
        .await
        .map_err(|e| conflict_on_unique(e, Conflict::ExerciseNameTaken))?;
    if narrowed {
        db::templates::reset_choices(&mut *tx, &row).await?;
    }
    tx.commit().await?;
    tracing::debug!(
        exercise_id = %row.id,
        removed_modes = removed_modes.len(),
        removed_equipment = removed_equipment.len(),
        removed_grips = removed_grips.len(),
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
    let mut conn = state.pool.acquire().await?;
    let (performer_id, coach_id) = match query.athlete_id {
        Some(athlete_id) => match require_coach(&mut conn, &user, athlete_id).await? {
            Coached::Managed => (athlete_id, None),
            Coached::Account if query.before_workout_id.is_some() => {
                return Err(AppError::Validation(vec![FieldError::new(
                    "beforeWorkoutId",
                    "not allowed with the athleteId of an athlete with an account",
                )]));
            }
            Coached::Account => (athlete_id, Some(user.id)),
        },
        None => (user.id, None),
    };
    db::exercises::find(&mut *conn, path.exercise_id, performer_id, user.locale)
        .await?
        .ok_or(AppError::NotFound)?;
    let paging = PageQuery {
        page: query.page,
        per_page: query.per_page,
    };
    let filter = PerformanceFilter {
        exercise_id: path.exercise_id,
        user_id: performer_id,
        coach_id,
        before_workout_id: query.before_workout_id,
        mode: query.mode.map(Into::into),
        equipment: query.equipment.map(Into::into),
        grip: query.grip.map(Into::into),
    };
    let rows =
        db::exercises::list_performances(&mut *conn, &filter, paging.limit(), paging.offset())
            .await?;
    let total = db::exercises::count_performances(&mut *conn, &filter).await?;
    let ids: Vec<Uuid> = rows.iter().map(|r| r.block_exercise_id).collect();
    let mut sets = db::workouts::load_sets(&mut *conn, &ids).await?;
    let mut comments = db::comments::list(&mut *conn, &ids).await?;
    let items = rows
        .into_iter()
        .map(|row| PerformanceResponse {
            block_exercise_id: row.block_exercise_id,
            block_kind: BlockKind::from_exercise_count(
                usize::try_from(row.block_exercise_count).unwrap_or(1),
            )
            .into(),
            mode: row.mode.into(),
            equipment: row.equipment.into(),
            grip: row.grip.map(Into::into),
            comments: comments
                .remove(&row.block_exercise_id)
                .unwrap_or_default()
                .into_iter()
                .map(Into::into)
                .collect(),
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
