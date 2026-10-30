import i18n from "@/i18n";
import type {
	Block,
	BlockInput,
	ExerciseSummary,
	Load,
	Mode,
	SetInput,
	WeightUnit,
	WorkoutSet,
} from "@/lib/api/schemas";
import { formatDuration, kgToUnit, unitToKg } from "@/lib/units";

/** A cell holds one set; the weight is expressed in the user's unit. */
export interface Cell {
	reps: number | null;
	weight: number | null;
	duration: number | null;
	distance: number | null;
}

/** One row is one round: every exercise of the block, done in order. */
export interface Row {
	/** Stable identity for rendering; never sent to the API. */
	id: number;
	cells: Cell[];
	warmup: boolean;
}

let lastRowId = 0;
function nextRowId(): number {
	lastRowId += 1;
	return lastRowId;
}

/** An exercise of the block, with the mode it is counted in for every round. */
export type GridExercise = ExerciseSummary & { mode: Mode };

export interface Grid {
	exercises: GridExercise[];
	rows: Row[];
}

export type Field = keyof Cell;

export function emptyCell(): Cell {
	return { reps: null, weight: null, duration: null, distance: null };
}

/** The cell field that holds the count of a mode. */
export function primaryField(mode: Mode): Field {
	switch (mode) {
		case "reps":
			return "reps";
		case "time":
			return "duration";
		case "distance":
			return "distance";
	}
}

/** What a cell asks for: the count of its mode, and a weight unless the exercise takes none. */
export function fieldsFor(exercise: GridExercise): Field[] {
	const primary = primaryField(exercise.mode);
	return exercise.load === "none" ? [primary] : [primary, "weight"];
}

export function weightRequired(load: Load): boolean {
	return load === "required";
}

/** The exercise counted in `mode` when it has that mode, in its default mode otherwise. */
export function withMode(exercise: ExerciseSummary, mode?: Mode): GridExercise {
	return {
		...exercise,
		mode:
			mode !== undefined && exercise.modes.includes(mode)
				? mode
				: exercise.defaultMode,
	};
}

/** Reads a coach's target ("8", "6–8", "45 s", "1 min 30", "500 m", "max") as a number to prefill. */
export function parseTarget(
	target: string | null | undefined,
	mode: Mode,
): number | null {
	if (!target) {
		return null;
	}
	const text = target.toLowerCase().replace(",", ".");
	const numbers = [...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
	if (numbers.length === 0) {
		return null;
	}
	if (mode === "time") {
		const clock = text.match(/(\d+):(\d{1,2})/);
		if (clock) {
			return Number(clock[1]) * 60 + Number(clock[2]);
		}
		if (text.includes("min")) {
			return (numbers[0] ?? 0) * 60 + (numbers[1] ?? 0);
		}
		return Math.round(numbers[numbers.length - 1] ?? 0);
	}
	if (mode === "distance") {
		const value = numbers[numbers.length - 1] ?? 0;
		return text.includes("km") ? Math.round(value * 1000) : Math.round(value);
	}
	// A rep range aims for its upper bound.
	return Math.round(Math.max(...numbers));
}

function cellFromSet(
	set: WorkoutSet | undefined,
	unit: WeightUnit,
): Cell | null {
	if (!set) {
		return null;
	}
	return {
		reps: set.reps,
		weight: set.weightKg === null ? null : kgToUnit(set.weightKg, unit),
		duration: set.durationSeconds,
		distance: set.distanceMeters,
	};
}

function workingSets(sets: WorkoutSet[] | undefined): WorkoutSet[] {
	const all = sets ?? [];
	const working = all.filter((s) => !s.warmup);
	return working.length > 0 ? working : all;
}

function roundsIn(sets: WorkoutSet[]): number {
	return sets.reduce((max, s) => Math.max(max, s.round), 0);
}

export interface PrefillSource {
	exercises: GridExercise[];
	/** The template's target for each exercise, when the block comes from a template. */
	targets?: (string | null)[];
	rounds?: number | null;
	/** The sets of each exercise's last performance. */
	lastSets?: (WorkoutSet[] | undefined)[];
	unit: WeightUnit;
}

function prefillCell(
	exercise: GridExercise,
	round: number,
	previous: Cell | undefined,
	target: number | null,
	last: WorkoutSet[],
	unit: WeightUnit,
): Cell {
	const fromLast = cellFromSet(
		last.find((s) => s.round === round) ?? (round === 1 ? last[0] : undefined),
		unit,
	);
	const primary = primaryField(exercise.mode);
	const cell = emptyCell();
	cell[primary] = target ?? fromLast?.[primary] ?? previous?.[primary] ?? null;
	if (exercise.load !== "none") {
		cell.weight = fromLast?.weight ?? previous?.weight ?? null;
	}
	return cell;
}

/**
 * Builds the grid a block opens with. The coach's target wins for reps, time
 * and distance; the last performance at the same round fills the rest, and the
 * previous round fills whatever is still empty.
 */
export function initialGrid(source: PrefillSource): Grid {
	const { exercises, unit } = source;
	const last = exercises.map((_, i) => workingSets(source.lastSets?.[i]));
	const rowCount = Math.max(
		1,
		source.rounds ?? Math.max(0, ...last.map(roundsIn)),
	);
	const rows: Row[] = [];
	for (let r = 1; r <= rowCount; r++) {
		const previous = rows[rows.length - 1];
		rows.push({
			id: nextRowId(),
			warmup: false,
			cells: exercises.map((exercise, i) =>
				prefillCell(
					exercise,
					r,
					previous?.cells[i],
					parseTarget(source.targets?.[i], exercise.mode),
					last[i] ?? [],
					unit,
				),
			),
		});
	}
	return { exercises, rows };
}

export function gridFromBlock(block: Block, unit: WeightUnit): Grid {
	const rowCount = Math.max(
		1,
		...block.exercises.flatMap((e) => e.sets.map((s) => s.round)),
	);
	const rows: Row[] = [];
	for (let r = 1; r <= rowCount; r++) {
		const sets = block.exercises.map((e) => e.sets.find((s) => s.round === r));
		rows.push({
			id: nextRowId(),
			warmup: sets.some((s) => s?.warmup === true),
			cells: sets.map((s) => cellFromSet(s, unit) ?? emptyCell()),
		});
	}
	return {
		exercises: block.exercises.map((e) => ({ ...e.exercise, mode: e.mode })),
		rows,
	};
}

export function addRound(grid: Grid): Grid {
	const last = grid.rows[grid.rows.length - 1];
	const row: Row = last
		? {
				id: nextRowId(),
				warmup: false,
				cells: last.cells.map((c) => ({ ...c })),
			}
		: {
				id: nextRowId(),
				warmup: false,
				cells: grid.exercises.map(() => emptyCell()),
			};
	return { ...grid, rows: [...grid.rows, row] };
}

export function removeRound(grid: Grid, index: number): Grid {
	return { ...grid, rows: grid.rows.filter((_, i) => i !== index) };
}

export function toggleWarmup(grid: Grid, index: number): Grid {
	return {
		...grid,
		rows: grid.rows.map((row, i) =>
			i === index ? { ...row, warmup: !row.warmup } : row,
		),
	};
}

export function setCell(
	grid: Grid,
	rowIndex: number,
	col: number,
	field: Field,
	value: number | null,
): Grid {
	return {
		...grid,
		rows: grid.rows.map((row, i) =>
			i === rowIndex
				? {
						...row,
						cells: row.cells.map((cell, j) =>
							j === col ? { ...cell, [field]: value } : cell,
						),
					}
				: row,
		),
	};
}

export function addExercise(
	grid: Grid,
	exercise: GridExercise,
	lastSets: WorkoutSet[] | undefined,
	unit: WeightUnit,
): Grid {
	const last = workingSets(lastSets);
	const rows: Row[] =
		grid.rows.length > 0
			? grid.rows
			: [{ id: nextRowId(), warmup: false, cells: [] }];
	let previous: Cell | undefined;
	return {
		exercises: [...grid.exercises, exercise],
		rows: rows.map((row, i) => {
			const cell = prefillCell(exercise, i + 1, previous, null, last, unit);
			previous = cell;
			return { ...row, cells: [...row.cells, cell] };
		}),
	};
}

/** Whether counting a column in another mode would clear values already entered. */
export function switchDiscards(grid: Grid, col: number): boolean {
	const exercise = grid.exercises[col];
	if (!exercise) {
		return false;
	}
	const field = primaryField(exercise.mode);
	return grid.rows.some((row) => (row.cells[col]?.[field] ?? null) !== null);
}

/**
 * Counts a column in another mode, for every round: each cell drops the old
 * count and takes the new one from the last performance in that mode; the
 * load stays.
 */
export function switchMode(
	grid: Grid,
	col: number,
	mode: Mode,
	lastSets: WorkoutSet[] | undefined,
	unit: WeightUnit,
): Grid {
	const current = grid.exercises[col];
	if (!current || current.mode === mode) {
		return grid;
	}
	const exercise: GridExercise = { ...current, mode };
	const field = primaryField(mode);
	const last = workingSets(lastSets);
	let previous: Cell | undefined;
	return {
		exercises: grid.exercises.map((e, i) => (i === col ? exercise : e)),
		rows: grid.rows.map((row, r) => {
			const prefilled = prefillCell(
				exercise,
				r + 1,
				previous,
				null,
				last,
				unit,
			);
			const cell: Cell = {
				...emptyCell(),
				[field]: prefilled[field],
				weight: row.cells[col]?.weight ?? null,
			};
			previous = cell;
			return {
				...row,
				cells: row.cells.map((c, i) => (i === col ? cell : c)),
			};
		}),
	};
}

export function removeExercise(grid: Grid, col: number): Grid {
	return {
		exercises: grid.exercises.filter((_, i) => i !== col),
		rows: grid.rows.map((row) => ({
			...row,
			cells: row.cells.filter((_, i) => i !== col),
		})),
	};
}

/** The ± buttons nudge a value; any other amount is typed in directly. */
export function stepFor(field: Field): number {
	switch (field) {
		case "reps":
		case "weight":
			return 1;
		case "duration":
			return 5;
		case "distance":
			return 10;
	}
}

/** Applies a ± press. Only an optional extra load may go negative (assisted reps). */
export function stepValue(
	field: Field,
	current: number | null,
	direction: 1 | -1,
	load: Load,
): number | null {
	const step = stepFor(field);
	const allowsNegative = field === "weight" && load === "optional";
	if (current === null) {
		return direction === 1 ? step : allowsNegative ? -step : null;
	}
	const next = Math.round((current + direction * step) * 100) / 100;
	if (!allowsNegative && next < 0) {
		return 0;
	}
	return next;
}

export type BuildResult =
	| { ok: true; exercises: BlockInput["exercises"] }
	| { ok: false; error: string };

/** Turns the grid into the request body, refusing incomplete sets. */
export function toBlockExercises(grid: Grid, unit: WeightUnit): BuildResult {
	if (grid.exercises.length === 0) {
		return { ok: false, error: i18n.t("grid.noExercise") };
	}
	const exercises: BlockInput["exercises"] = [];
	for (const [col, exercise] of grid.exercises.entries()) {
		const primary = primaryField(exercise.mode);
		const sets: SetInput[] = [];
		for (const [r, row] of grid.rows.entries()) {
			const cell = row.cells[col];
			if (!cell || cell[primary] === null) {
				continue;
			}
			if (weightRequired(exercise.load) && cell.weight === null) {
				return {
					ok: false,
					error: i18n.t("grid.missingWeight", {
						name: exercise.name,
						round: r + 1,
					}),
				};
			}
			const set: SetInput = { round: r + 1, warmup: row.warmup };
			if (primary === "reps") {
				set.reps = cell.reps;
			} else if (primary === "duration") {
				set.durationSeconds = cell.duration;
			} else {
				set.distanceMeters = cell.distance;
			}
			if (cell.weight !== null && exercise.load !== "none") {
				set.weightKg = unitToKg(cell.weight, unit);
			}
			sets.push(set);
		}
		if (sets.length === 0) {
			return {
				ok: false,
				error: i18n.t("grid.noSet", { name: exercise.name }),
			};
		}
		exercises.push({ exerciseId: exercise.id, mode: exercise.mode, sets });
	}
	return { ok: true, exercises };
}

/** Summarises logged sets as a template target: "8", "6–8", "45 s", "1 min", "500 m". */
export function targetFromSets(mode: Mode, sets: WorkoutSet[]): string | null {
	const working = workingSets(sets);
	const primary = primaryField(mode);
	const values = working.flatMap((s) => {
		const value =
			primary === "reps"
				? s.reps
				: primary === "duration"
					? s.durationSeconds
					: s.distanceMeters;
		return value === null ? [] : [value];
	});
	if (values.length === 0) {
		return null;
	}
	const min = Math.min(...values);
	const max = Math.max(...values);
	if (primary === "duration" && min === max) {
		return formatDuration(min);
	}
	const suffix =
		primary === "duration" ? " s" : primary === "distance" ? " m" : "";
	return min === max ? `${min}${suffix}` : `${min}–${max}${suffix}`;
}

/** Parses a number typed with either decimal separator; null when empty or invalid. */
export function parseTyped(text: string): number | null {
	const normalized = text.trim().replace(",", ".");
	if (normalized === "") {
		return null;
	}
	const value = Number(normalized);
	return Number.isFinite(value) ? value : null;
}
