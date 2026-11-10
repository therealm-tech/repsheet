use aide::axum::{ApiRouter, routing::get_with};
use axum::{Json, extract::State, response::NoContent};
use chrono::{DateTime, NaiveDate, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use validator::Validate;

use crate::{
    api::{
        AppState, authenticated,
        coaching::require_coach,
        extract::{Created, PathParams, ValidJson, ValidQuery, not_blank, trimmed},
        pagination::{MAX_PER_PAGE, PageQuery, PageResponse},
        templates::{
            BlockRequest, CreateTemplateBlockRequest, TemplateBlockResponse,
            UpdateTemplateBlockRequest, check_block_ids, resolve_blocks,
        },
        workouts::WorkoutResponse,
    },
    auth::AuthUser,
    db::{
        self,
        planned_sessions::{PlannedSessionRow, PlannedSessionSummaryRow},
        templates::{LoadedTemplateBlock, Planned},
    },
    error::{AppError, AppResult},
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
                         them. With it, the sessions the caller wrote for that athlete, who \
                         must have the caller as a coach (403 otherwise).",
                    )
            })
            .post_with(create, |op| {
                authenticated(op)
                    .tag("Planned sessions")
                    .id("createPlannedSession")
                    .summary("Plan a session for an athlete")
                    .description(
                        "The athlete must have the caller as a coach (403 otherwise). The \
                         session belongs to the athlete; its exercises are ones the athlete \
                         can use.",
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
                        "Visible to its athlete, and to its author while the athlete has them \
                         as a coach.",
                    )
            })
            .put_with(update, |op| {
                authenticated(op)
                    .tag("Planned sessions")
                    .id("updatePlannedSession")
                    .summary("Replace a planned session")
                    .description(
                        "By its athlete, or by its author while the athlete has them as a \
                         coach. Blocks are reconciled as for `updateTemplate`.",
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
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlannedSessionAuthorResponse {
    pub id: Uuid,
    pub name: String,
}

/// The coach who wrote the session; `None` once their account is deleted.
fn author(id: Option<Uuid>, name: Option<String>) -> Option<PlannedSessionAuthorResponse> {
    Some(PlannedSessionAuthorResponse {
        id: id?,
        name: name?,
    })
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlannedSessionSummaryResponse {
    pub id: Uuid,
    pub athlete_id: Uuid,
    pub author: Option<PlannedSessionAuthorResponse>,
    /// The day the session is planned on.
    pub planned_on: NaiveDate,
    pub name: String,
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
    pub author: Option<PlannedSessionAuthorResponse>,
    pub planned_on: NaiveDate,
    pub name: String,
    pub note: Option<String>,
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
    #[validate(length(max = 30), nested)]
    pub blocks: Vec<CreateTemplateBlockRequest>,
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePlannedSessionRequest {
    pub planned_on: NaiveDate,
    #[validate(length(min = 1, max = 100), custom(function = not_blank))]
    pub name: String,
    #[validate(length(max = 2000))]
    pub note: Option<String>,
    #[validate(length(max = 30), nested)]
    pub blocks: Vec<UpdateTemplateBlockRequest>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlannedSessionPath {
    pub planned_session_id: Uuid,
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
    let requests: Vec<BlockRequest> = request.blocks.iter().map(Into::into).collect();
    let mut tx = state.pool.begin().await?;
    require_coach(&mut tx, &user, request.athlete_id).await?;
    let blocks = resolve_blocks(&mut tx, request.athlete_id, user.locale, &requests).await?;
    let template = db::templates::insert(
        &mut tx,
        request.athlete_id,
        request.name.trim(),
        trimmed(request.note.as_deref()),
        Some(&Planned {
            on: request.planned_on,
            author_id: user.id,
        }),
        &blocks,
    )
    .await?;
    let row = db::planned_sessions::find(&mut *tx, template.id, user.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("a planned session just created is not visible"))?;
    let loaded = db::templates::load_blocks(&mut tx, row.id, user.locale).await?;
    tx.commit().await?;
    tracing::info!(
        planned_session_id = %row.id,
        athlete_id = %row.athlete_id,
        coach_id = %user.id,
        "session planned"
    );
    Ok(Created {
        location: format!("/v1/planned-sessions/{}", row.id),
        body: PlannedSessionResponse::new(row, loaded),
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
    let requests: Vec<BlockRequest> = request.blocks.iter().map(Into::into).collect();
    let mut tx = state.pool.begin().await?;
    let current = db::planned_sessions::find(&mut *tx, path.planned_session_id, user.id)
        .await?
        .ok_or(AppError::NotFound)?;
    check_block_ids(&mut tx, current.id, &requests).await?;
    let blocks = resolve_blocks(&mut tx, current.athlete_id, user.locale, &requests).await?;
    db::planned_sessions::update(
        &mut *tx,
        current.id,
        request.planned_on,
        request.name.trim(),
        trimmed(request.note.as_deref()),
    )
    .await?;
    db::templates::replace_blocks(&mut tx, current.id, &blocks).await?;
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
