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
        extract::{Created, PathParams, ValidJson, ValidQuery},
        pagination::{PageQuery, PageResponse},
    },
    auth::AuthUser,
    db::{self, coaching::LinkedAccountRow},
    error::{AppError, AppResult, Conflict, conflict_on_unique},
};

pub fn routes() -> ApiRouter<AppState> {
    ApiRouter::new()
        .api_route(
            "/v1/users/me/coaches",
            get_with(list_coaches, |op| {
                authenticated(op)
                    .tag("Coaching")
                    .id("listCoaches")
                    .summary("List the caller's coaches")
            })
            .post_with(create_coach, |op| {
                authenticated(op)
                    .tag("Coaching")
                    .id("createCoach")
                    .summary("Add a coach")
                    .description(
                        "Grants the account with this email access at once, with no step on \
                         its side: it can plan sessions for the caller and read the workouts \
                         logged from them.",
                    )
            }),
        )
        .api_route(
            "/v1/users/me/coaches/{coachId}",
            get_with(get_coach, |op| {
                authenticated(op)
                    .tag("Coaching")
                    .id("getCoach")
                    .summary("Get one of the caller's coaches")
            })
            .delete_with(delete_coach, |op| {
                authenticated(op)
                    .tag("Coaching")
                    .id("deleteCoach")
                    .summary("Remove a coach")
                    .description(
                        "The coach loses access at once, and the workouts shared with them \
                         are unshared. The sessions they planned stay the caller's.",
                    )
            }),
        )
        .api_route(
            "/v1/users/me/athletes",
            get_with(list_athletes, |op| {
                authenticated(op)
                    .tag("Coaching")
                    .id("listAthletes")
                    .summary("List the accounts that have the caller as a coach")
            }),
        )
        .api_route(
            "/v1/users/me/athletes/{athleteId}",
            get_with(get_athlete, |op| {
                authenticated(op)
                    .tag("Coaching")
                    .id("getAthlete")
                    .summary("Get an account that has the caller as a coach")
            }),
        )
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CoachResponse {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    /// When the caller added this coach.
    pub linked_at: DateTime<Utc>,
}

impl From<LinkedAccountRow> for CoachResponse {
    fn from(row: LinkedAccountRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            email: row.email,
            linked_at: row.linked_at,
        }
    }
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AthleteResponse {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    /// When this athlete added the caller as a coach.
    pub linked_at: DateTime<Utc>,
}

impl From<LinkedAccountRow> for AthleteResponse {
    fn from(row: LinkedAccountRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            email: row.email,
            linked_at: row.linked_at,
        }
    }
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
#[schemars(extend("example" = serde_json::json!({ "email": "coach@example.com" })))]
pub struct CreateCoachRequest {
    /// The email of the coach's account.
    #[validate(email)]
    pub email: String,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CoachPath {
    pub coach_id: Uuid,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AthletePath {
    pub athlete_id: Uuid,
}

/// Rejects a caller who is not a coach of `athlete_id`, whether that account
/// exists or not.
pub(super) async fn require_coach(
    conn: &mut sqlx::PgConnection,
    user: &AuthUser,
    athlete_id: Uuid,
) -> AppResult<()> {
    if db::coaching::is_coach(&mut *conn, athlete_id, user.id).await? {
        Ok(())
    } else {
        tracing::debug!(coach_id = %user.id, %athlete_id, "rejected a coach action");
        Err(AppError::NotCoach)
    }
}

async fn list_coaches(
    State(state): State<AppState>,
    user: AuthUser,
    ValidQuery(paging): ValidQuery<PageQuery>,
) -> AppResult<Json<PageResponse<CoachResponse>>> {
    let rows =
        db::coaching::list_coaches(&state.pool, user.id, paging.limit(), paging.offset()).await?;
    let total = db::coaching::count_coaches(&state.pool, user.id).await?;
    Ok(Json(paging.respond(
        rows.into_iter().map(Into::into).collect(),
        total,
    )))
}

async fn create_coach(
    State(state): State<AppState>,
    user: AuthUser,
    ValidJson(request): ValidJson<CreateCoachRequest>,
) -> AppResult<Created<CoachResponse>> {
    let Some(coach_id) = db::users::find_id_by_email(&state.pool, request.email.trim()).await?
    else {
        tracing::debug!(athlete_id = %user.id, "no account for the coach's email");
        return Err(AppError::UnknownAccount);
    };
    if coach_id == user.id {
        return Err(AppError::OwnCoach);
    }
    let row = db::coaching::insert(&state.pool, user.id, coach_id)
        .await
        .map_err(|e| conflict_on_unique(e, Conflict::CoachAlreadyAdded))?;
    tracing::info!(athlete_id = %user.id, %coach_id, "coach added");
    Ok(Created {
        location: format!("/v1/users/me/coaches/{coach_id}"),
        body: row.into(),
    })
}

async fn get_coach(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<CoachPath>,
) -> AppResult<Json<CoachResponse>> {
    let row = db::coaching::find_coach(&state.pool, user.id, path.coach_id)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(row.into()))
}

async fn delete_coach(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<CoachPath>,
) -> AppResult<NoContent> {
    let mut tx = state.pool.begin().await?;
    db::coaching::delete(&mut *tx, user.id, path.coach_id).await?;
    db::workout_shares::delete_for_coach(&mut *tx, user.id, path.coach_id).await?;
    tx.commit().await?;
    tracing::info!(athlete_id = %user.id, coach_id = %path.coach_id, "coach removed");
    Ok(NoContent)
}

async fn list_athletes(
    State(state): State<AppState>,
    user: AuthUser,
    ValidQuery(paging): ValidQuery<PageQuery>,
) -> AppResult<Json<PageResponse<AthleteResponse>>> {
    let rows =
        db::coaching::list_athletes(&state.pool, user.id, paging.limit(), paging.offset()).await?;
    let total = db::coaching::count_athletes(&state.pool, user.id).await?;
    Ok(Json(paging.respond(
        rows.into_iter().map(Into::into).collect(),
        total,
    )))
}

async fn get_athlete(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<AthletePath>,
) -> AppResult<Json<AthleteResponse>> {
    let row = db::coaching::find_athlete(&state.pool, user.id, path.athlete_id)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(row.into()))
}
