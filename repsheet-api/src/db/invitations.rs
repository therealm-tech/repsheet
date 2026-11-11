use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgConnection, PgExecutor};
use uuid::Uuid;

use crate::{
    db::{profiles, users::UserRow},
    domain::{Locale, WeightUnit},
};

#[derive(FromRow)]
pub struct InvitationRow {
    pub expires_at: DateTime<Utc>,
    pub athlete_name: String,
    pub coach_name: String,
    pub workout_count: i64,
}

/// The profile an invitation was for, and the coach who manages it.
#[derive(FromRow)]
pub struct TakenInvitation {
    pub athlete_id: Uuid,
    pub coach_id: Uuid,
}

/// The account a profile becomes.
pub struct NewAccount<'a> {
    pub name: &'a str,
    pub email: &'a str,
    pub password_hash: &'a str,
    pub weight_unit: WeightUnit,
    pub locale: Locale,
}

/// Replaces the invitation of `athlete_id` with one for `digest`.
pub async fn upsert(
    exec: impl PgExecutor<'_>,
    athlete_id: Uuid,
    digest: &[u8],
    expires_at: DateTime<Utc>,
) -> sqlx::Result<()> {
    sqlx::query(include_str!("../../queries/invitations/upsert.sql"))
        .bind(athlete_id)
        .bind(digest)
        .bind(expires_at)
        .execute(exec)
        .await?;
    Ok(())
}

pub async fn find(exec: impl PgExecutor<'_>, digest: &[u8]) -> sqlx::Result<Option<InvitationRow>> {
    sqlx::query_as(include_str!("../../queries/invitations/find.sql"))
        .bind(digest)
        .fetch_optional(exec)
        .await
}

/// Uses up the live invitation for `digest`, if there is one.
pub async fn take(
    exec: impl PgExecutor<'_>,
    digest: &[u8],
) -> sqlx::Result<Option<TakenInvitation>> {
    sqlx::query_as(include_str!("../../queries/invitations/take.sql"))
        .bind(digest)
        .fetch_optional(exec)
        .await
}

/// Turns the invited profile into an account; a unique violation when the
/// email is taken. The workouts its coach logged stay shared with them.
pub async fn claim(
    conn: &mut PgConnection,
    taken: &TakenInvitation,
    account: &NewAccount<'_>,
) -> sqlx::Result<Option<UserRow>> {
    profiles::share_with_coach(conn, taken.athlete_id, taken.coach_id).await?;
    sqlx::query_as(include_str!("../../queries/users/claim_profile.sql"))
        .bind(taken.athlete_id)
        .bind(account.name)
        .bind(account.email)
        .bind(account.password_hash)
        .bind(account.weight_unit.as_str())
        .bind(account.locale.as_str())
        .fetch_optional(conn)
        .await
}
