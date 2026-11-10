use aide::axum::{
    ApiRouter,
    routing::{get_with, put_with},
};
use axum::{Json, extract::State, response::NoContent};
use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    api::{
        AppState, authenticated,
        extract::{PathParams, ValidQuery},
        pagination::{PageQuery, PageResponse},
        workouts::WorkoutPath,
    },
    auth::AuthUser,
    db::{self, workout_shares::WorkoutShareRow},
    error::{AppError, AppResult},
};

pub fn routes() -> ApiRouter<AppState> {
    ApiRouter::new()
        .api_route(
            "/v1/workouts/{workoutId}/shares",
            get_with(list, |op| {
                authenticated(op)
                    .tag("Coaching")
                    .id("listWorkoutShares")
                    .summary("List the coaches a workout is shared with")
            }),
        )
        .api_route(
            "/v1/workouts/{workoutId}/shares/{coachId}",
            put_with(share, |op| {
                authenticated(op)
                    .tag("Coaching")
                    .id("shareWorkout")
                    .summary("Share a workout with one of the caller's coaches")
                    .description(
                        "The coach can then read it, blocks and sets included, while they \
                         remain the caller's coach. Sharing again changes nothing; a coach \
                         who is not the caller's answers 404.",
                    )
            })
            .delete_with(unshare, |op| {
                authenticated(op)
                    .tag("Coaching")
                    .id("unshareWorkout")
                    .summary("Stop sharing a workout with a coach")
            }),
        )
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkoutShareResponse {
    pub coach_id: Uuid,
    pub shared_at: DateTime<Utc>,
}

impl From<WorkoutShareRow> for WorkoutShareResponse {
    fn from(row: WorkoutShareRow) -> Self {
        Self {
            coach_id: row.coach_id,
            shared_at: row.shared_at,
        }
    }
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkoutSharePath {
    pub workout_id: Uuid,
    pub coach_id: Uuid,
}

async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<WorkoutPath>,
    ValidQuery(paging): ValidQuery<PageQuery>,
) -> AppResult<Json<PageResponse<WorkoutShareResponse>>> {
    let mut conn = state.pool.acquire().await?;
    db::workouts::find(&mut *conn, path.workout_id, user.id)
        .await?
        .ok_or(AppError::NotFound)?;
    let rows =
        db::workout_shares::list(&mut *conn, path.workout_id, paging.limit(), paging.offset())
            .await?;
    let total = db::workout_shares::count(&mut *conn, path.workout_id).await?;
    Ok(Json(paging.respond(
        rows.into_iter().map(Into::into).collect(),
        total,
    )))
}

async fn share(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<WorkoutSharePath>,
) -> AppResult<NoContent> {
    let mut tx = state.pool.begin().await?;
    db::workouts::find(&mut *tx, path.workout_id, user.id)
        .await?
        .ok_or(AppError::NotFound)?;
    if !db::coaching::is_coach(&mut *tx, user.id, path.coach_id).await? {
        tracing::debug!(athlete_id = %user.id, coach_id = %path.coach_id, "not a coach to share with");
        return Err(AppError::NotFound);
    }
    db::workout_shares::insert(&mut *tx, path.workout_id, path.coach_id).await?;
    tx.commit().await?;
    tracing::debug!(workout_id = %path.workout_id, coach_id = %path.coach_id, "workout shared");
    Ok(NoContent)
}

async fn unshare(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<WorkoutSharePath>,
) -> AppResult<NoContent> {
    let mut conn = state.pool.acquire().await?;
    if db::workouts::find(&mut *conn, path.workout_id, user.id)
        .await?
        .is_some()
    {
        db::workout_shares::delete(&mut *conn, path.workout_id, path.coach_id).await?;
        tracing::debug!(workout_id = %path.workout_id, coach_id = %path.coach_id, "workout unshared");
    }
    Ok(NoContent)
}
