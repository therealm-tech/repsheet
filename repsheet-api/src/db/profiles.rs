//! Ending a coach's management of a profile by merging it into the
//! athlete's account, whether through an invitation or by the coach.

use sqlx::PgConnection;
use uuid::Uuid;

/// Whether `coach_id` manages `profile_id` and coaches the account
/// `account_id`; locks the profile until the transaction ends when so.
pub async fn lock_mergeable(
    conn: &mut PgConnection,
    profile_id: Uuid,
    coach_id: Uuid,
    account_id: Uuid,
) -> sqlx::Result<bool> {
    let row: Option<Uuid> =
        sqlx::query_scalar(include_str!("../../queries/profiles/lock_mergeable.sql"))
            .bind(profile_id)
            .bind(coach_id)
            .bind(account_id)
            .fetch_optional(conn)
            .await?;
    Ok(row.is_some())
}

/// Shares the workouts of `profile_id` with `coach_id`, who logged them and
/// keeps reading them once they no longer manage it.
pub async fn share_with_coach(
    conn: &mut PgConnection,
    profile_id: Uuid,
    coach_id: Uuid,
) -> sqlx::Result<()> {
    sqlx::query(include_str!("../../queries/profiles/share_with_coach.sql"))
        .bind(profile_id)
        .bind(coach_id)
        .execute(conn)
        .await?;
    Ok(())
}

/// Moves what `profile_id` holds to `account_id`, links its coach `coach_id`
/// to that account, then deletes the profile with its invitation. The
/// workouts the coach logged stay shared with them.
pub async fn merge(
    conn: &mut PgConnection,
    profile_id: Uuid,
    coach_id: Uuid,
    account_id: Uuid,
) -> sqlx::Result<()> {
    share_with_coach(conn, profile_id, coach_id).await?;
    for query in [
        include_str!("../../queries/profiles/move_workouts.sql"),
        include_str!("../../queries/profiles/move_templates.sql"),
    ] {
        sqlx::query(query)
            .bind(profile_id)
            .bind(account_id)
            .execute(&mut *conn)
            .await?;
    }
    sqlx::query(include_str!("../../queries/coaching/insert_if_missing.sql"))
        .bind(account_id)
        .bind(coach_id)
        .execute(&mut *conn)
        .await?;
    crate::db::users::delete(conn, profile_id).await
}
