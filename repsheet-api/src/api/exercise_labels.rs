use aide::axum::{
    ApiRouter,
    routing::{get_with, put_with},
};
use axum::{Json, extract::State};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use validator::{Validate, ValidationError};

use crate::{
    api::{
        AppState, authenticated,
        exercises::ExercisePath,
        extract::{PathParams, ValidJson, ValidQuery},
        pagination::{PageQuery, PageResponse},
    },
    auth::AuthUser,
    db::{self, exercise_labels::LabelRow},
    error::{AppError, AppResult},
};

pub const MAX_LABEL_LENGTH: u64 = 30;

pub fn routes() -> ApiRouter<AppState> {
    ApiRouter::new()
        .api_route(
            "/v1/exercises/{exerciseId}/labels",
            put_with(replace, |op| {
                authenticated(op)
                    .tag("Exercises")
                    .id("replaceExerciseLabels")
                    .summary("Replace the user's labels on an exercise")
                    .description(
                        "Labels are private to the user, on built-in and custom exercises \
                         alike. They compare ignoring case and accents: a label the user \
                         already has on another exercise keeps that spelling, and two labels \
                         that compare equal are kept once.",
                    )
            }),
        )
        .api_route(
            "/v1/exercise-labels",
            get_with(list, |op| {
                authenticated(op)
                    .tag("Exercises")
                    .id("listExerciseLabels")
                    .summary("List the user's exercise labels")
                    .description("In alphabetical order, ignoring case and accents.")
            }),
        )
}

fn short_labels(labels: &[String]) -> Result<(), ValidationError> {
    if labels.iter().any(|label| {
        let length = label.trim().chars().count() as u64;
        length == 0 || length > MAX_LABEL_LENGTH
    }) {
        let mut error = ValidationError::new("label_length");
        error.message = Some(format!("each label has 1 to {MAX_LABEL_LENGTH} characters").into());
        return Err(error);
    }
    Ok(())
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceExerciseLabelsRequest {
    /// Every label the exercise should carry, 1 to 30 characters each once
    /// trimmed; empty removes them all.
    #[validate(length(max = 10), custom(function = short_labels))]
    pub labels: Vec<String>,
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExerciseLabelsResponse {
    /// In alphabetical order, ignoring case and accents.
    pub labels: Vec<String>,
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExerciseLabelResponse {
    pub name: String,
    /// The number of exercises the user put the label on.
    pub exercise_count: i64,
}

impl From<LabelRow> for ExerciseLabelResponse {
    fn from(row: LabelRow) -> Self {
        Self {
            name: row.name,
            exercise_count: row.exercise_count,
        }
    }
}

async fn replace(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<ExercisePath>,
    ValidJson(request): ValidJson<ReplaceExerciseLabelsRequest>,
) -> AppResult<Json<ExerciseLabelsResponse>> {
    let mut tx = state.pool.begin().await?;
    db::exercises::find(&mut *tx, path.exercise_id, user.id, user.locale)
        .await?
        .ok_or(AppError::NotFound)?;
    let requested: Vec<&str> = request.labels.iter().map(|l| l.trim()).collect();
    let labels =
        db::exercise_labels::replace(&mut tx, user.id, path.exercise_id, &requested).await?;
    tx.commit().await?;
    tracing::debug!(exercise_id = %path.exercise_id, labels = labels.len(), "exercise labels replaced");
    Ok(Json(ExerciseLabelsResponse { labels }))
}

async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    ValidQuery(paging): ValidQuery<PageQuery>,
) -> AppResult<Json<PageResponse<ExerciseLabelResponse>>> {
    let rows =
        db::exercise_labels::list(&state.pool, user.id, paging.limit(), paging.offset()).await?;
    let total = db::exercise_labels::count(&state.pool, user.id).await?;
    Ok(Json(paging.respond(
        rows.into_iter().map(Into::into).collect(),
        total,
    )))
}
