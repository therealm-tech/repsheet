use aide::OperationOutput;
use axum::{
    Json,
    http::{HeaderValue, StatusCode, header::CONTENT_TYPE},
    response::{IntoResponse, Response},
};
use schemars::JsonSchema;
use serde::Serialize;
use validator::{ValidationErrors, ValidationErrorsKind};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FieldError {
    pub field: String,
    pub message: String,
}

impl FieldError {
    pub fn new(field: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            field: field.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("the request is invalid")]
    Validation(Vec<FieldError>),
    #[error("{0}")]
    BadRequest(String),
    #[error("authentication is required")]
    Unauthorized,
    #[error("the email or the password is wrong")]
    InvalidCredentials,
    #[error("this action is reserved to super admins")]
    Forbidden,
    /// The caller names an account that does not have them as a coach.
    #[error("this account does not have you as a coach")]
    NotCoach,
    /// The caller coaches the athlete but does not manage their profile:
    /// the athlete has an account of their own.
    #[error("this athlete has an account of their own, which only they manage")]
    NotManager,
    /// The caller may read the comment but not change it.
    #[error(
        "only the author of a comment edits it, and only they or the workout's owner delete it"
    )]
    NotAuthor,
    #[error("no account uses this email")]
    UnknownAccount,
    #[error("you cannot be your own coach")]
    OwnCoach,
    #[error("the resource does not exist")]
    NotFound,
    #[error("{}", .0.detail())]
    Conflict(Conflict),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

pub type AppResult<T> = Result<T, AppError>;

/// Why a request conflicts with the current state. Each kind has its own
/// problem `type`, so that a client can tell them apart without parsing text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Conflict {
    EmailTaken,
    ExerciseNameTaken,
    /// A mode an exercise was logged in cannot be removed from it.
    ModeLocked,
    /// Equipment an exercise was logged with cannot be removed from it.
    EquipmentLocked,
    /// A grip an exercise was logged with cannot be removed from it.
    GripLocked,
    /// A workout or a template still references the exercise.
    ExerciseInUse,
    OwnRole,
    OwnAccount,
    CoachAlreadyAdded,
    /// A planned session its athlete was sent cannot be taken back.
    PlannedSessionSent,
    /// A planned session with no block cannot be sent.
    PlannedSessionEmpty,
}

impl Conflict {
    fn kind(self) -> &'static str {
        match self {
            Self::EmailTaken => "urn:repsheet:problem:email-taken",
            Self::ExerciseNameTaken => "urn:repsheet:problem:exercise-name-taken",
            Self::ModeLocked => "urn:repsheet:problem:mode-locked",
            Self::EquipmentLocked => "urn:repsheet:problem:equipment-locked",
            Self::GripLocked => "urn:repsheet:problem:grip-locked",
            Self::ExerciseInUse => "urn:repsheet:problem:exercise-in-use",
            Self::OwnRole => "urn:repsheet:problem:own-role",
            Self::OwnAccount => "urn:repsheet:problem:own-account",
            Self::CoachAlreadyAdded => "urn:repsheet:problem:coach-already-added",
            Self::PlannedSessionSent => "urn:repsheet:problem:planned-session-sent",
            Self::PlannedSessionEmpty => "urn:repsheet:problem:planned-session-empty",
        }
    }

    fn detail(self) -> &'static str {
        match self {
            Self::EmailTaken => "an account already uses this email",
            Self::ExerciseNameTaken => "an exercise with this name already exists",
            Self::ModeLocked => "a mode the exercise was logged in cannot be removed",
            Self::EquipmentLocked => "equipment the exercise was logged with cannot be removed",
            Self::GripLocked => "a grip the exercise was logged with cannot be removed",
            Self::ExerciseInUse => "the exercise is used in a workout or a template",
            Self::OwnRole => "a super admin cannot change their own role",
            Self::OwnAccount => "a super admin cannot delete their own account",
            Self::CoachAlreadyAdded => "this account is already your coach",
            Self::PlannedSessionSent => "the session was sent to the athlete and stays sent",
            Self::PlannedSessionEmpty => "a session needs at least one block to be sent",
        }
    }
}

/// An RFC 9457 problem document, the body of every error response.
#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProblemResponse {
    /// Stable, machine-readable identifier of the problem kind.
    #[serde(rename = "type")]
    pub kind: String,
    pub title: String,
    pub status: u16,
    pub detail: String,
    /// Offending fields, for validation problems.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub errors: Vec<FieldErrorResponse>,
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FieldErrorResponse {
    /// Path of the field in the request, e.g. `exercises[0].sets[2].reps`.
    pub field: String,
    pub message: String,
}

impl AppError {
    fn status_and_kind(&self) -> (StatusCode, &'static str, &'static str) {
        match self {
            Self::Validation(_) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "urn:repsheet:problem:validation",
                "Invalid request",
            ),
            Self::BadRequest(_) => (
                StatusCode::BAD_REQUEST,
                "urn:repsheet:problem:malformed-request",
                "Malformed request",
            ),
            Self::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                "urn:repsheet:problem:unauthenticated",
                "Authentication required",
            ),
            Self::InvalidCredentials => (
                StatusCode::UNAUTHORIZED,
                "urn:repsheet:problem:invalid-credentials",
                "Invalid credentials",
            ),
            Self::Forbidden => (
                StatusCode::FORBIDDEN,
                "urn:repsheet:problem:forbidden",
                "Forbidden",
            ),
            Self::NotCoach => (
                StatusCode::FORBIDDEN,
                "urn:repsheet:problem:not-coach",
                "Forbidden",
            ),
            Self::NotManager => (
                StatusCode::FORBIDDEN,
                "urn:repsheet:problem:not-manager",
                "Forbidden",
            ),
            Self::NotAuthor => (
                StatusCode::FORBIDDEN,
                "urn:repsheet:problem:not-author",
                "Forbidden",
            ),
            Self::UnknownAccount => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "urn:repsheet:problem:unknown-account",
                "Unknown account",
            ),
            Self::OwnCoach => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "urn:repsheet:problem:own-coach",
                "Own coach",
            ),
            Self::NotFound => (
                StatusCode::NOT_FOUND,
                "urn:repsheet:problem:not-found",
                "Not found",
            ),
            Self::Conflict(conflict) => (StatusCode::CONFLICT, conflict.kind(), "Conflict"),
            Self::Database(_) | Self::Internal(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "urn:repsheet:problem:internal",
                "Internal error",
            ),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, kind, title) = self.status_and_kind();
        let detail = match &self {
            Self::Database(err) => {
                tracing::error!(error = %err, "database error");
                "the server failed to process the request".to_owned()
            }
            Self::Internal(err) => {
                tracing::error!(error = ?err, "internal error");
                "the server failed to process the request".to_owned()
            }
            other => other.to_string(),
        };
        let errors = match self {
            Self::Validation(errors) => errors
                .into_iter()
                .map(|e| FieldErrorResponse {
                    field: e.field,
                    message: e.message,
                })
                .collect(),
            _ => Vec::new(),
        };
        let body = ProblemResponse {
            kind: kind.to_owned(),
            title: title.to_owned(),
            status: status.as_u16(),
            detail,
            errors,
        };
        let mut response = (status, Json(body)).into_response();
        response.headers_mut().insert(
            CONTENT_TYPE,
            HeaderValue::from_static("application/problem+json"),
        );
        response
    }
}

impl OperationOutput for AppError {
    type Inner = ();
}

impl From<ValidationErrors> for AppError {
    fn from(errors: ValidationErrors) -> Self {
        let mut fields = Vec::new();
        flatten(&errors, "", &mut fields);
        Self::Validation(fields)
    }
}

fn flatten(errors: &ValidationErrors, prefix: &str, out: &mut Vec<FieldError>) {
    for (field, kind) in errors.errors() {
        // `validator` files a struct-level (`schema`) error under `__all__`:
        // it concerns the struct itself, at `prefix`.
        let path = match (field.as_ref(), prefix.is_empty()) {
            ("__all__", true) => "body".to_owned(),
            ("__all__", false) => prefix.to_owned(),
            (field, true) => camel_case(field),
            (field, false) => format!("{prefix}.{}", camel_case(field)),
        };
        match kind {
            ValidationErrorsKind::Field(errs) => out.extend(errs.iter().map(|e| {
                let message = e
                    .message
                    .as_ref()
                    .map_or_else(|| e.code.to_string(), ToString::to_string);
                FieldError::new(path.clone(), message)
            })),
            ValidationErrorsKind::Struct(nested) => flatten(nested, &path, out),
            ValidationErrorsKind::List(items) => {
                for (index, nested) in items {
                    flatten(nested, &format!("{path}[{index}]"), out);
                }
            }
        }
    }
}

/// `validator` reports Rust field names; the wire uses camelCase.
fn camel_case(field: &str) -> String {
    let mut out = String::with_capacity(field.len());
    let mut upper = false;
    for c in field.chars() {
        if c == '_' {
            upper = true;
        } else if upper {
            out.extend(c.to_uppercase());
            upper = false;
        } else {
            out.push(c);
        }
    }
    out
}

/// Maps a unique-constraint violation to a conflict, anything else to a
/// database error.
pub fn conflict_on_unique(err: sqlx::Error, conflict: Conflict) -> AppError {
    match &err {
        sqlx::Error::Database(db) if db.is_unique_violation() => AppError::Conflict(conflict),
        _ => AppError::Database(err),
    }
}

/// Maps a foreign-key violation (a row still referenced) to a conflict,
/// anything else to a database error.
pub fn conflict_on_reference(err: sqlx::Error, conflict: Conflict) -> AppError {
    match &err {
        sqlx::Error::Database(db) if db.is_foreign_key_violation() => AppError::Conflict(conflict),
        _ => AppError::Database(err),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use validator::Validate;

    #[derive(Validate)]
    struct Inner {
        #[validate(range(min = 1))]
        rest_seconds: i32,
    }

    #[derive(Validate)]
    struct Outer {
        #[validate(length(min = 1))]
        name: String,
        #[validate(nested)]
        blocks: Vec<Inner>,
    }

    #[test]
    fn validation_paths_are_camel_case_and_indexed() {
        let value = Outer {
            name: String::new(),
            blocks: vec![Inner { rest_seconds: 10 }, Inner { rest_seconds: 0 }],
        };
        let AppError::Validation(mut fields) = AppError::from(value.validate().unwrap_err()) else {
            panic!("expected a validation error");
        };
        fields.sort_by(|a, b| a.field.cmp(&b.field));
        let paths: Vec<_> = fields.iter().map(|f| f.field.as_str()).collect();
        assert_eq!(paths, vec!["blocks[1].restSeconds", "name"]);
    }

    #[test]
    fn statuses_match_the_problem_kind() {
        assert_eq!(
            AppError::NotFound.into_response().status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            AppError::Validation(Vec::new()).into_response().status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        let response = AppError::Conflict(Conflict::EmailTaken).into_response();
        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert_eq!(response.headers()[CONTENT_TYPE], "application/problem+json");
    }
}
