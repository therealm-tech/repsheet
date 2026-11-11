use aide::axum::{
    ApiRouter,
    routing::{get_with, post_with},
};
use axum::{Json, extract::State, response::NoContent};
use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use validator::Validate;

use crate::{
    api::{
        AppState, authenticated,
        extract::{Created, PathParams, ValidJson, ValidQuery, not_blank},
        pagination::{PageQuery, PageResponse},
        users::WeightUnitDto,
    },
    auth::AuthUser,
    db::{
        self,
        coaching::{AthleteRow, LinkedAccountRow},
    },
    error::{AppError, AppResult, Conflict, conflict_on_unique},
};

pub fn routes() -> ApiRouter<AppState> {
    coach_routes().merge(athlete_routes())
}

fn coach_routes() -> ApiRouter<AppState> {
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
}

fn athlete_routes() -> ApiRouter<AppState> {
    ApiRouter::new()
        .api_route(
            "/v1/users/me/athletes",
            get_with(list_athletes, |op| {
                authenticated(op)
                    .tag("Coaching")
                    .id("listAthletes")
                    .summary("List the caller's athletes")
                    .description(
                        "The accounts that have the caller as a coach, and the profiles the \
                         caller manages for athletes with no account.",
                    )
            })
            .post_with(create_athlete, |op| {
                authenticated(op)
                    .tag("Coaching")
                    .id("createAthlete")
                    .summary("Create a profile for an athlete with no account")
                    .description(
                        "The caller manages the profile: they plan its sessions, and log, \
                         read and edit all its workouts as their own. It has no email and \
                         cannot log in.",
                    )
            }),
        )
        .api_route(
            "/v1/users/me/athletes/{athleteId}",
            get_with(get_athlete, |op| {
                authenticated(op)
                    .tag("Coaching")
                    .id("getAthlete")
                    .summary("Get one of the caller's athletes")
            })
            .put_with(update_athlete, |op| {
                authenticated(op)
                    .tag("Coaching")
                    .id("updateAthlete")
                    .summary("Rename a profile the caller manages, or change its unit")
                    .description(
                        "403 (`not-manager`) for an athlete who has an account of their own.",
                    )
            })
            .delete_with(delete_athlete, |op| {
                authenticated(op)
                    .tag("Coaching")
                    .id("deleteAthlete")
                    .summary("Delete a profile the caller manages, and all its data")
                    .description(
                        "403 (`not-manager`) for an athlete who has an account of their own.",
                    )
            }),
        )
        .api_route(
            "/v1/users/me/athletes/{athleteId}/merges",
            post_with(merge_athlete, |op| {
                authenticated(op)
                    .tag("Coaching")
                    .id("mergeAthlete")
                    .summary(
                        "Merge a profile the caller manages into one of their athletes' accounts",
                    )
                    .description(
                        "For an athlete who has both a profile and an account that added the \
                         caller as a coach. The profile's workouts and planned sessions become \
                         the account's, and the profile is deleted, with its invitation. The \
                         workouts the caller logged stay shared with them. Returns the \
                         account. 404 unless the caller manages the profile and coaches the \
                         account.",
                    )
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
    /// Null for a profile the caller manages, which has no account.
    pub email: Option<String>,
    /// Whether this is a profile the caller manages for an athlete with no
    /// account.
    pub managed: bool,
    /// The unit the athlete reads weights in.
    pub weight_unit: WeightUnitDto,
    /// When this athlete added the caller as a coach, or when the caller
    /// created the profile.
    pub linked_at: DateTime<Utc>,
}

impl From<AthleteRow> for AthleteResponse {
    fn from(row: AthleteRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            email: row.email,
            managed: row.managed,
            weight_unit: row.weight_unit.into(),
            linked_at: row.linked_at,
        }
    }
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
#[schemars(extend("example" = serde_json::json!({ "name": "Marc", "weightUnit": "kg" })))]
pub struct AthleteProfileRequest {
    #[validate(length(min = 1, max = 100), custom(function = not_blank))]
    pub name: String,
    /// Unit the athlete's weights are shown in. Weights are always exchanged
    /// in kilograms.
    pub weight_unit: WeightUnitDto,
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
#[schemars(extend("example" = serde_json::json!({ "email": "coach@example.com" })))]
pub struct CreateCoachRequest {
    /// The email of the coach's account.
    #[validate(email)]
    pub email: String,
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct CreateMergeRequest {
    /// The account the profile merges into: an athlete of the caller's who
    /// has an account.
    pub account_id: Uuid,
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

/// How the caller coaches an athlete.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum Coached {
    /// The athlete has an account and added the caller as a coach.
    Account,
    /// The caller manages the athlete's profile.
    Managed,
}

/// Rejects a caller who is not a coach of `athlete_id`, whether that account
/// exists or not.
pub(super) async fn require_coach(
    conn: &mut sqlx::PgConnection,
    user: &AuthUser,
    athlete_id: Uuid,
) -> AppResult<Coached> {
    match db::coaching::manages(&mut *conn, athlete_id, user.id).await? {
        Some(true) => Ok(Coached::Managed),
        Some(false) => Ok(Coached::Account),
        None => {
            tracing::debug!(coach_id = %user.id, %athlete_id, "rejected a coach action");
            Err(AppError::NotCoach)
        }
    }
}

/// Rejects a caller who does not manage the profile of `athlete_id`.
pub(super) async fn require_manager(
    conn: &mut sqlx::PgConnection,
    user: &AuthUser,
    athlete_id: Uuid,
) -> AppResult<()> {
    match require_coach(conn, user, athlete_id).await? {
        Coached::Managed => Ok(()),
        Coached::Account => {
            tracing::debug!(coach_id = %user.id, %athlete_id, "rejected a manager action");
            Err(AppError::NotManager)
        }
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

async fn create_athlete(
    State(state): State<AppState>,
    user: AuthUser,
    ValidJson(request): ValidJson<AthleteProfileRequest>,
) -> AppResult<Created<AthleteResponse>> {
    let mut tx = state.pool.begin().await?;
    let athlete_id = db::users::insert_profile(
        &mut *tx,
        user.id,
        request.name.trim(),
        request.weight_unit.into(),
        user.locale,
    )
    .await?;
    db::coaching::insert(&mut *tx, athlete_id, user.id).await?;
    let row = db::coaching::find_athlete(&mut *tx, user.id, athlete_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("a profile just created is not linked"))?;
    tx.commit().await?;
    tracing::info!(coach_id = %user.id, %athlete_id, "athlete profile created");
    Ok(Created {
        location: format!("/v1/users/me/athletes/{athlete_id}"),
        body: row.into(),
    })
}

async fn update_athlete(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<AthletePath>,
    ValidJson(request): ValidJson<AthleteProfileRequest>,
) -> AppResult<Json<AthleteResponse>> {
    let mut conn = state.pool.acquire().await?;
    let updated = db::users::update_profile(
        &mut *conn,
        path.athlete_id,
        user.id,
        request.name.trim(),
        request.weight_unit.into(),
    )
    .await?;
    let row = db::coaching::find_athlete(&mut *conn, user.id, path.athlete_id)
        .await?
        .ok_or(AppError::NotFound)?;
    if !updated {
        return Err(AppError::NotManager);
    }
    Ok(Json(row.into()))
}

async fn delete_athlete(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<AthletePath>,
) -> AppResult<NoContent> {
    let mut tx = state.pool.begin().await?;
    match require_manager(&mut tx, &user, path.athlete_id).await {
        Err(AppError::NotCoach) => return Ok(NoContent),
        other => other?,
    }
    db::users::delete(&mut tx, path.athlete_id).await?;
    tx.commit().await?;
    tracing::info!(coach_id = %user.id, athlete_id = %path.athlete_id, "athlete profile deleted");
    Ok(NoContent)
}

async fn merge_athlete(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<AthletePath>,
    ValidJson(request): ValidJson<CreateMergeRequest>,
) -> AppResult<Created<AthleteResponse>> {
    let mut tx = state.pool.begin().await?;
    if !db::profiles::lock_mergeable(&mut tx, path.athlete_id, user.id, request.account_id).await? {
        tracing::debug!(
            coach_id = %user.id,
            athlete_id = %path.athlete_id,
            account_id = %request.account_id,
            "rejected a profile merge"
        );
        return Err(AppError::NotFound);
    }
    db::profiles::merge(&mut tx, path.athlete_id, user.id, request.account_id).await?;
    let row = db::coaching::find_athlete(&mut *tx, user.id, request.account_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("the account a profile merged into is not linked"))?;
    tx.commit().await?;
    tracing::info!(
        coach_id = %user.id,
        athlete_id = %path.athlete_id,
        account_id = %request.account_id,
        "profile merged into an account"
    );
    Ok(Created {
        location: format!("/v1/users/me/athletes/{}", request.account_id),
        body: row.into(),
    })
}
