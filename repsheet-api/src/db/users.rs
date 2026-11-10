use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgConnection, PgExecutor};
use uuid::Uuid;

use crate::domain::{Locale, Role, WeightUnit};

#[derive(FromRow)]
pub struct UserRow {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    #[sqlx(try_from = "String")]
    pub weight_unit: WeightUnit,
    #[sqlx(try_from = "String")]
    pub role: Role,
    #[sqlx(try_from = "String")]
    pub locale: Locale,
    pub created_at: DateTime<Utc>,
}

#[derive(FromRow)]
pub struct CredentialsRow {
    pub id: Uuid,
    pub password_hash: String,
}

pub async fn insert(
    exec: impl PgExecutor<'_>,
    name: &str,
    email: &str,
    password_hash: &str,
    weight_unit: WeightUnit,
    locale: Locale,
) -> sqlx::Result<UserRow> {
    sqlx::query_as(include_str!("../../queries/users/insert.sql"))
        .bind(name)
        .bind(email)
        .bind(password_hash)
        .bind(weight_unit.as_str())
        .bind(locale.as_str())
        .fetch_one(exec)
        .await
}

pub async fn find(exec: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<Option<UserRow>> {
    sqlx::query_as(include_str!("../../queries/users/find.sql"))
        .bind(id)
        .fetch_optional(exec)
        .await
}

pub async fn find_id_by_email(
    exec: impl PgExecutor<'_>,
    email: &str,
) -> sqlx::Result<Option<Uuid>> {
    sqlx::query_scalar(include_str!("../../queries/users/find_id_by_email.sql"))
        .bind(email)
        .fetch_optional(exec)
        .await
}

pub async fn find_credentials(
    exec: impl PgExecutor<'_>,
    email: &str,
) -> sqlx::Result<Option<CredentialsRow>> {
    sqlx::query_as(include_str!("../../queries/users/find_credentials.sql"))
        .bind(email)
        .fetch_optional(exec)
        .await
}

/// Creates the configured super admin, or restores its password and role.
pub async fn upsert_super_admin(
    exec: impl PgExecutor<'_>,
    email: &str,
    password_hash: &str,
) -> sqlx::Result<Uuid> {
    sqlx::query_scalar(include_str!("../../queries/users/upsert_super_admin.sql"))
        .bind(email)
        .bind(password_hash)
        .fetch_one(exec)
        .await
}

pub async fn list(
    exec: impl PgExecutor<'_>,
    search: Option<&str>,
    limit: i64,
    offset: i64,
) -> sqlx::Result<Vec<UserRow>> {
    sqlx::query_as(include_str!("../../queries/users/list.sql"))
        .bind(search)
        .bind(limit)
        .bind(offset)
        .fetch_all(exec)
        .await
}

pub async fn count(exec: impl PgExecutor<'_>, search: Option<&str>) -> sqlx::Result<i64> {
    sqlx::query_scalar(include_str!("../../queries/users/count.sql"))
        .bind(search)
        .fetch_one(exec)
        .await
}

pub async fn update_role(
    exec: impl PgExecutor<'_>,
    id: Uuid,
    role: Role,
) -> sqlx::Result<Option<UserRow>> {
    sqlx::query_as(include_str!("../../queries/users/update_role.sql"))
        .bind(id)
        .bind(role.as_str())
        .fetch_optional(exec)
        .await
}

pub async fn update_preferences(
    exec: impl PgExecutor<'_>,
    id: Uuid,
    locale: Locale,
    weight_unit: WeightUnit,
) -> sqlx::Result<Option<UserRow>> {
    sqlx::query_as(include_str!("../../queries/users/update_preferences.sql"))
        .bind(id)
        .bind(locale.as_str())
        .bind(weight_unit.as_str())
        .fetch_optional(exec)
        .await
}

/// Deletes the account and everything it owns. Workouts and templates go
/// first: they reference the account's custom exercises, which the final
/// cascade removes, and Postgres checks those references before a single
/// cascade has reached them.
pub async fn delete(conn: &mut PgConnection, id: Uuid) -> sqlx::Result<()> {
    sqlx::query(include_str!("../../queries/users/delete_workouts.sql"))
        .bind(id)
        .execute(&mut *conn)
        .await?;
    sqlx::query(include_str!("../../queries/users/delete_templates.sql"))
        .bind(id)
        .execute(&mut *conn)
        .await?;
    sqlx::query(include_str!("../../queries/users/delete.sql"))
        .bind(id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}
