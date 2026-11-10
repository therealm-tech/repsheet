mod coaching;
mod exercises;
mod extract;
mod pagination;
mod planned_sessions;
mod search;
mod templates;
mod tokens;
mod users;
mod workout_shares;
mod workouts;

use std::sync::Arc;

use aide::{
    axum::ApiRouter,
    openapi::{Info, OpenApi, SecurityScheme, Tag},
    transform::TransformOperation,
};
use axum::{
    Extension, Json, Router,
    response::{Html, IntoResponse},
    routing::get,
};
use indexmap::IndexMap;
use sqlx::PgPool;
use tower_http::trace::TraceLayer;

/// Shared state handed to every handler.
#[derive(Clone)]
pub struct AppState {
    pub(crate) pool: PgPool,
    pub(crate) token_ttl: chrono::Duration,
}

impl AppState {
    #[must_use]
    pub fn new(pool: PgPool, token_ttl: chrono::Duration) -> Self {
        Self { pool, token_ttl }
    }
}

const BEARER_AUTH: &str = "BearerAuth";

/// Marks an operation as requiring a bearer token.
fn authenticated(op: TransformOperation<'_>) -> TransformOperation<'_> {
    op.security_requirement(BEARER_AUTH)
}

/// Builds the HTTP application: the versioned API, its `OpenAPI` document at
/// `/openapi.json`, the Scalar reference at `/docs` and the `/healthz` probe.
pub fn app(state: AppState) -> Router {
    aide::generate::on_error(|error| tracing::warn!(%error, "OpenAPI generation error"));
    aide::generate::extract_schemas(true);

    let mut api = OpenApi {
        info: Info {
            title: "RepSheet API".to_owned(),
            version: env!("CARGO_PKG_VERSION").to_owned(),
            description: Some(
                "Track strength-training workouts block by block and set by set. \
                 Clients must ignore unknown fields."
                    .to_owned(),
            ),
            ..Info::default()
        },
        tags: [
            (
                "Authentication",
                "Create an account and obtain bearer tokens.",
            ),
            (
                "Exercises",
                "The exercise catalog: built-in exercises and the user's own.",
            ),
            (
                "Workouts",
                "Workouts and the blocks of sets logged in them.",
            ),
            (
                "Templates",
                "Reusable workout plans: blocks of exercises with targets.",
            ),
            (
                "Coaching",
                "Coaches an account adds, who get access to it at once until it removes them, \
                 and the workouts it shares with them.",
            ),
            (
                "Planned sessions",
                "Sessions a coach plans for an athlete on a given day, and the workouts \
                 logged from them.",
            ),
        ]
        .into_iter()
        .map(|(name, description)| Tag {
            name: name.to_owned(),
            description: Some(description.to_owned()),
            ..Tag::default()
        })
        .collect(),
        ..OpenApi::default()
    };

    let router = ApiRouter::new()
        .merge(users::routes())
        .merge(tokens::routes())
        .merge(exercises::routes())
        .merge(workouts::routes())
        .merge(templates::routes())
        .merge(coaching::routes())
        .merge(planned_sessions::routes())
        .merge(workout_shares::routes())
        .finish_api_with(&mut api, |t| {
            t.security_scheme(
                BEARER_AUTH,
                SecurityScheme::Http {
                    scheme: "bearer".into(),
                    bearer_format: None,
                    description: Some("A token obtained from `POST /v1/tokens`.".into()),
                    extensions: IndexMap::default(),
                },
            )
        })
        .with_state(state);

    router
        .route("/openapi.json", get(openapi))
        .route("/docs", get(docs))
        .route("/healthz", get(healthz))
        .layer(Extension(Arc::new(api)))
        .layer(TraceLayer::new_for_http())
}

async fn openapi(Extension(api): Extension<Arc<OpenApi>>) -> impl IntoResponse {
    Json(api)
}

async fn docs() -> Html<&'static str> {
    Html(include_str!("api/docs.html"))
}

async fn healthz() -> &'static str {
    "ok"
}
