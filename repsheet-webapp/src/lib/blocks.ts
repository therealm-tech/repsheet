import i18n, { intlTag } from "@/i18n";
import type {
	BlockKind,
	Equipment,
	ExerciseSummary,
	Load,
	Mode,
	WeightUnit,
	WorkoutSet,
} from "@/lib/api/schemas";
import {
	formatDistance,
	formatDuration,
	formatNumber,
	kgToUnit,
} from "@/lib/units";

export const LETTERS = "ABCDEFGHIJ";

export function letter(index: number): string {
	return LETTERS.charAt(index) || String(index + 1);
}

export function kindOf(exerciseCount: number): BlockKind {
	if (exerciseCount <= 1) {
		return "simple";
	}
	return exerciseCount === 2 ? "superset" : "circuit";
}

export function kindLabel(kind: BlockKind): string {
	return i18n.t(`kinds.${kind}`);
}

/** "In reps", "For time": a mode as an adverbial phrase. */
export function modeIn(mode: Mode): string {
	return i18n.t(`modesIn.${mode}`);
}

/** The same phrase inside a sentence: "Last time for time (Oct 8)". */
export function modeInLower(mode: Mode): string {
	const text = modeIn(mode);
	return text.charAt(0).toLocaleLowerCase(intlTag()) + text.slice(1);
}

/** "reps or time": the ways an exercise is counted. */
export function modesText(modes: Mode[]): string {
	return new Intl.ListFormat(intlTag(), { type: "disjunction" }).format(
		modes.map((m) => i18n.t(`modesLower.${m}`)),
	);
}

/** How an exercise is done and counted, for lists: "Bodyweight · reps or time", "Barbell or dumbbells · reps · load". */
export function describeExercise(exercise: ExerciseSummary): string[] {
	return [
		equipmentText(exercise.equipment),
		modesText(exercise.modes),
		exercise.load === "none" ? null : i18n.t(`loadTags.${exercise.load}`),
		exercise.unilateral ? i18n.t("exercise.perSide") : null,
	].filter((part): part is string => part !== null);
}

export function equipmentLabel(equipment: Equipment): string {
	return i18n.t(`equipment.${equipment}`);
}

/** "Barbell or dumbbells": the equipment an exercise can be done with. */
export function equipmentText(equipment: Equipment[]): string {
	const text = new Intl.ListFormat(intlTag(), { type: "disjunction" }).format(
		equipment.map((e) => i18n.t(`equipmentLower.${e}`)),
	);
	return text.charAt(0).toLocaleUpperCase(intlTag()) + text.slice(1);
}

/** "with dumbbells": an equipment as an adverbial phrase, inside a sentence. */
export function equipmentWith(equipment: Equipment): string {
	return i18n.t(`equipmentWith.${equipment}`);
}

/**
 * "in reps, with dumbbells": how a block does an exercise, naming only the
 * choices the exercise leaves open; null when it leaves none.
 */
export function choicesText(
	exercise: ExerciseSummary,
	mode: Mode,
	equipment: Equipment,
): string | null {
	const parts = [
		exercise.modes.length > 1 ? modeInLower(mode) : null,
		exercise.equipment.length > 1 ? equipmentWith(equipment) : null,
	].filter((part): part is string => part !== null);
	return parts.length > 0 ? parts.join(", ") : null;
}

function allEqual(values: number[]): boolean {
	return values.every((v) => v === values[0]);
}

function series(values: number[], unit = ""): string {
	const suffix = unit ? ` ${unit}` : "";
	if (values.length === 0) {
		return "";
	}
	if (allEqual(values)) {
		return `${values.length}×${formatNumber(values[0] ?? 0)}${suffix}`;
	}
	return `${values.map(formatNumber).join("/")}${suffix}`;
}

function weights(sets: WorkoutSet[], unit: WeightUnit): string | null {
	const values = sets.flatMap((s) =>
		s.weightKg === null ? [] : [kgToUnit(s.weightKg, unit)],
	);
	if (values.length === 0) {
		return null;
	}
	const first = values[0] ?? 0;
	const last = values[values.length - 1] ?? 0;
	if (allEqual(values)) {
		return `${formatNumber(first)} ${unit}`;
	}
	const steps = values.slice(1).map((v, i) => v - (values[i] ?? v));
	const monotonic = steps.every((d) => d >= 0) || steps.every((d) => d <= 0);
	if (monotonic) {
		return `${formatNumber(first)}→${formatNumber(last)} ${unit}`;
	}
	return `${formatNumber(Math.min(...values))}–${formatNumber(Math.max(...values))} ${unit}`;
}

/** "3 × 1 min", "45 s/40 s": durations or distances, spaced out since they carry their unit. */
function measured(values: number[], format: (value: number) => string): string {
	if (allEqual(values)) {
		return `${values.length} × ${format(values[0] ?? 0)}`;
	}
	return values.map(format).join("/");
}

/**
 * One-line summary of an exercise's working sets in its mode: "4×8 · 60 kg",
 * "12/10/9 · BW", "3×20 reps", "3 × 1 min", "2 × 500 m". The load shows only
 * when the exercise takes one.
 */
export function summarizeSets(
	mode: Mode,
	load: Load,
	sets: WorkoutSet[],
	unit: WeightUnit,
): string {
	const working = sets.filter((s) => !s.warmup);
	const used = working.length > 0 ? working : sets;
	if (used.length === 0) {
		return "—";
	}
	const weight = load === "none" ? null : weights(used, unit);
	const loadText = weight && load === "optional" ? `+${weight}` : weight;
	switch (mode) {
		case "reps": {
			const reps = series(used.map((s) => s.reps ?? 0));
			if (load === "none") {
				return `${reps} ${i18n.t("units.reps")}`;
			}
			return `${reps} · ${loadText ?? i18n.t("units.bodyweightShort")}`;
		}
		case "time":
			return [
				measured(
					used.map((s) => s.durationSeconds ?? 0),
					formatDuration,
				),
				loadText,
			]
				.filter(Boolean)
				.join(" · ");
		case "distance":
			return [
				measured(
					used.map((s) => s.distanceMeters ?? 0),
					formatDistance,
				),
				loadText,
			]
				.filter(Boolean)
				.join(" · ");
	}
}

export function maxWorkingWeight(sets: WorkoutSet[]): number | null {
	const values = sets.flatMap((s) =>
		!s.warmup && s.weightKg !== null ? [s.weightKg] : [],
	);
	return values.length === 0 ? null : Math.max(...values);
}

export function roundCount(sets: WorkoutSet[]): number {
	return sets.reduce((max, s) => Math.max(max, s.round), 0);
}
