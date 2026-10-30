//! Persistence: one module per aggregate, each running the SQL kept under
//! `queries/`. Rows stay here; the HTTP layer maps them to its own DTOs.

pub mod exercises;
pub mod templates;
pub mod tokens;
pub mod users;
pub mod workouts;
