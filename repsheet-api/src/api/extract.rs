//! Extractors that turn every rejection into the API's problem document, and
//! validate the payload before the handler sees it.

use aide::{
    OperationInput, OperationOutput,
    generate::GenContext,
    openapi::{Operation, Response as ApiResponse, StatusCode as ApiStatusCode},
};
use axum::{
    Json,
    extract::{FromRequest, FromRequestParts, Path, Query, Request, rejection::JsonRejection},
    http::{StatusCode, header::LOCATION, request::Parts},
    response::{IntoResponse, Response},
};
use schemars::JsonSchema;
use serde::{Serialize, de::DeserializeOwned};
use validator::{Validate, ValidationError};

use crate::error::{AppError, FieldError};

/// A JSON body, deserialised then validated.
pub struct ValidJson<T>(pub T);

impl<T, S> FromRequest<S> for ValidJson<T>
where
    T: DeserializeOwned + Validate,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request(req: Request, state: &S) -> Result<Self, AppError> {
        let Json(value) = Json::<T>::from_request(req, state)
            .await
            .map_err(json_rejection)?;
        value.validate()?;
        Ok(Self(value))
    }
}

fn json_rejection(rejection: JsonRejection) -> AppError {
    match rejection {
        // Well-formed JSON of the wrong shape: a missing field, a wrong type.
        JsonRejection::JsonDataError(err) => {
            AppError::Validation(vec![FieldError::new("body", err.body_text())])
        }
        other => AppError::BadRequest(other.body_text()),
    }
}

impl<T: JsonSchema> OperationInput for ValidJson<T> {
    fn operation_input(ctx: &mut GenContext, operation: &mut Operation) {
        Json::<T>::operation_input(ctx, operation);
    }
}

/// Query parameters, deserialised then validated.
pub struct ValidQuery<T>(pub T);

impl<T, S> FromRequestParts<S> for ValidQuery<T>
where
    T: DeserializeOwned + Validate,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, AppError> {
        let Query(value) = Query::<T>::from_request_parts(parts, state)
            .await
            .map_err(|e| AppError::BadRequest(e.body_text()))?;
        value.validate()?;
        Ok(Self(value))
    }
}

impl<T: JsonSchema> OperationInput for ValidQuery<T> {
    fn operation_input(ctx: &mut GenContext, operation: &mut Operation) {
        Query::<T>::operation_input(ctx, operation);
    }
}

/// Path parameters. An identifier that does not parse cannot name an existing
/// resource, hence the 404.
pub struct PathParams<T>(pub T);

impl<T, S> FromRequestParts<S> for PathParams<T>
where
    T: DeserializeOwned + Send,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, AppError> {
        let Path(value) = Path::<T>::from_request_parts(parts, state)
            .await
            .map_err(|_| AppError::NotFound)?;
        Ok(Self(value))
    }
}

impl<T: JsonSchema> OperationInput for PathParams<T> {
    fn operation_input(ctx: &mut GenContext, operation: &mut Operation) {
        Path::<T>::operation_input(ctx, operation);
    }
}

/// A `201 Created` response with a `Location` header.
pub struct Created<T> {
    pub location: String,
    pub body: T,
}

impl<T: Serialize> IntoResponse for Created<T> {
    fn into_response(self) -> Response {
        (
            StatusCode::CREATED,
            [(LOCATION, self.location)],
            Json(self.body),
        )
            .into_response()
    }
}

impl<T: JsonSchema> OperationOutput for Created<T> {
    type Inner = T;

    fn operation_response(ctx: &mut GenContext, operation: &mut Operation) -> Option<ApiResponse> {
        Json::<T>::operation_response(ctx, operation)
    }

    fn inferred_responses(
        ctx: &mut GenContext,
        operation: &mut Operation,
    ) -> Vec<(Option<ApiStatusCode>, ApiResponse)> {
        Self::operation_response(ctx, operation)
            .map(|response| (Some(ApiStatusCode::Code(201)), response))
            .into_iter()
            .collect()
    }
}

/// Rejects names made only of whitespace, which `length(min = 1)` lets through.
pub fn not_blank(value: &str) -> Result<(), ValidationError> {
    if value.trim().is_empty() {
        let mut error = ValidationError::new("blank");
        error.message = Some("must not be blank".into());
        return Err(error);
    }
    Ok(())
}

/// Trims an optional free text, dropping it when nothing is left.
pub fn trimmed(text: Option<&str>) -> Option<&str> {
    text.map(str::trim).filter(|t| !t.is_empty())
}
