use aide::axum::{
    ApiRouter,
    routing::{get_with, post_with},
};
use axum::{Json, extract::State};
use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    api::{
        AppState, authenticated,
        coaching::{AthletePath, CoachResponse, require_manager},
        extract::{Created, PathParams},
    },
    auth::{self, AuthUser},
    db,
    error::{AppError, AppResult, FieldError},
};

/// How long an invitation stays valid.
const INVITATION_TTL: chrono::TimeDelta = chrono::TimeDelta::days(7);

pub fn routes() -> ApiRouter<AppState> {
    ApiRouter::new()
        .api_route(
            "/v1/users/me/athletes/{athleteId}/invitations",
            post_with(create, |op| {
                authenticated(op)
                    .tag("Coaching")
                    .id("createInvitation")
                    .summary("Invite the athlete of a profile the caller manages")
                    .description(
                        "Returns a one-time token, valid for 7 days, that turns the profile \
                         into an account at sign-up (`invitation` on `POST /v1/users`) or \
                         merges it into an existing one (`POST \
                         /v1/invitations/{token}/acceptances`). A new invitation replaces the \
                         previous one. 403 (`not-manager`) for an athlete with an account.",
                    )
            }),
        )
        .api_route(
            "/v1/invitations/{token}",
            get_with(get, |op| {
                op.tag("Coaching")
                    .id("getInvitation")
                    .summary("Read an invitation, before signing up or logging in with it")
                    .description("404 once it is used, replaced or expired.")
            }),
        )
        .api_route(
            "/v1/invitations/{token}/acceptances",
            post_with(accept, |op| {
                authenticated(op)
                    .tag("Coaching")
                    .id("acceptInvitation")
                    .summary("Merge the invited profile into the caller's account")
                    .description(
                        "The profile's workouts and planned sessions become the caller's, \
                         its coach becomes theirs, and the profile is deleted. Returns that \
                         coach. The workouts the coach logged stay shared with them.",
                    )
            }),
        )
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InvitationPath {
    pub token: String,
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreatedInvitationResponse {
    /// Shown once: only its digest is stored.
    pub token: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InvitationResponse {
    /// The name the coach gave the profile.
    pub athlete_name: String,
    pub coach_name: String,
    /// The workouts the profile already holds.
    pub workout_count: i64,
    pub expires_at: DateTime<Utc>,
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<AthletePath>,
) -> AppResult<Created<CreatedInvitationResponse>> {
    let mut conn = state.pool.acquire().await?;
    require_manager(&mut conn, &user, path.athlete_id).await?;
    let (token, digest) = auth::generate_token();
    let expires_at = Utc::now() + INVITATION_TTL;
    db::invitations::upsert(&mut *conn, path.athlete_id, &digest, expires_at).await?;
    tracing::info!(coach_id = %user.id, athlete_id = %path.athlete_id, "athlete invited");
    Ok(Created {
        location: format!("/v1/invitations/{token}"),
        body: CreatedInvitationResponse { token, expires_at },
    })
}

async fn get(
    State(state): State<AppState>,
    PathParams(path): PathParams<InvitationPath>,
) -> AppResult<Json<InvitationResponse>> {
    let row = db::invitations::find(&state.pool, &auth::token_digest(&path.token))
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(InvitationResponse {
        athlete_name: row.athlete_name,
        coach_name: row.coach_name,
        workout_count: row.workout_count,
        expires_at: row.expires_at,
    }))
}

async fn accept(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<InvitationPath>,
) -> AppResult<Created<CoachResponse>> {
    let mut tx = state.pool.begin().await?;
    let taken = db::invitations::take(&mut *tx, &auth::token_digest(&path.token))
        .await?
        .ok_or(AppError::NotFound)?;
    if taken.coach_id == user.id {
        return Err(AppError::OwnCoach);
    }
    db::profiles::merge(&mut tx, taken.athlete_id, taken.coach_id, user.id).await?;
    let coach = db::coaching::find_coach(&mut *tx, user.id, taken.coach_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("a merged profile's coach is not linked"))?;
    tx.commit().await?;
    tracing::info!(
        user_id = %user.id,
        athlete_id = %taken.athlete_id,
        coach_id = %taken.coach_id,
        "invitation accepted into an account"
    );
    Ok(Created {
        location: format!("/v1/users/me/coaches/{}", taken.coach_id),
        body: coach.into(),
    })
}

/// Uses up an invitation at sign-up; the field error names the request's
/// `invitation` when it is unknown, used or expired.
pub(super) async fn take_for_sign_up(
    conn: &mut sqlx::PgConnection,
    token: &str,
) -> AppResult<db::invitations::TakenInvitation> {
    db::invitations::take(&mut *conn, &auth::token_digest(token))
        .await?
        .ok_or_else(|| {
            AppError::Validation(vec![FieldError::new(
                "invitation",
                "unknown, used or expired invitation",
            )])
        })
}
