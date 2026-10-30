use aide::OperationInput;
use anyhow::anyhow;
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::{
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    api::AppState,
    db,
    domain::{Locale, Role},
    error::{AppError, AppResult},
};

/// Argon2 is deliberately slow: it runs on the blocking pool so that a login
/// does not stall the async workers.
pub async fn hash_password(password: String) -> AppResult<String> {
    tokio::task::spawn_blocking(move || {
        let hash: PasswordHash = Argon2::default()
            .hash_password(password.as_bytes())
            .map_err(|e| anyhow!("failed to hash a password: {e}"))?;
        Ok(hash.to_string())
    })
    .await
    .map_err(|e| anyhow!("password hashing task failed: {e}"))?
}

pub async fn verify_password(password: String, hash: String) -> AppResult<bool> {
    tokio::task::spawn_blocking(move || {
        Argon2::default()
            .verify_password(password.as_bytes(), hash.as_str())
            .is_ok()
    })
    .await
    .map_err(|e| anyhow!("password verification task failed: {e}").into())
}

/// A fresh bearer token and the digest stored in its place.
pub fn generate_token() -> (String, Vec<u8>) {
    let bytes: [u8; 32] = rand::random();
    let token = URL_SAFE_NO_PAD.encode(bytes);
    let digest = token_digest(&token);
    (token, digest)
}

/// Tokens are 256 random bits, so a fast unsalted digest is enough to keep a
/// database leak from handing out usable tokens.
pub fn token_digest(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

/// The authenticated caller, resolved from the `Authorization: Bearer` header.
pub struct AuthUser {
    pub id: Uuid,
    pub role: Role,
    pub locale: Locale,
    pub token_digest: Vec<u8>,
}

impl AuthUser {
    pub fn is_super_admin(&self) -> bool {
        self.role == Role::SuperAdmin
    }

    pub fn require_super_admin(&self) -> AppResult<()> {
        if self.is_super_admin() {
            Ok(())
        } else {
            tracing::debug!(user_id = %self.id, "rejected a super admin action");
            Err(AppError::Forbidden)
        }
    }
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> AppResult<Self> {
        let token = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .ok_or(AppError::Unauthorized)?;
        let digest = token_digest(token);
        let user = db::tokens::find_user(&state.pool, &digest)
            .await?
            .ok_or_else(|| {
                tracing::debug!("rejected an unknown or expired token");
                AppError::Unauthorized
            })?;
        Ok(Self {
            id: user.id,
            role: user.role,
            locale: user.locale,
            token_digest: digest,
        })
    }
}

/// Documented per operation with `security_requirement`, not as a parameter.
impl OperationInput for AuthUser {}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_hashed_password_verifies() {
        let hash = hash_password("correct horse".into()).await.unwrap();
        assert!(
            verify_password("correct horse".into(), hash.clone())
                .await
                .unwrap()
        );
        assert!(
            !verify_password("battery staple".into(), hash)
                .await
                .unwrap()
        );
    }

    #[test]
    fn tokens_are_unique_and_digested() {
        let (first, digest) = generate_token();
        let (second, _) = generate_token();
        assert_ne!(first, second);
        assert_eq!(digest, token_digest(&first));
        assert_eq!(first.len(), 43);
    }
}
