use std::fmt;

#[derive(Debug, thiserror::Error)]
#[error("unknown {kind} `{value}`")]
pub struct UnknownVariant {
    kind: &'static str,
    value: String,
}

/// An enum stored as text in the database.
pub trait TextEnum: Copy + Ord + TryFrom<String, Error = UnknownVariant> {
    fn as_str(self) -> &'static str;
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

        impl TextEnum for $name {
            fn as_str(self) -> &'static str {
                Self::as_str(self)
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

text_enum!(Grip, "grip", {
    Pronation => "pronation",
    Supination => "supination",
    Neutral => "neutral",
    Mixed => "mixed",
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

/// The values an exercise offers for one of the choices its blocks make: its
/// modes, its equipment or its grips. Without duplicates, in the declaration
/// order of `T`. An exercise always offers at least one mode and one
/// equipment, but may offer no grip.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Choices<T>(Vec<T>);

pub type Modes = Choices<Mode>;
pub type EquipmentSet = Choices<Equipment>;
pub type Grips = Choices<Grip>;

impl<T: TextEnum> Choices<T> {
    /// `None` when `values` holds a value twice.
    pub fn new(values: impl IntoIterator<Item = T>) -> Option<Self> {
        let mut values: Vec<T> = values.into_iter().collect();
        let given = values.len();
        values.sort_unstable();
        values.dedup();
        (values.len() == given).then_some(Self(values))
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn contains(&self, value: T) -> bool {
        self.0.contains(&value)
    }

    pub fn iter(&self) -> impl Iterator<Item = T> + '_ {
        self.0.iter().copied()
    }

    pub fn as_strs(&self) -> Vec<&'static str> {
        self.iter().map(T::as_str).collect()
    }

    /// Whether `default` can be the one a new block starts with: one of the
    /// values, or none exactly when there are no values.
    pub fn admits_default(&self, default: Option<T>) -> bool {
        default.map_or(self.is_empty(), |value| self.contains(value))
    }

    /// The values offered here that `next` no longer offers.
    pub fn removed<'a>(&'a self, next: &'a Self) -> impl Iterator<Item = T> + 'a {
        self.iter().filter(|value| !next.contains(*value))
    }
}

impl<T: TextEnum> TryFrom<Vec<String>> for Choices<T> {
    type Error = UnknownVariant;

    fn try_from(values: Vec<String>) -> Result<Self, Self::Error> {
        let joined = values.join(",");
        let parsed = values
            .into_iter()
            .map(T::try_from)
            .collect::<Result<Vec<_>, _>>()?;
        Self::new(parsed).ok_or(UnknownVariant {
            kind: "set of distinct values",
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
    fn choices_are_a_set_in_a_fixed_order() {
        assert_eq!(
            Modes::new([Mode::Time, Mode::Reps]).unwrap().as_strs(),
            vec!["reps", "time"]
        );
        assert_eq!(
            EquipmentSet::new([Equipment::Dumbbell, Equipment::Barbell])
                .unwrap()
                .as_strs(),
            vec!["barbell", "dumbbell"]
        );
        assert!(Grips::new([]).unwrap().is_empty());
        assert!(Modes::new([Mode::Reps, Mode::Reps]).is_none());
        assert!(Modes::try_from(vec!["reps".to_owned(), "swim".to_owned()]).is_err());
        assert!(Grips::try_from(vec!["neutral".to_owned(), "neutral".to_owned()]).is_err());
    }

    #[test]
    fn the_default_is_one_of_the_choices_or_none_without_any() {
        let equipment = EquipmentSet::new([Equipment::Barbell, Equipment::Dumbbell]).unwrap();
        assert!(equipment.admits_default(Some(Equipment::Dumbbell)));
        assert!(!equipment.admits_default(Some(Equipment::Machine)));
        assert!(!equipment.admits_default(None));
        let none = Grips::new([]).unwrap();
        assert!(none.admits_default(None));
        assert!(!none.admits_default(Some(Grip::Neutral)));
    }

    #[test]
    fn removed_choices_are_those_no_longer_offered() {
        let before = Grips::new([Grip::Pronation, Grip::Supination, Grip::Neutral]).unwrap();
        let after = Grips::new([Grip::Neutral, Grip::Mixed]).unwrap();
        assert_eq!(
            before.removed(&after).collect::<Vec<_>>(),
            vec![Grip::Pronation, Grip::Supination]
        );
        assert_eq!(after.removed(&after).count(), 0);
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
        assert_eq!(Grip::try_from("mixed".to_owned()).unwrap(), Grip::Mixed);
    }
}
