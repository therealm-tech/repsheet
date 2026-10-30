use anyhow::{Context, bail};
use sqlx::PgPool;
use validator::ValidateEmail;

use crate::{auth, db};

/// Creates the super admin account named by the configuration, or restores
/// its password and role if it exists.
///
/// # Errors
///
/// Fails when the email or the password is not acceptable, or when the
/// database cannot be written.
pub async fn ensure_super_admin(
    pool: &PgPool,
    email: &str,
    password: String,
) -> anyhow::Result<()> {
    let email = email.trim();
    if !email.validate_email() {
        bail!("SUPER_ADMIN_EMAIL is not a valid email address");
    }
    if password.chars().count() < 8 {
        bail!("SUPER_ADMIN_PASSWORD must be at least 8 characters long");
    }
    let hash = auth::hash_password(password).await?;
    let id = db::users::upsert_super_admin(pool, email, &hash)
        .await
        .context("failed to upsert the super admin")?;
    tracing::info!(user_id = %id, "super admin account ready");
    Ok(())
}
