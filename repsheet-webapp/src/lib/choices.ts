import type {
	Equipment,
	ExerciseSummary,
	Grip,
	GripFilter,
	Mode,
} from "@/lib/api/schemas";

/**
 * How a block or a template does an exercise: the mode, the equipment and
 * the grip it picks among those the exercise offers. The grip is null when
 * it is not known, as in the history logged before grips existed.
 */
export interface Choices {
	mode: Mode;
	equipment: Equipment;
	grip: Grip | null;
}

/** One choice changed at a time, as a switch reports it. */
export type ChoiceChange =
	| { mode: Mode }
	| { equipment: Equipment }
	| { grip: Grip };

/** What an exercise offers for one choice, and the value a new block starts with. */
export interface Offer<T extends string> {
	values: T[];
	defaultValue: T | null;
}

/**
 * Whether a switch has something to offer: a value other than the current
 * one. A single mode or equipment offers nothing, nor does an exercise
 * without grips, but a single grip does while the grip is unknown.
 */
export function hasChoice(
	options: readonly string[],
	value: string | null,
): boolean {
	return options.some((option) => option !== value);
}

function offeredOr<T>(
	options: readonly T[],
	wanted: T | undefined,
	fallback: T,
): T {
	return wanted !== undefined && options.includes(wanted) ? wanted : fallback;
}

/**
 * What a block of `exercise` opens with: the planned values the exercise
 * still offers, its default ones otherwise. A plan that leaves the grip
 * unknown keeps it unknown.
 */
export function startingChoices(
	exercise: ExerciseSummary,
	planned?: Choices,
): Choices {
	return {
		mode: offeredOr(exercise.modes, planned?.mode, exercise.defaultMode),
		equipment: offeredOr(
			exercise.equipment,
			planned?.equipment,
			exercise.defaultEquipment,
		),
		grip:
			planned?.grip === null
				? null
				: offeredOr<Grip | null>(
						exercise.grips,
						planned?.grip,
						exercise.defaultGrip,
					),
	};
}

/** The performances held with `grip`, or recorded without one. */
export function gripFilter(grip: Grip | null): GripFilter {
	return grip ?? "none";
}

/**
 * Adds or removes a value from an offer, in the order of `all`, keeping the
 * default among the values. A `required` offer never loses its last value;
 * any other has no default once it is empty.
 */
export function toggleOffer<T extends string>(
	all: readonly T[],
	offer: Offer<T>,
	value: T,
	required: boolean,
): Offer<T> {
	const selected = offer.values.includes(value);
	if (selected && required && offer.values.length === 1) {
		return offer;
	}
	const values = all.filter((v) =>
		v === value ? !selected : offer.values.includes(v),
	);
	const defaultValue =
		offer.defaultValue !== null && values.includes(offer.defaultValue)
			? offer.defaultValue
			: (values[0] ?? null);
	return { values, defaultValue };
}
