use aide::axum::{
    ApiRouter,
    routing::{get_with, post_with, put_with},
};
use axum::{Json, extract::State, response::NoContent};
use chrono::{DateTime, NaiveDate, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use validator::{Validate, ValidationErrors};

use crate::{
    api::{
        AppState, authenticated,
        coaching::require_coach,
        exercises::{EquipmentDto, GripDto, ModeDto},
        extract::{Created, PathParams, ValidJson, ValidQuery, not_blank, trimmed},
        pagination::{MAX_PER_PAGE, PageQuery, PageResponse},
        templates::TemplateBlockResponse,
        users::{AuthorResponse, author},
        workouts::{CheckedExercise, ExerciseSets, SetRequest, WorkoutResponse, check_sets},
    },
    auth::AuthUser,
    db::{
        self,
        planned_sessions::{PlannedSessionRow, PlannedSessionSummaryRow},
        templates::{LoadedTemplateBlock, Planned, TemplateExerciseInput},
    },
    domain::Locale,
    error::{AppError, AppResult, Conflict},
};

pub fn routes() -> ApiRouter<AppState> {
    ApiRouter::new()
        .api_route(
            "/v1/planned-sessions",
            get_with(list, |op| {
                authenticated(op)
                    .tag("Planned sessions")
                    .id("listPlannedSessions")
                    .summary("List planned sessions, latest day first")
                    .description(
                        "Without `athleteId`, the caller's own planned sessions, whoever wrote \
                         them, once sent. With it, the sessions the caller wrote for that \
                         athlete, drafts included, who must have the caller as a coach (403 \
                         otherwise).",
                    )
            })
            .post_with(create, |op| {
                authenticated(op)
                    .tag("Planned sessions")
                    .id("createPlannedSession")
                    .summary("Plan a session for an athlete")
                    .description(
                        "The athlete must have the caller as a coach (403 otherwise). The \
                         session belongs to the athlete, and starts as a draft they do not \
                         see: its blocks are added one by one, then it is sent.",
                    )
            }),
        )
        .api_route(
            "/v1/planned-sessions/{plannedSessionId}",
            get_with(get, |op| {
                authenticated(op)
                    .tag("Planned sessions")
                    .id("getPlannedSession")
                    .summary("Get a planned session with its blocks")
                    .description(
                        "Visible to its athlete once sent, and to its author while the athlete \
                         has them as a coach.",
                    )
            })
            .put_with(update, |op| {
                authenticated(op)
                    .tag("Planned sessions")
                    .id("updatePlannedSession")
                    .summary("Replace a planned session's details")
                    .description(
                        "By whoever sees it: its athlete once sent, or its author while the \
                         athlete has them as a coach. Blocks are left untouched.",
                    )
            })
            .delete_with(delete, |op| {
                authenticated(op)
                    .tag("Planned sessions")
                    .id("deletePlannedSession")
                    .summary("Delete a planned session")
                    .description(
                        "By its athlete, or by its author while the athlete has them as a \
                         coach. Workouts logged from it are kept and lose their link to it.",
                    )
            }),
        )
        .api_route(
            "/v1/planned-sessions/{plannedSessionId}/workouts",
            get_with(list_workouts, |op| {
                authenticated(op)
                    .tag("Planned sessions")
                    .id("listPlannedSessionWorkouts")
                    .summary("List the workouts logged from a planned session")
                    .description(
                        "With their blocks and sets, newest first: how the session went. \
                         Visible to whoever can see the planned session.",
                    )
            }),
        )
        .merge(progress_routes())
}

/// The routes that fill a draft block by block and send it.
fn progress_routes() -> ApiRouter<AppState> {
    ApiRouter::new()
        .api_route(
            "/v1/planned-sessions/{plannedSessionId}/status",
            put_with(update_status, |op| {
                authenticated(op)
                    .tag("Planned sessions")
                    .id("updatePlannedSessionStatus")
                    .summary("Send a planned session to its athlete")
                    .description(
                        "`sent` shows the draft to its athlete; a session with no block cannot \
                         be sent (409). A sent session stays sent: `draft` is refused (409), \
                         and sending it again changes nothing.",
                    )
            }),
        )
        .api_route(
            "/v1/planned-sessions/{plannedSessionId}/blocks",
            post_with(create_block, |op| {
                authenticated(op)
                    .tag("Planned sessions")
                    .id("createPlannedBlock")
                    .summary("Plan a block")
                    .description(
                        "Appends a block to the session, its sets planned round by round in \
                         the shape of logged ones, with exercises the athlete can use. By \
                         whoever may replace the session.",
                    )
                    .response::<201, Json<TemplateBlockResponse>>()
            }),
        )
        .api_route(
            "/v1/planned-sessions/{plannedSessionId}/blocks/{blockId}",
            put_with(update_block, |op| {
                authenticated(op)
                    .tag("Planned sessions")
                    .id("updatePlannedBlock")
                    .summary("Replace a planned block's exercises and sets")
                    .description(
                        "The block keeps its identity and its place, so that blocks logged \
                         from it stay linked; its exercises get new ids.",
                    )
            })
            .delete_with(delete_block, |op| {
                authenticated(op)
                    .tag("Planned sessions")
                    .id("deletePlannedBlock")
                    .summary("Delete a planned block")
                    .description("Blocks logged from it are kept and lose their link to it.")
            }),
        )
}

/// Whether the athlete sees the session: a draft only its author does.
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(rename = "PlannedSessionStatus")]
pub enum PlannedSessionStatusDto {
    Draft,
    Sent,
}

impl PlannedSessionStatusDto {
    fn of(sent_at: Option<DateTime<Utc>>) -> Self {
        if sent_at.is_some() {
            Self::Sent
        } else {
            Self::Draft
        }
    }
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlannedSessionSummaryResponse {
    pub id: Uuid,
    pub athlete_id: Uuid,
    /// The coach who wrote the session; none once their account is deleted.
    pub author: Option<AuthorResponse>,
    /// The day the session is planned on.
    pub planned_on: NaiveDate,
    pub name: String,
    pub status: PlannedSessionStatusDto,
    pub block_count: i64,
    /// Workouts logged from the session; 0 while it has not been done.
    pub workout_count: i64,
    pub updated_at: DateTime<Utc>,
}

impl From<PlannedSessionSummaryRow> for PlannedSessionSummaryResponse {
    fn from(row: PlannedSessionSummaryRow) -> Self {
        Self {
            id: row.id,
            athlete_id: row.athlete_id,
            author: author(row.author_id, row.author_name),
            planned_on: row.planned_on,
            name: row.name,
            status: PlannedSessionStatusDto::of(row.sent_at),
            block_count: row.block_count,
            workout_count: row.workout_count,
            updated_at: row.updated_at,
        }
    }
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlannedSessionResponse {
    pub id: Uuid,
    pub athlete_id: Uuid,
    /// The coach who wrote the session; none once their account is deleted.
    pub author: Option<AuthorResponse>,
    pub planned_on: NaiveDate,
    pub name: String,
    pub note: Option<String>,
    pub status: PlannedSessionStatusDto,
    pub updated_at: DateTime<Utc>,
    pub blocks: Vec<TemplateBlockResponse>,
}

impl PlannedSessionResponse {
    fn new(row: PlannedSessionRow, blocks: Vec<LoadedTemplateBlock>) -> Self {
        Self {
            id: row.id,
            athlete_id: row.athlete_id,
            author: author(row.author_id, row.author_name),
            planned_on: row.planned_on,
            name: row.name,
            note: row.note,
            status: PlannedSessionStatusDto::of(row.sent_at),
            updated_at: row.updated_at,
            blocks: blocks.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct ListPlannedSessionsQuery {
    /// An athlete who has the caller as a coach; the caller when omitted.
    pub athlete_id: Option<Uuid>,
    /// 1-based page number (default 1)
    #[validate(range(min = 1))]
    pub page: Option<u32>,
    /// Items per page (default 50, at most 100)
    #[validate(range(min = 1, max = MAX_PER_PAGE))]
    pub per_page: Option<u32>,
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct CreatePlannedSessionRequest {
    /// The athlete the session is planned for, who owns it.
    pub athlete_id: Uuid,
    pub planned_on: NaiveDate,
    #[validate(length(min = 1, max = 100), custom(function = not_blank))]
    pub name: String,
    #[validate(length(max = 2000))]
    pub note: Option<String>,
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePlannedSessionRequest {
    pub planned_on: NaiveDate,
    #[validate(length(min = 1, max = 100), custom(function = not_blank))]
    pub name: String,
    #[validate(length(max = 2000))]
    pub note: Option<String>,
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePlannedSessionStatusRequest {
    pub status: PlannedSessionStatusDto,
}

#[derive(Serialize, Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct PlannedExerciseRequest {
    pub exercise_id: Uuid,
    /// One of the exercise's modes; its default mode when omitted. Each set
    /// carries the field of this mode, and a weight as the exercise's load
    /// rule says.
    pub mode: Option<ModeDto>,
    /// One of the exercise's equipment; its default equipment when omitted.
    pub equipment: Option<EquipmentDto>,
    /// One of the exercise's grips; null or omitted leaves it to the athlete.
    pub grip: Option<GripDto>,
    /// The coach's note for the athlete; it starts the exercise's thread of
    /// comments once the block is logged. A blank note is stored as none.
    #[validate(length(max = 2000))]
    pub note: Option<String>,
    #[validate(length(min = 1, max = 50), nested)]
    pub sets: Vec<SetRequest>,
}

/// The content of a planned block, shared by its creation and its replacement.
#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct PlannedBlockBody {
    /// In the order they are performed within a round.
    #[validate(length(min = 1, max = 10), nested)]
    pub exercises: Vec<PlannedExerciseRequest>,
}

#[derive(Deserialize, JsonSchema)]
pub struct CreatePlannedBlockRequest {
    #[serde(flatten)]
    pub block: PlannedBlockBody,
}

impl Validate for CreatePlannedBlockRequest {
    fn validate(&self) -> Result<(), ValidationErrors> {
        self.block.validate()
    }
}

#[derive(Deserialize, JsonSchema)]
pub struct UpdatePlannedBlockRequest {
    #[serde(flatten)]
    pub block: PlannedBlockBody,
}

impl Validate for UpdatePlannedBlockRequest {
    fn validate(&self) -> Result<(), ValidationErrors> {
        self.block.validate()
    }
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlannedSessionPath {
    pub planned_session_id: Uuid,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlannedBlockPath {
    pub planned_session_id: Uuid,
    pub block_id: Uuid,
}

async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    ValidQuery(query): ValidQuery<ListPlannedSessionsQuery>,
) -> AppResult<Json<PageResponse<PlannedSessionSummaryResponse>>> {
    let mut conn = state.pool.acquire().await?;
    let (athlete_id, author_id) = match query.athlete_id {
        Some(athlete_id) => {
            require_coach(&mut conn, &user, athlete_id).await?;
            (athlete_id, Some(user.id))
        }
        None => (user.id, None),
    };
    let paging = PageQuery {
        page: query.page,
        per_page: query.per_page,
    };
    let rows = db::planned_sessions::list(
        &mut *conn,
        athlete_id,
        author_id,
        paging.limit(),
        paging.offset(),
    )
    .await?;
    let total = db::planned_sessions::count(&mut *conn, athlete_id, author_id).await?;
    Ok(Json(paging.respond(
        rows.into_iter().map(Into::into).collect(),
        total,
    )))
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    ValidJson(request): ValidJson<CreatePlannedSessionRequest>,
) -> AppResult<Created<PlannedSessionResponse>> {
    let mut tx = state.pool.begin().await?;
    require_coach(&mut tx, &user, request.athlete_id).await?;
    let template = db::templates::insert(
        &mut tx,
        request.athlete_id,
        request.name.trim(),
        trimmed(request.note.as_deref()),
        Some(&Planned {
            on: request.planned_on,
            author_id: user.id,
        }),
        &[],
    )
    .await?;
    let row = db::planned_sessions::find(&mut *tx, template.id, user.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("a planned session just created is not visible"))?;
    tx.commit().await?;
    tracing::info!(
        planned_session_id = %row.id,
        athlete_id = %row.athlete_id,
        coach_id = %user.id,
        "session planned"
    );
    Ok(Created {
        location: format!("/v1/planned-sessions/{}", row.id),
        body: PlannedSessionResponse::new(row, Vec::new()),
    })
}

async fn get(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<PlannedSessionPath>,
) -> AppResult<Json<PlannedSessionResponse>> {
    let mut conn = state.pool.acquire().await?;
    let row = db::planned_sessions::find(&mut *conn, path.planned_session_id, user.id)
        .await?
        .ok_or(AppError::NotFound)?;
    let blocks = db::templates::load_blocks(&mut conn, row.id, user.locale).await?;
    Ok(Json(PlannedSessionResponse::new(row, blocks)))
}

async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<PlannedSessionPath>,
    ValidJson(request): ValidJson<UpdatePlannedSessionRequest>,
) -> AppResult<Json<PlannedSessionResponse>> {
    let mut tx = state.pool.begin().await?;
    let current = db::planned_sessions::find(&mut *tx, path.planned_session_id, user.id)
        .await?
        .ok_or(AppError::NotFound)?;
    db::planned_sessions::update(
        &mut *tx,
        current.id,
        request.planned_on,
        request.name.trim(),
        trimmed(request.note.as_deref()),
    )
    .await?;
    let row = db::planned_sessions::find(&mut *tx, current.id, user.id)
        .await?
        .ok_or(AppError::NotFound)?;
    let loaded = db::templates::load_blocks(&mut tx, row.id, user.locale).await?;
    tx.commit().await?;
    tracing::debug!(planned_session_id = %row.id, by = %user.id, "planned session updated");
    Ok(Json(PlannedSessionResponse::new(row, loaded)))
}

async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<PlannedSessionPath>,
) -> AppResult<NoContent> {
    let mut tx = state.pool.begin().await?;
    if let Some(row) =
        db::planned_sessions::find(&mut *tx, path.planned_session_id, user.id).await?
    {
        db::planned_sessions::delete(&mut *tx, row.id).await?;
        tracing::debug!(planned_session_id = %row.id, by = %user.id, "planned session deleted");
    }
    tx.commit().await?;
    Ok(NoContent)
}

async fn list_workouts(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<PlannedSessionPath>,
    ValidQuery(paging): ValidQuery<PageQuery>,
) -> AppResult<Json<PageResponse<WorkoutResponse>>> {
    let mut conn = state.pool.acquire().await?;
    let session = db::planned_sessions::find(&mut *conn, path.planned_session_id, user.id)
        .await?
        .ok_or(AppError::NotFound)?;
    let rows =
        db::workouts::list_by_template(&mut *conn, session.id, paging.limit(), paging.offset())
            .await?;
    let total = db::workouts::count_by_template(&mut *conn, session.id).await?;
    let ids: Vec<Uuid> = rows.iter().map(|w| w.id).collect();
    let mut blocks = db::workouts::load_workouts_blocks(&mut conn, &ids, user.locale).await?;
    let items = rows
        .into_iter()
        .map(|row| {
            let loaded = blocks.remove(&row.id).unwrap_or_default();
            WorkoutResponse::new(row, loaded)
        })
        .collect();
    Ok(Json(paging.respond(items, total)))
}

async fn update_status(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<PlannedSessionPath>,
    ValidJson(request): ValidJson<UpdatePlannedSessionStatusRequest>,
) -> AppResult<Json<PlannedSessionResponse>> {
    let mut tx = state.pool.begin().await?;
    let current = db::planned_sessions::find(&mut *tx, path.planned_session_id, user.id)
        .await?
        .ok_or(AppError::NotFound)?;
    let blocks = db::templates::load_blocks(&mut tx, current.id, user.locale).await?;
    match (PlannedSessionStatusDto::of(current.sent_at), request.status) {
        (PlannedSessionStatusDto::Sent, PlannedSessionStatusDto::Draft) => {
            return Err(AppError::Conflict(Conflict::PlannedSessionSent));
        }
        (PlannedSessionStatusDto::Draft, PlannedSessionStatusDto::Sent) => {
            if blocks.is_empty() {
                return Err(AppError::Conflict(Conflict::PlannedSessionEmpty));
            }
            db::planned_sessions::send(&mut *tx, current.id).await?;
            tracing::info!(
                planned_session_id = %current.id,
                athlete_id = %current.athlete_id,
                coach_id = %user.id,
                "planned session sent"
            );
        }
        _ => {}
    }
    let row = db::planned_sessions::find(&mut *tx, current.id, user.id)
        .await?
        .ok_or(AppError::NotFound)?;
    tx.commit().await?;
    Ok(Json(PlannedSessionResponse::new(row, blocks)))
}

async fn create_block(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<PlannedSessionPath>,
    ValidJson(request): ValidJson<CreatePlannedBlockRequest>,
) -> AppResult<Created<TemplateBlockResponse>> {
    let body = request.block;
    let mut tx = state.pool.begin().await?;
    let session = db::planned_sessions::find(&mut *tx, path.planned_session_id, user.id)
        .await?
        .ok_or(AppError::NotFound)?;
    let checked = check_planned_block(&mut tx, session.athlete_id, user.locale, &body).await?;
    let exercises = planned_exercises(&body, &checked);
    let block_id = db::templates::append_block(&mut tx, session.id, &exercises).await?;
    let block = load_block(&mut tx, session.id, block_id, user.locale).await?;
    tx.commit().await?;
    tracing::debug!(planned_session_id = %session.id, %block_id, by = %user.id, "block planned");
    Ok(Created {
        location: format!("/v1/planned-sessions/{}/blocks/{block_id}", session.id),
        body: block,
    })
}

async fn update_block(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<PlannedBlockPath>,
    ValidJson(request): ValidJson<UpdatePlannedBlockRequest>,
) -> AppResult<Json<TemplateBlockResponse>> {
    let body = request.block;
    let mut tx = state.pool.begin().await?;
    let session = db::planned_sessions::find(&mut *tx, path.planned_session_id, user.id)
        .await?
        .ok_or(AppError::NotFound)?;
    let checked = check_planned_block(&mut tx, session.athlete_id, user.locale, &body).await?;
    let exercises = planned_exercises(&body, &checked);
    if !db::templates::update_block(&mut tx, path.block_id, session.id, &exercises).await? {
        return Err(AppError::NotFound);
    }
    let block = load_block(&mut tx, session.id, path.block_id, user.locale).await?;
    tx.commit().await?;
    Ok(Json(block))
}

async fn delete_block(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<PlannedBlockPath>,
) -> AppResult<NoContent> {
    let mut conn = state.pool.acquire().await?;
    if let Some(session) =
        db::planned_sessions::find(&mut *conn, path.planned_session_id, user.id).await?
    {
        db::templates::delete_block(&mut *conn, path.block_id, session.id).await?;
    }
    Ok(NoContent)
}

/// Checks the exercises and sets of a planned block as a logged block's are
/// checked, with the exercises the athlete `athlete_id` can use.
async fn check_planned_block(
    conn: &mut sqlx::PgConnection,
    athlete_id: Uuid,
    locale: Locale,
    body: &PlannedBlockBody,
) -> AppResult<Vec<CheckedExercise>> {
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
    let mut errors = Vec::new();
    let checked = check_sets(conn, athlete_id, locale, &exercises, &mut errors).await?;
    if errors.is_empty() {
        Ok(checked)
    } else {
        Err(AppError::Validation(errors))
    }
}

fn planned_exercises<'a>(
    body: &'a PlannedBlockBody,
    checked: &'a [CheckedExercise],
) -> Vec<TemplateExerciseInput<'a>> {
    body.exercises
        .iter()
        .zip(checked)
        .map(|(exercise, checked)| TemplateExerciseInput {
            exercise_id: exercise.exercise_id,
            mode: checked.chosen.mode,
            equipment: checked.chosen.equipment,
            grip: checked.chosen.grip,
            target: None,
            note: trimmed(exercise.note.as_deref()),
            sets: &checked.sets,
        })
        .collect()
}

async fn load_block(
    conn: &mut sqlx::PgConnection,
    session_id: Uuid,
    block_id: Uuid,
    locale: Locale,
) -> AppResult<TemplateBlockResponse> {
    db::templates::load_blocks(conn, session_id, locale)
        .await?
        .into_iter()
        .find(|b: &LoadedTemplateBlock| b.row.id == block_id)
        .map(Into::into)
        .ok_or_else(|| anyhow::anyhow!("a planned block just written is not found").into())
}
