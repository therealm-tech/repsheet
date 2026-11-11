use aide::axum::{
    ApiRouter,
    routing::{delete_with, get_with, post_with, put_with},
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
        invitations::take_for_sign_up,
        pagination::{MAX_PER_PAGE, PageQuery, PageResponse},
        search::search_text,
    },
    auth::{self, AuthUser},
    db::{self, invitations::NewAccount, users::UserRow},
    domain::{Locale, Role, WeightUnit},
    error::{AppError, AppResult, Conflict, conflict_on_unique},
};

pub fn routes() -> ApiRouter<AppState> {
    ApiRouter::new()
        .api_route(
            "/v1/users",
            post_with(create, |op| {
                op.tag("Authentication")
                    .id("createUser")
                    .summary("Create an account")
                    .description(
                        "Then obtain a token with `POST /v1/tokens`. With an `invitation`, \
                         the invited profile becomes the account, with its workouts, its \
                         planned sessions and its coach.",
                    )
            })
            .get_with(list, |op| {
                authenticated(op)
                    .tag("Users")
                    .id("listUsers")
                    .summary("List the accounts")
                    .description("Super admins only.")
            }),
        )
        .api_route(
            "/v1/users/me",
            get_with(me, |op| {
                authenticated(op)
                    .tag("Authentication")
                    .id("getCurrentUser")
                    .summary("Get the authenticated user")
            }),
        )
        .api_route(
            "/v1/users/me/preferences",
            put_with(update_preferences, |op| {
                authenticated(op)
                    .tag("Authentication")
                    .id("updateCurrentUserPreferences")
                    .summary("Set the authenticated user's preferences")
                    .description("The language also picks the name returned for each exercise.")
            }),
        )
        .api_route(
            "/v1/users/{userId}",
            delete_with(delete, |op| {
                authenticated(op)
                    .tag("Users")
                    .id("deleteUser")
                    .summary("Delete an account and everything it owns")
                    .description(
                        "Super admins only; a super admin cannot delete their own account.",
                    )
            }),
        )
        .api_route(
            "/v1/users/{userId}/role",
            put_with(update_role, |op| {
                authenticated(op)
                    .tag("Users")
                    .id("updateUserRole")
                    .summary("Set an account's role")
                    .description(
                        "Super admins only; a super admin cannot change their own role. The \
                         account named by the server configuration gets the super admin role \
                         back on every start-up.",
                    )
            }),
        )
}

#[derive(Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(rename = "WeightUnit")]
pub enum WeightUnitDto {
    Kg,
    Lb,
}

impl From<WeightUnitDto> for WeightUnit {
    fn from(unit: WeightUnitDto) -> Self {
        match unit {
            WeightUnitDto::Kg => Self::Kg,
            WeightUnitDto::Lb => Self::Lb,
        }
    }
}

impl From<WeightUnit> for WeightUnitDto {
    fn from(unit: WeightUnit) -> Self {
        match unit {
            WeightUnit::Kg => Self::Kg,
            WeightUnit::Lb => Self::Lb,
        }
    }
}

/// Language of the interface and of the exercise names.
#[derive(Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(rename = "Locale")]
pub enum LocaleDto {
    Fr,
    En,
}

impl From<LocaleDto> for Locale {
    fn from(locale: LocaleDto) -> Self {
        match locale {
            LocaleDto::Fr => Self::Fr,
            LocaleDto::En => Self::En,
        }
    }
}

impl From<Locale> for LocaleDto {
    fn from(locale: Locale) -> Self {
        match locale {
            Locale::Fr => Self::Fr,
            Locale::En => Self::En,
        }
    }
}

/// `superAdmin` accounts manage the other accounts and the built-in catalog.
#[derive(Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(rename = "Role")]
pub enum RoleDto {
    User,
    SuperAdmin,
}

impl From<RoleDto> for Role {
    fn from(role: RoleDto) -> Self {
        match role {
            RoleDto::User => Self::User,
            RoleDto::SuperAdmin => Self::SuperAdmin,
        }
    }
}

impl From<Role> for RoleDto {
    fn from(role: Role) -> Self {
        match role {
            Role::User => Self::User,
            Role::SuperAdmin => Self::SuperAdmin,
        }
    }
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
#[schemars(extend("example" = serde_json::json!({
    "name": "Guillaume",
    "email": "guillaume@example.com",
    "password": "correct horse battery",
    "weightUnit": "kg",
    "locale": "fr"
})))]
pub struct CreateUserRequest {
    #[validate(length(min = 1, max = 100), custom(function = not_blank))]
    pub name: String,
    #[validate(email)]
    pub email: String,
    #[validate(length(min = 8, max = 128))]
    pub password: String,
    /// Unit the user enters and reads weights in. Weights are always
    /// exchanged in kilograms.
    pub weight_unit: WeightUnitDto,
    pub locale: LocaleDto,
    /// A token from a coach's invitation, to turn the profile they manage
    /// into this account. 422 when it is unknown, used or expired.
    pub invitation: Option<String>,
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePreferencesRequest {
    pub locale: LocaleDto,
    pub weight_unit: WeightUnitDto,
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct UpdateUserRoleRequest {
    pub role: RoleDto,
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct ListUsersQuery {
    /// Search in the name (case- and accent-insensitive) and the email
    #[validate(length(max = 100))]
    pub q: Option<String>,
    /// 1-based page number (default 1)
    #[validate(range(min = 1))]
    pub page: Option<u32>,
    /// Items per page (default 50, at most 100)
    #[validate(range(min = 1, max = MAX_PER_PAGE))]
    pub per_page: Option<u32>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UserPath {
    pub user_id: Uuid,
}

/// The account that wrote something, as anyone who reads it sees them.
#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuthorResponse {
    pub id: Uuid,
    pub name: String,
}

/// The author of a row whose `author_id` is set to null when their account
/// is deleted.
pub fn author(id: Option<Uuid>, name: Option<String>) -> Option<AuthorResponse> {
    Some(AuthorResponse {
        id: id?,
        name: name?,
    })
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UserResponse {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    pub weight_unit: WeightUnitDto,
    pub role: RoleDto,
    pub locale: LocaleDto,
    pub created_at: DateTime<Utc>,
}

impl From<UserRow> for UserResponse {
    fn from(row: UserRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            email: row.email,
            weight_unit: row.weight_unit.into(),
            role: row.role.into(),
            locale: row.locale.into(),
            created_at: row.created_at,
        }
    }
}

async fn create(
    State(state): State<AppState>,
    ValidJson(request): ValidJson<CreateUserRequest>,
) -> AppResult<Created<UserResponse>> {
    let password_hash = auth::hash_password(request.password).await?;
    let mut tx = state.pool.begin().await?;
    let row = if let Some(token) = request.invitation.as_deref() {
        let taken = take_for_sign_up(&mut tx, token).await?;
        let account = NewAccount {
            name: request.name.trim(),
            email: request.email.trim(),
            password_hash: &password_hash,
            weight_unit: request.weight_unit.into(),
            locale: request.locale.into(),
        };
        db::invitations::claim(&mut *tx, taken.athlete_id, &account)
            .await
            .map_err(|e| conflict_on_unique(e, Conflict::EmailTaken))?
            .ok_or_else(|| anyhow::anyhow!("an invited profile is no longer managed"))?
    } else {
        db::users::insert(
            &mut *tx,
            request.name.trim(),
            request.email.trim(),
            &password_hash,
            request.weight_unit.into(),
            request.locale.into(),
        )
        .await
        .map_err(|e| conflict_on_unique(e, Conflict::EmailTaken))?
    };
    tx.commit().await?;
    tracing::info!(user_id = %row.id, invited = request.invitation.is_some(), "account created");
    Ok(Created {
        location: "/v1/users/me".to_owned(),
        body: row.into(),
    })
}

async fn me(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<UserResponse>> {
    let row = db::users::find(&state.pool, user.id)
        .await?
        .ok_or(AppError::Unauthorized)?;
    Ok(Json(row.into()))
}

async fn update_preferences(
    State(state): State<AppState>,
    user: AuthUser,
    ValidJson(request): ValidJson<UpdatePreferencesRequest>,
) -> AppResult<Json<UserResponse>> {
    let row = db::users::update_preferences(
        &state.pool,
        user.id,
        request.locale.into(),
        request.weight_unit.into(),
    )
    .await?
    .ok_or(AppError::Unauthorized)?;
    Ok(Json(row.into()))
}

async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    ValidQuery(query): ValidQuery<ListUsersQuery>,
) -> AppResult<Json<PageResponse<UserResponse>>> {
    user.require_super_admin()?;
    let paging = PageQuery {
        page: query.page,
        per_page: query.per_page,
    };
    let search = search_text(query.q.as_deref());
    let rows = db::users::list(
        &state.pool,
        search.as_deref(),
        paging.limit(),
        paging.offset(),
    )
    .await?;
    let total = db::users::count(&state.pool, search.as_deref()).await?;
    Ok(Json(paging.respond(
        rows.into_iter().map(Into::into).collect(),
        total,
    )))
}

async fn update_role(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<UserPath>,
    ValidJson(request): ValidJson<UpdateUserRoleRequest>,
) -> AppResult<Json<UserResponse>> {
    user.require_super_admin()?;
    if path.user_id == user.id {
        return Err(AppError::Conflict(Conflict::OwnRole));
    }
    let role: Role = request.role.into();
    let row = db::users::update_role(&state.pool, path.user_id, role)
        .await?
        .ok_or(AppError::NotFound)?;
    tracing::info!(by = %user.id, user_id = %row.id, %role, "role changed");
    Ok(Json(row.into()))
}

async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<UserPath>,
) -> AppResult<NoContent> {
    user.require_super_admin()?;
    if path.user_id == user.id {
        return Err(AppError::Conflict(Conflict::OwnAccount));
    }
    let mut tx = state.pool.begin().await?;
    db::users::delete(&mut tx, path.user_id).await?;
    tx.commit().await?;
    tracing::info!(by = %user.id, user_id = %path.user_id, "account deleted");
    Ok(NoContent)
}
