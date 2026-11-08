use std::fmt;

#[derive(Debug, thiserror::Error)]
#[error("unknown {kind} `{value}`")]
pub struct UnknownVariant {
    kind: &'static str,
    value: String,
}

/// Declares an enum stored as text in the database, with its string mapping.
macro_rules! text_enum {
    ($name:ident, $kind:literal, { $($variant:ident => $text:literal),+ $(,)? }) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
        pub enum $name {
            $($variant),+
        }

        impl $name {
            pub fn as_str(self) -> &'static str {
                match self {
                    $(Self::$variant => $text),+
                }
            }
        }

        impl TryFrom<String> for $name {
            type Error = UnknownVariant;

            fn try_from(value: String) -> Result<Self, Self::Error> {
                match value.as_str() {
                    $($text => Ok(Self::$variant),)+
                    _ => Err(UnknownVariant { kind: $kind, value }),
                }
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(self.as_str())
            }
        }
    };
}

text_enum!(WeightUnit, "weight unit", {
    Kg => "kg",
    Lb => "lb",
});

text_enum!(Role, "role", {
    User => "user",
    SuperAdmin => "super_admin",
});

text_enum!(Locale, "locale", {
    Fr => "fr",
    En => "en",
});

text_enum!(Mode, "mode", {
    Reps => "reps",
    Time => "time",
    Distance => "distance",
});

text_enum!(Load, "load", {
    None => "none",
    Optional => "optional",
    Required => "required",
});

text_enum!(Equipment, "equipment", {
    Barbell => "barbell",
    Dumbbell => "dumbbell",
    Kettlebell => "kettlebell",
    Machine => "machine",
    Cable => "cable",
    Bodyweight => "bodyweight",
    Other => "other",
});

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlockKind {
    Simple,
    Superset,
    Circuit,
}

impl BlockKind {
    pub fn from_exercise_count(count: usize) -> Self {
        match count {
            0 | 1 => Self::Simple,
            2 => Self::Superset,
            _ => Self::Circuit,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SetValues {
    pub round: i32,
    pub reps: Option<i32>,
    pub weight_kg: Option<f64>,
    pub duration_seconds: Option<i32>,
    pub distance_meters: Option<i32>,
    pub warmup: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SetField {
    Reps,
    WeightKg,
    DurationSeconds,
    DistanceMeters,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SetViolation {
    Missing(SetField),
    Unexpected(SetField),
}

/// The modes an exercise can be counted in: never empty, without duplicates,
/// in the declaration order of [`Mode`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Modes(Vec<Mode>);

impl Modes {
    /// `None` when `modes` is empty or holds a mode twice.
    pub fn new(modes: impl IntoIterator<Item = Mode>) -> Option<Self> {
        let mut modes: Vec<Mode> = modes.into_iter().collect();
        let given = modes.len();
        modes.sort_unstable();
        modes.dedup();
        (given > 0 && modes.len() == given).then_some(Self(modes))
    }

    pub fn contains(&self, mode: Mode) -> bool {
        self.0.contains(&mode)
    }

    pub fn iter(&self) -> impl Iterator<Item = Mode> + '_ {
        self.0.iter().copied()
    }

    pub fn as_strs(&self) -> Vec<&'static str> {
        self.iter().map(Mode::as_str).collect()
    }

    /// The mode a block or a template counts the exercise in: the requested
    /// one when the exercise has it, its default one when none is requested.
    pub fn choose(&self, requested: Option<Mode>, default_mode: Mode) -> Option<Mode> {
        let mode = requested.unwrap_or(default_mode);
        self.contains(mode).then_some(mode)
    }
}

impl TryFrom<Vec<String>> for Modes {
    type Error = UnknownVariant;

    fn try_from(values: Vec<String>) -> Result<Self, Self::Error> {
        let joined = values.join(",");
        let modes = values
            .into_iter()
            .map(Mode::try_from)
            .collect::<Result<Vec<_>, _>>()?;
        Self::new(modes).ok_or(UnknownVariant {
            kind: "mode set",
            value: joined,
        })
    }
}

impl Mode {
    /// The set field that carries the count in this mode.
    pub fn field(self) -> SetField {
        match self {
            Self::Reps => SetField::Reps,
            Self::Time => SetField::DurationSeconds,
            Self::Distance => SetField::DistanceMeters,
        }
    }

    /// What a set logged in this mode lacks or carries in excess, given the
    /// exercise's load rule.
    pub fn check(self, load: Load, set: &SetValues) -> Vec<SetViolation> {
        let present = [
            (SetField::Reps, set.reps.is_some()),
            (SetField::WeightKg, set.weight_kg.is_some()),
            (SetField::DurationSeconds, set.duration_seconds.is_some()),
            (SetField::DistanceMeters, set.distance_meters.is_some()),
        ];
        present
            .into_iter()
            .filter_map(|(field, is_present)| {
                let (required, allowed) = if field == SetField::WeightKg {
                    (load == Load::Required, load != Load::None)
                } else {
                    let counted = field == self.field();
                    (counted, counted)
                };
                match (is_present, required, allowed) {
                    (false, true, _) => Some(SetViolation::Missing(field)),
                    (true, _, false) => Some(SetViolation::Unexpected(field)),
                    _ => None,
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(
        reps: Option<i32>,
        weight_kg: Option<f64>,
        duration_seconds: Option<i32>,
        distance_meters: Option<i32>,
    ) -> SetValues {
        SetValues {
            round: 1,
            reps,
            weight_kg,
            duration_seconds,
            distance_meters,
            warmup: false,
        }
    }

    #[test]
    fn a_required_load_needs_a_weight() {
        assert_eq!(
            Mode::Reps.check(Load::Required, &set(Some(8), Some(60.0), None, None)),
            Vec::new()
        );
        assert_eq!(
            Mode::Reps.check(Load::Required, &set(Some(8), None, None, None)),
            vec![SetViolation::Missing(SetField::WeightKg)]
        );
    }

    #[test]
    fn an_optional_load_may_be_negative_or_absent() {
        assert_eq!(
            Mode::Reps.check(Load::Optional, &set(Some(10), None, None, None)),
            Vec::new()
        );
        assert_eq!(
            Mode::Reps.check(Load::Optional, &set(Some(10), Some(-20.0), None, None)),
            Vec::new()
        );
    }

    #[test]
    fn no_load_rejects_a_weight() {
        assert_eq!(
            Mode::Time.check(Load::None, &set(None, Some(5.0), Some(60), None)),
            vec![SetViolation::Unexpected(SetField::WeightKg)]
        );
    }

    #[test]
    fn time_rejects_reps() {
        assert_eq!(
            Mode::Time.check(Load::None, &set(Some(10), None, Some(45), None)),
            vec![SetViolation::Unexpected(SetField::Reps)]
        );
    }

    #[test]
    fn distance_requires_meters() {
        assert_eq!(
            Mode::Distance.check(Load::Required, &set(None, Some(24.0), None, None)),
            vec![SetViolation::Missing(SetField::DistanceMeters)]
        );
    }

    #[test]
    fn modes_are_a_non_empty_set() {
        assert_eq!(
            Modes::new([Mode::Time, Mode::Reps]).unwrap().as_strs(),
            vec!["reps", "time"]
        );
        assert!(Modes::new([]).is_none());
        assert!(Modes::new([Mode::Reps, Mode::Reps]).is_none());
        assert!(Modes::try_from(vec!["reps".to_owned(), "swim".to_owned()]).is_err());
    }

    #[test]
    fn the_chosen_mode_must_be_one_of_the_modes() {
        let modes = Modes::new([Mode::Reps, Mode::Time]).unwrap();
        assert_eq!(modes.choose(None, Mode::Reps), Some(Mode::Reps));
        assert_eq!(modes.choose(Some(Mode::Time), Mode::Reps), Some(Mode::Time));
        assert_eq!(modes.choose(Some(Mode::Distance), Mode::Reps), None);
    }

    #[test]
    fn block_kind_follows_the_exercise_count() {
        assert_eq!(BlockKind::from_exercise_count(1), BlockKind::Simple);
        assert_eq!(BlockKind::from_exercise_count(2), BlockKind::Superset);
        assert_eq!(BlockKind::from_exercise_count(3), BlockKind::Circuit);
        assert_eq!(BlockKind::from_exercise_count(6), BlockKind::Circuit);
    }

    #[test]
    fn text_enums_round_trip() {
        for load in [Load::None, Load::Optional, Load::Required] {
            assert_eq!(Load::try_from(load.as_str().to_owned()).unwrap(), load);
        }
        assert!(Equipment::try_from("trampoline".to_owned()).is_err());
    }
}
