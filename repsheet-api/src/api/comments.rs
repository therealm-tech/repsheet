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
        extract::{Created, PathParams, ValidJson, not_blank},
        users::{AuthorResponse, author},
    },
    auth::AuthUser,
    db::{
        self,
        comments::{CommentAccessRow, CommentRow},
    },
    error::{AppError, AppResult, FieldError},
};

pub fn routes() -> ApiRouter<AppState> {
    ApiRouter::new()
        .api_route(
            "/v1/comments",
            post_with(create, |op| {
                authenticated(op)
                    .tag("Comments")
                    .id("createComment")
                    .summary("Comment on an exercise of a logged block")
                    .description(
                        "Open to whoever reads the workout: its owner, and a coach who reads \
                         it. The comment is added at the end of the exercise's thread.",
                    )
            }),
        )
        .api_route(
            "/v1/comments/{commentId}",
            get_with(get, |op| {
                authenticated(op)
                    .tag("Comments")
                    .id("getComment")
                    .summary("Get a comment")
            })
            .put_with(update, |op| {
                authenticated(op)
                    .tag("Comments")
                    .id("updateComment")
                    .summary("Replace the text of a comment")
                    .description("By its author only (403 `not-author` otherwise).")
            })
            .delete_with(delete, |op| {
                authenticated(op)
                    .tag("Comments")
                    .id("deleteComment")
                    .summary("Delete a comment")
                    .description(
                        "By its author, or by the owner of the workout it is on (403 \
                         `not-author` otherwise).",
                    )
            }),
        )
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CommentResponse {
    pub id: Uuid,
    pub block_exercise_id: Uuid,
    /// None once the author's account is deleted.
    pub author: Option<AuthorResponse>,
    pub text: String,
    pub created_at: DateTime<Utc>,
    /// Later than `createdAt` once the comment is edited.
    pub updated_at: DateTime<Utc>,
}

impl From<CommentRow> for CommentResponse {
    fn from(row: CommentRow) -> Self {
        Self {
            id: row.id,
            block_exercise_id: row.block_exercise_id,
            author: author(row.author_id, row.author_name),
            text: row.text,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct CreateCommentRequest {
    /// The `id` of an exercise of a logged block.
    pub block_exercise_id: Uuid,
    #[validate(length(max = 2000), custom(function = not_blank))]
    pub text: String,
}

#[derive(Deserialize, JsonSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCommentRequest {
    #[validate(length(max = 2000), custom(function = not_blank))]
    pub text: String,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CommentPath {
    pub comment_id: Uuid,
}

/// The comment, if the caller may read the workout it is on.
async fn find_readable(
    conn: &mut sqlx::PgConnection,
    id: Uuid,
    user: &AuthUser,
) -> AppResult<Option<CommentAccessRow>> {
    let Some(found) = db::comments::find(&mut *conn, id).await? else {
        return Ok(None);
    };
    Ok(
        db::workouts::find_readable(&mut *conn, found.workout_id, user.id)
            .await?
            .map(|_| found),
    )
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    ValidJson(request): ValidJson<CreateCommentRequest>,
) -> AppResult<Created<CommentResponse>> {
    let mut conn = state.pool.acquire().await?;
    let readable =
        match db::workouts::block_exercise_workout(&mut *conn, request.block_exercise_id).await? {
            Some(workout_id) => db::workouts::find_readable(&mut *conn, workout_id, user.id)
                .await?
                .is_some(),
            None => false,
        };
    if !readable {
        return Err(AppError::Validation(vec![FieldError::new(
            "blockExerciseId",
            "unknown block exercise",
        )]));
    }
    let row = db::comments::insert(
        &mut *conn,
        request.block_exercise_id,
        user.id,
        request.text.trim(),
    )
    .await?;
    tracing::debug!(comment_id = %row.id, block_exercise_id = %row.block_exercise_id, "comment added");
    Ok(Created {
        location: format!("/v1/comments/{}", row.id),
        body: row.into(),
    })
}

async fn get(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<CommentPath>,
) -> AppResult<Json<CommentResponse>> {
    let mut conn = state.pool.acquire().await?;
    let found = find_readable(&mut conn, path.comment_id, &user)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(found.comment.into()))
}

async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<CommentPath>,
    ValidJson(request): ValidJson<UpdateCommentRequest>,
) -> AppResult<Json<CommentResponse>> {
    let mut conn = state.pool.acquire().await?;
    let found = find_readable(&mut conn, path.comment_id, &user)
        .await?
        .ok_or(AppError::NotFound)?;
    if found.comment.author_id != Some(user.id) {
        return Err(AppError::NotAuthor);
    }
    let row = db::comments::update(&mut *conn, path.comment_id, request.text.trim()).await?;
    Ok(Json(row.into()))
}

async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    PathParams(path): PathParams<CommentPath>,
) -> AppResult<NoContent> {
    let mut conn = state.pool.acquire().await?;
    let Some(found) = find_readable(&mut conn, path.comment_id, &user).await? else {
        return Ok(NoContent);
    };
    if found.comment.author_id != Some(user.id) && found.owner_id != user.id {
        return Err(AppError::NotAuthor);
    }
    db::comments::delete(&mut *conn, path.comment_id).await?;
    Ok(NoContent)
}
