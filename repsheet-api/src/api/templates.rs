use std::collections::{HashMap, HashSet};

use aide::axum::{ApiRouter, routing::get_with};
use axum::{Json, extract::State, response::NoContent};
use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use validator::Validate;

use crate::{
    api::{
        AppState, authenticated,
        exercises::{Chosen, EquipmentDto, ExerciseSummaryResponse, GripDto, ModeDto},
        extract::{Created, PathParams, ValidJson, ValidQuery, not_blank},
        pagination::{PageQuery, PageResponse},
        workouts::BlockKindDto,
    },
    auth::AuthUser,
    db::{
        self,
        templates::{
            LoadedTemplateBlock, TemplateBlockInput, TemplateExerciseInput, TemplateRow,
            TemplateSummaryRow,
        },
    },
    domain::BlockKind,
    error::{AppError, AppResult, FieldError},
};

pub fn routes() -> ApiRouter<AppState> {
    ApiRouter::new()
        .api_route(
            "/v1/templates",
            get_with(list, |op| {
                authenticated(op)
                    .tag("Templates")
                    .id("listTemplates")
                    .summary("List templates by name")
            })
            .post_with(create, |op| {
                authenticated(op)
                    .tag("Templates")
                    .id("createTemplate")
                    .summary("Create a template")
            }),
        )
        .api_route(
            "/v1/templates/{templateId}",
            get_with(get, |op| {
                authenticated(op)
                    .tag("Templates")
                    .id("getTemplate")
                    .summary("Get a template with its blocks")
            })
            .put_with(update, |op| {
                authenticated(op)
                    .tag("Templates")
                    .id("updateTemplate")
                    .summary("Replace a template")
                    .description(
                        "Blocks carrying the `id` of one of the template's blocks keep \
                         their identity, so that workouts logged from them stay linked; \
                         blocks without an `id` are created and missing ones deleted.",
                    )
            })
            .delete_with(delete, |op| {
                authenticated(op)
                    .tag("Templates")
                    .id("deleteTemplate")
                    .summary("Delete a template")
                    .description("Workouts started from it are kept.")
            }),
        )
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TemplateSummaryResponse {
    pub id: Uuid,
    pub name: String,
    pub block_count: i64,
    pub updated_at: DateTime<Utc>,
}

impl From<TemplateSummaryRow> for TemplateSummaryResponse {
    fn from(row: TemplateSummaryRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            block_count: row.block_count,
            updated_at: row.updated_at,
        }
    }
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TemplateResponse {
    pub id: Uuid,
    pub name: String,
    pub note: Option<String>,
    pub updated_at: DateTime<Utc>,
    pub blocks: Vec<TemplateBlockResponse>,
}

impl TemplateResponse {
    fn new(row: TemplateRow, blocks: Vec<LoadedTemplateBlock>) -> Self {
        Self {
            id: row.id,
            name: row.name,
            note: row.note,
            updated_at: row.updated_at,
            blocks: blocks
                .into_iter()
                .map(|block| TemplateBlockResponse {
                    id: block.row.id,
                    position: block.row.position,
                    kind: BlockKind::from_exercise_count(block.exercises.len()).into(),
                    rounds: block.row.rounds,
                    rest_seconds: block.row.rest_seconds,
                    exercises: block
                        .exercises
                        .into_iter()
                        .map(|e| TemplateExerciseResponse {
                            exercise: e.exercise.into(),
                            mode: e.mode.into(),
                            equipment: e.equipment.into(),
                            grip: e.grip.map(Into::into),
                            target: e.target,
                        })
                        .collect(),
                })
                .collect(),
        }
    }
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TemplateBlockResponse {
    pub id: Uuid,
    pub position: i32,
    pub kind: BlockKindDto,
    pub rounds: Option<i32>,
    pub rest_seconds: Option<i32>,
    pub exercises: Vec<TemplateExerciseResponse>,
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TemplateExerciseResponse {
    pub exercise: ExerciseSummaryResponse,
    /// The mode a block logged from this one counts the exercise in.
    pub mode: ModeDto,
    /// The equipment a block logged from this one does the exercise with.
    pub equipment: EquipmentDto,
    /// The grip a block logged from this one holds; null when not planned.
    pub grip: Option<GripDto>,
    /// Free-form goal written by the coach, e.g. `6–8`, `max`, `45 s`.
    pub target: Option<String>,
}

#[derive(Serialize, Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct TemplateExerciseRequest {
    pub exercise_id: Uuid,
    /// One of the exercise's modes; its default mode when omitted.
    pub mode: Option<ModeDto>,
    /// One of the exercise's equipment; its default equipment when omitted.
    pub equipment: Option<EquipmentDto>,
    /// One of the exercise's grips; null or omitted leaves it to the block.
    pub grip: Option<GripDto>,
    #[validate(length(max = 50))]
    pub target: Option<String>,
}

#[derive(Serialize, Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct CreateTemplateBlockRequest {
    #[validate(range(min = 1, max = 100))]
    pub rounds: Option<i32>,
    #[validate(range(min = 0, max = 3600))]
    pub rest_seconds: Option<i32>,
    #[validate(length(min = 1, max = 10), nested)]
    pub exercises: Vec<TemplateExerciseRequest>,
}

#[derive(Serialize, Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTemplateBlockRequest {
    /// The id of one of the template's blocks, to update it in place.
    pub id: Option<Uuid>,
    #[validate(range(min = 1, max = 100))]
    pub rounds: Option<i32>,
    #[validate(range(min = 0, max = 3600))]
    pub rest_seconds: Option<i32>,
    #[validate(length(min = 1, max = 10), nested)]
    pub exercises: Vec<TemplateExerciseRequest>,
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct CreateTemplateRequest {
    #[validate(length(min = 1, max = 100), custom(function = not_blank))]
    pub name: String,
    #[validate(length(max = 2000))]
    pub note: Option<String>,
    #[validate(length(max = 30), nested)]
    pub blocks: Vec<CreateTemplateBlockRequest>,
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTemplateRequest {
    #[validate(length(min = 1, max = 100), custom(function = not_blank))]
    pub name: String,
    #[validate(length(max = 2000))]
    pub note: Option<String>,
    #[validate(length(max = 30), nested)]
    pub blocks: Vec<UpdateTemplateBlockRequest>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TemplatePath {
    pub template_id: Uuid,
}

/// One block of a create or update request.
struct BlockRequest<'a> {
    id: Option<Uuid>,
    rounds: Option<i32>,
    rest_seconds: Option<i32>,
    exercises: &'a [TemplateExerciseRequest],
}

fn clean_note(note: Option<&str>) -> Option<&str> {
    note.map(str::trim).filter(|n| !n.is_empty())
}

/// Checks that every exercise is one the user can use, counted in one of its
/// modes and done with one of its equipment and grips, and turns the blocks
/// into what is stored.
async fn resolve_blocks<'a>(
    conn: &mut sqlx::PgConnection,
    user: &AuthUser,
    blocks: &[BlockRequest<'a>],
) -> AppResult<Vec<TemplateBlockInput<'a>>> {
    let ids: Vec<Uuid> = blocks
        .iter()
        .flat_map(|b| b.exercises.iter().map(|e| e.exercise_id))
        .collect();
    let known: HashMap<Uuid, _> = db::exercises::find_many(&mut *conn, &ids, user.id, user.locale)
        .await?
        .into_iter()
        .map(|e| (e.id, e))
        .collect();
    let mut errors = Vec::new();
    let mut resolved = Vec::with_capacity(blocks.len());
    for (i, block) in blocks.iter().enumerate() {
        let mut exercises = Vec::with_capacity(block.exercises.len());
        for (j, request) in block.exercises.iter().enumerate() {
            let Some(exercise) = known.get(&request.exercise_id) else {
                errors.push(FieldError::new(
                    format!("blocks[{i}].exercises[{j}].exerciseId"),
                    "unknown exercise",
                ));
                continue;
            };
            let Some(chosen) = Chosen::check(
                exercise,
                request.mode,
                request.equipment,
                request.grip,
                &format!("blocks[{i}].exercises[{j}]"),
                &mut errors,
            ) else {
                continue;
            };
            exercises.push(TemplateExerciseInput {
                exercise_id: request.exercise_id,
                mode: chosen.mode,
                equipment: chosen.equipment,
                grip: chosen.grip,
                target: request
                    .target
                    .as_deref()
                    .map(str::trim)
                    .filter(|t| !t.is_empty()),
            });
        }
        resolved.push(TemplateBlockInput {
            id: block.id,
            rounds: block.rounds,
            rest_seconds: block.rest_seconds,
            exercises,
        });
    }
    if errors.is_empty() {
        Ok(resolved)
    } else {
        Err(AppError::Validation(errors))
    }
}

async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    ValidQuery(paging): ValidQuery<PageQuery>,
) -> AppResult<Json<PageResponse<TemplateSummaryResponse>>> {
    let rows = db::templates::list(&state.pool, user.id, paging.limit(), paging.offset()).await?;
    let total = db::templates::count(&state.pool, user.id).await?;
    Ok(Json(paging.respond(
        rows.into_iter().map(Into::into).collect(),
        total,
    )))
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    ValidJson(request): ValidJson<CreateTemplateRequest>,
) -> AppResult<Created<TemplateResponse>> {
    let requests: Vec<_> = request
        .blocks
        .iter()
        .map(|b| BlockRequest {
            id: None,
            rounds: b.rounds,
            rest_seconds: b.rest_seconds,
            exercises: &b.exercises,
        })
        .collect();
    let mut tx = state.pool.begin().await?;
    let blocks = resolve_blocks(&mut tx, &user, &requests).await?;
    let row = db::templates::insert(
        &mut tx,
        user.id,
        request.name.trim(),
        clean_note(request.note.as_deref()),
        &blocks,
    )
    .await?;
    let loaded = db::templates::load_blocks(&mut tx, row.id, user.locale).await?;
    tx.commit().await?;
    tracing::debug!(template_id = %row.id, "template created");
    Ok(Created {
        location: format!("/v1/templates/{}", row.id),
        body: TemplateResponse::new(row, loaded),
    })
}

async fn get(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<TemplatePath>,
) -> AppResult<Json<TemplateResponse>> {
    let mut conn = state.pool.acquire().await?;
    let row = db::templates::find(&mut *conn, path.template_id, user.id)
        .await?
        .ok_or(AppError::NotFound)?;
    let blocks = db::templates::load_blocks(&mut conn, row.id, user.locale).await?;
    Ok(Json(TemplateResponse::new(row, blocks)))
}

async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<TemplatePath>,
    ValidJson(request): ValidJson<UpdateTemplateRequest>,
) -> AppResult<Json<TemplateResponse>> {
    let requests: Vec<_> = request
        .blocks
        .iter()
        .map(|b| BlockRequest {
            id: b.id,
            rounds: b.rounds,
            rest_seconds: b.rest_seconds,
            exercises: &b.exercises,
        })
        .collect();
    let mut tx = state.pool.begin().await?;
    db::templates::find(&mut *tx, path.template_id, user.id)
        .await?
        .ok_or(AppError::NotFound)?;
    let existing: HashSet<Uuid> = db::templates::block_ids(&mut *tx, path.template_id)
        .await?
        .into_iter()
        .collect();
    let mut seen = HashSet::new();
    let foreign: Vec<FieldError> = requests
        .iter()
        .enumerate()
        .filter_map(|(i, b)| b.id.map(|id| (i, id)))
        .filter(|(_, id)| !existing.contains(id) || !seen.insert(*id))
        .map(|(i, _)| FieldError::new(format!("blocks[{i}].id"), "not a block of this template"))
        .collect();
    if !foreign.is_empty() {
        return Err(AppError::Validation(foreign));
    }
    let blocks = resolve_blocks(&mut tx, &user, &requests).await?;
    let row = db::templates::update(
        &mut tx,
        path.template_id,
        user.id,
        request.name.trim(),
        clean_note(request.note.as_deref()),
        &blocks,
    )
    .await?
    .ok_or(AppError::NotFound)?;
    let loaded = db::templates::load_blocks(&mut tx, row.id, user.locale).await?;
    tx.commit().await?;
    Ok(Json(TemplateResponse::new(row, loaded)))
}

async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<TemplatePath>,
) -> AppResult<NoContent> {
    db::templates::delete(&state.pool, path.template_id, user.id).await?;
    Ok(NoContent)
}
