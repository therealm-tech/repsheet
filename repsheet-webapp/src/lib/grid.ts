import i18n from "@/i18n";
import type {
	Block,
	BlockInput,
	Equipment,
	ExerciseSummary,
	Grip,
	Load,
	Mode,
	SetInput,
	TemplateBlock,
	WeightUnit,
	WorkoutSet,
} from "@/lib/api/schemas";
import {
	type ChoiceChange,
	type Choices,
	startingChoices,
} from "@/lib/choices";
import { formatDuration, kgToUnit, unitToKg } from "@/lib/units";

/** A cell holds one set; the weight is expressed in the user's unit. */
export interface Cell {
	reps: number | null;
	weight: number | null;
	duration: number | null;
	distance: number | null;
	/** Taken from the coach's plan, and not changed since. */
	planned?: boolean;
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

let lastColumnId = 0;
function nextColumnId(): number {
	lastColumnId += 1;
	return lastColumnId;
}

/**
 * An exercise of the block, with how it is done for every round. `columnId`
 * tells apart two columns of the same exercise; it is never sent to the API.
 * `blockExerciseId` is the logged exercise the column edits, which keeps its
 * identity and its comments when the block is saved.
 */
export type GridExercise = ExerciseSummary & {
	chosen: Choices;
	columnId: number;
	blockExerciseId?: string;
};

export interface Grid {
	exercises: GridExercise[];
	rows: Row[];
}

export type Field = Exclude<keyof Cell, "planned">;

/** The cell as the athlete's own, once they change it or copy it. */
function unplanned({ planned: _planned, ...cell }: Cell): Cell {
	return cell;
}

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
	const primary = primaryField(exercise.chosen.mode);
	return exercise.load === "none" ? [primary] : [primary, "weight"];
}

export function weightRequired(load: Load): boolean {
	return load === "required";
}

/** The exercise done as `planned` where it still allows it, the default way otherwise. */
export function withChoices(
	exercise: ExerciseSummary,
	planned?: Choices,
): GridExercise {
	return {
		...exercise,
		chosen: startingChoices(exercise, planned),
		columnId: nextColumnId(),
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
	const primary = primaryField(exercise.chosen.mode);
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
					parseTarget(source.targets?.[i], exercise.chosen.mode),
					last[i] ?? [],
					unit,
				),
			),
		});
	}
	return { exercises, rows };
}

/** An exercise of a block with its sets, logged or planned. */
interface ExerciseWithSets {
	exercise: ExerciseSummary;
	mode: Mode;
	equipment: Equipment;
	grip: Grip | null;
	sets: WorkoutSet[];
}

function rowsFromSets(
	exercises: ExerciseWithSets[],
	unit: WeightUnit,
	planned: boolean,
): Row[] {
	const rowCount = Math.max(
		1,
		...exercises.flatMap((e) => e.sets.map((s) => s.round)),
	);
	const rows: Row[] = [];
	for (let r = 1; r <= rowCount; r++) {
		const sets = exercises.map((e) => e.sets.find((s) => s.round === r));
		rows.push({
			id: nextRowId(),
			warmup: sets.some((s) => s?.warmup === true),
			cells: sets.map((s) => {
				const cell = cellFromSet(s, unit);
				if (!cell) {
					return emptyCell();
				}
				return planned ? { ...cell, planned: true } : cell;
			}),
		});
	}
	return rows;
}

function columnOf(e: ExerciseWithSets): GridExercise {
	return {
		...e.exercise,
		chosen: { mode: e.mode, equipment: e.equipment, grip: e.grip },
		columnId: nextColumnId(),
	};
}

export function gridFromBlock(block: Block, unit: WeightUnit): Grid {
	return {
		exercises: block.exercises.map((e) => ({
			...columnOf(e),
			blockExerciseId: e.id,
		})),
		rows: rowsFromSets(block.exercises, unit, false),
	};
}

/** Whether a coach planned the block set by set, rather than with targets. */
export function plannedSetBySet(block: TemplateBlock): boolean {
	return block.exercises.some((e) => e.sets.length > 0);
}

/**
 * The grid of a block planned set by set. For the athlete who logs it, each
 * cell is marked as the coach's until they change it; the coach editing it
 * gets plain cells.
 */
export function gridFromPlan(
	block: TemplateBlock,
	unit: WeightUnit,
	asPlanned: boolean,
): Grid {
	return {
		exercises: block.exercises.map(columnOf),
		rows: rowsFromSets(block.exercises, unit, asPlanned),
	};
}

/** Points each column at the logged exercise `block` saved it as, in order. */
export function linkToBlock(grid: Grid, block: Block): Grid {
	return {
		...grid,
		exercises: grid.exercises.map((exercise, i) => {
			const saved = block.exercises[i];
			return saved ? { ...exercise, blockExerciseId: saved.id } : exercise;
		}),
	};
}

export function addRound(grid: Grid): Grid {
	const last = grid.rows[grid.rows.length - 1];
	const row: Row = last
		? {
				id: nextRowId(),
				warmup: false,
				cells: last.cells.map(unplanned),
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
							j === col ? { ...unplanned(cell), [field]: value } : cell,
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

/**
 * The cell field a change empties: the count for another mode, the load for
 * other equipment or another grip.
 */
function changedField(exercise: GridExercise, change: ChoiceChange): Field {
	return "mode" in change ? primaryField(exercise.chosen.mode) : "weight";
}

/** Whether a change of how a column is done would clear values already entered. */
export function switchDiscards(
	grid: Grid,
	col: number,
	change: ChoiceChange,
): boolean {
	const exercise = grid.exercises[col];
	if (!exercise) {
		return false;
	}
	const field = changedField(exercise, change);
	return grid.rows.some((row) => (row.cells[col]?.[field] ?? null) !== null);
}

/**
 * Changes how a column is done, for every round. Another mode changes what is
 * counted: each cell drops its count and takes the one of the last
 * performance done the new way, and keeps its load. Other equipment or another
 * grip changes the load: each cell drops it and takes the last performance's,
 * and keeps its count, since the movement is the same.
 */
export function switchChoice(
	grid: Grid,
	col: number,
	change: ChoiceChange,
	lastSets: WorkoutSet[] | undefined,
	unit: WeightUnit,
): Grid {
	const current = grid.exercises[col];
	if (!current) {
		return grid;
	}
	const chosen = { ...current.chosen, ...change };
	if (
		chosen.mode === current.chosen.mode &&
		chosen.equipment === current.chosen.equipment &&
		chosen.grip === current.chosen.grip
	) {
		return grid;
	}
	const exercise: GridExercise = { ...current, chosen };
	const field = changedField(exercise, change);
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
			const old = row.cells[col];
			const kept: Cell =
				"mode" in change
					? { ...emptyCell(), weight: old?.weight ?? null }
					: (old ?? emptyCell());
			const cell: Cell = { ...kept, [field]: prefilled[field] };
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
		const primary = primaryField(exercise.chosen.mode);
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
		exercises.push({
			...(exercise.blockExerciseId ? { id: exercise.blockExerciseId } : {}),
			exerciseId: exercise.id,
			...exercise.chosen,
			sets,
		});
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
