//! Library half of the `repsheet-api` binary: the router and its state live
//! here so that the integration tests can drive them without a socket.

mod api;
mod auth;
mod bootstrap;
pub mod config;
mod db;
mod domain;
mod error;

pub use api::{AppState, app};
pub use bootstrap::ensure_super_admin;

/// The schema migrations, embedded at compile time.
pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();
