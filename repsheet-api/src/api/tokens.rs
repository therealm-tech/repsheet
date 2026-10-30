use aide::axum::{
    ApiRouter,
    routing::{delete_with, post_with},
};
use axum::{extract::State, response::NoContent};
use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use validator::Validate;

use crate::{
    api::{
        AppState, authenticated,
        extract::{Created, ValidJson},
    },
    auth::{self, AuthUser},
    db,
    error::{AppError, AppResult},
};

pub fn routes() -> ApiRouter<AppState> {
    ApiRouter::new()
        .api_route(
            "/v1/tokens",
            post_with(create, |op| {
                op.tag("Authentication")
                    .id("createToken")
                    .summary("Log in")
                    .description(
                        "Exchanges credentials for a bearer token, to send as \
                         `Authorization: Bearer <token>` on every other request.",
                    )
            }),
        )
        .api_route(
            "/v1/tokens/current",
            delete_with(delete_current, |op| {
                authenticated(op)
                    .tag("Authentication")
                    .id("deleteCurrentToken")
                    .summary("Log out")
                    .description("Revokes the token the request is authenticated with.")
            }),
        )
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct CreateTokenRequest {
    #[validate(length(min = 1))]
    pub email: String,
    #[validate(length(min = 1))]
    pub password: String,
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TokenResponse {
    pub token: String,
    pub expires_at: DateTime<Utc>,
}

async fn create(
    State(state): State<AppState>,
    ValidJson(request): ValidJson<CreateTokenRequest>,
) -> AppResult<Created<TokenResponse>> {
    let credentials = db::users::find_credentials(&state.pool, request.email.trim()).await?;
    let Some(credentials) = credentials else {
        // Spend the same time as a real check, so that response times do not
        // reveal which emails have an account.
        auth::hash_password(request.password).await?;
        tracing::debug!("login attempt for an unknown email");
        return Err(AppError::InvalidCredentials);
    };
    if !auth::verify_password(request.password, credentials.password_hash).await? {
        tracing::debug!(user_id = %credentials.id, "login attempt with a wrong password");
        return Err(AppError::InvalidCredentials);
    }
    let (token, digest) = auth::generate_token();
    let expires_at = Utc::now() + state.token_ttl;
    db::tokens::insert(&state.pool, credentials.id, &digest, expires_at).await?;
    tracing::debug!(user_id = %credentials.id, %expires_at, "token issued");
    Ok(Created {
        location: "/v1/tokens/current".to_owned(),
        body: TokenResponse { token, expires_at },
    })
}

async fn delete_current(State(state): State<AppState>, user: AuthUser) -> AppResult<NoContent> {
    db::tokens::delete(&state.pool, &user.token_digest).await?;
    tracing::debug!(user_id = %user.id, "token revoked");
    Ok(NoContent)
}
