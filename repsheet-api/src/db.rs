//! Persistence: one module per aggregate, each running the SQL kept under
//! `queries/`. Rows stay here; the HTTP layer maps them to its own DTOs.

pub mod exercises;
pub mod templates;
pub mod tokens;
pub mod users;
pub mod workouts;

use sqlx::{
    Decode, Postgres, Type,
    error::BoxDynError,
    postgres::{PgTypeInfo, PgValueRef},
};

use crate::domain::Grip;

// `#[sqlx(try_from = "String")]` cannot produce an `Option`, and a block or
// template exercise's grip is NULL when unknown: the grip decodes on its own.
impl Type<Postgres> for Grip {
    fn type_info() -> PgTypeInfo {
        <&str as Type<Postgres>>::type_info()
    }

    fn compatible(ty: &PgTypeInfo) -> bool {
        <&str as Type<Postgres>>::compatible(ty)
    }
}

impl<'r> Decode<'r, Postgres> for Grip {
    fn decode(value: PgValueRef<'r>) -> Result<Self, BoxDynError> {
        Ok(Self::try_from(<String as Decode<Postgres>>::decode(
            value,
        )?)?)
    }
}
