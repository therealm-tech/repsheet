import { describe, expect, it } from "vitest";
import type { WorkoutSet } from "@/lib/api/schemas";
import {
	addExercise,
	addRound,
	fieldsFor,
	type GridExercise,
	gridFromBlock,
	initialGrid,
	linkToBlock,
	parseTarget,
	parseTyped,
	removeRound,
	setCell,
	stepValue,
	switchChoice,
	switchDiscards,
	targetFromSets,
	toBlockExercises,
	toggleWarmup,
	withChoices,
} from "@/lib/grid";

const bench: GridExercise = {
	id: "bench",
	name: "Développé couché",
	modes: ["reps"],
	defaultMode: "reps",
	load: "required",
	equipment: ["barbell"],
	defaultEquipment: "barbell",
	grips: [],
	defaultGrip: null,
	unilateral: false,
	chosen: { mode: "reps", equipment: "barbell", grip: null },
	columnId: 1,
};
const dips: GridExercise = {
	id: "dips",
	name: "Dips",
	modes: ["reps"],
	defaultMode: "reps",
	load: "optional",
	equipment: ["bodyweight"],
	defaultEquipment: "bodyweight",
	grips: [],
	defaultGrip: null,
	unilateral: false,
	chosen: { mode: "reps", equipment: "bodyweight", grip: null },
	columnId: 2,
};
const plank: GridExercise = {
	id: "plank",
	name: "Planche",
	modes: ["time"],
	defaultMode: "time",
	load: "optional",
	equipment: ["bodyweight"],
	defaultEquipment: "bodyweight",
	grips: [],
	defaultGrip: null,
	unilateral: false,
	chosen: { mode: "time", equipment: "bodyweight", grip: null },
	columnId: 3,
};
const crunch: GridExercise = {
	id: "crunch",
	name: "Crunch",
	modes: ["reps", "time"],
	defaultMode: "reps",
	load: "none",
	equipment: ["bodyweight"],
	defaultEquipment: "bodyweight",
	grips: [],
	defaultGrip: null,
	unilateral: false,
	chosen: { mode: "reps", equipment: "bodyweight", grip: null },
	columnId: 4,
};

function set(round: number, fields: Partial<WorkoutSet>): WorkoutSet {
	return {
		round,
		reps: null,
		weightKg: null,
		durationSeconds: null,
		distanceMeters: null,
		warmup: false,
		...fields,
	};
}

describe("parseTarget", () => {
	it("reads reps, aiming for the top of a range", () => {
		expect(parseTarget("8", "reps")).toBe(8);
		expect(parseTarget("6–8", "reps")).toBe(8);
		expect(parseTarget("6-8 reps", "reps")).toBe(8);
	});

	it("reads durations", () => {
		expect(parseTarget("45 s", "time")).toBe(45);
		expect(parseTarget("1 min 30", "time")).toBe(90);
		expect(parseTarget("1:15", "time")).toBe(75);
	});

	it("reads distances", () => {
		expect(parseTarget("500 m", "distance")).toBe(500);
		expect(parseTarget("1,5 km", "distance")).toBe(1500);
	});

	it("ignores targets without a number", () => {
		expect(parseTarget("max", "reps")).toBeNull();
		expect(parseTarget(null, "reps")).toBeNull();
	});
});

describe("initialGrid", () => {
	it("uses the template target for reps and the last performance for the load", () => {
		const grid = initialGrid({
			exercises: [bench],
			targets: ["6–8"],
			rounds: 3,
			lastSets: [
				[
					set(1, { reps: 8, weightKg: 60 }),
					set(2, { reps: 8, weightKg: 62.5 }),
				],
			],
			unit: "kg",
		});
		expect(grid.rows).toHaveLength(3);
		expect(grid.rows.map((r) => r.cells[0]?.reps)).toEqual([8, 8, 8]);
		// Round 3 had no set last time: it inherits round 2.
		expect(grid.rows.map((r) => r.cells[0]?.weight)).toEqual([60, 62.5, 62.5]);
	});

	it("replays the last performance when there is no template", () => {
		const grid = initialGrid({
			exercises: [dips, plank],
			lastSets: [
				[set(1, { reps: 12 }), set(2, { reps: 10 })],
				[set(1, { durationSeconds: 45 }), set(2, { durationSeconds: 40 })],
			],
			unit: "kg",
		});
		expect(grid.rows).toHaveLength(2);
		expect(grid.rows[1]?.cells[0]?.reps).toBe(10);
		expect(grid.rows[1]?.cells[1]?.duration).toBe(40);
	});

	it("skips warm-up sets of the last performance", () => {
		const grid = initialGrid({
			exercises: [bench],
			lastSets: [
				[
					set(1, { reps: 10, weightKg: 40, warmup: true }),
					set(2, { reps: 8, weightKg: 60 }),
				],
			],
			unit: "kg",
		});
		expect(grid.rows[0]?.cells[0]).toMatchObject({ reps: 8, weight: 60 });
	});

	it("converts loads to pounds for a pound user", () => {
		const grid = initialGrid({
			exercises: [bench],
			lastSets: [[set(1, { reps: 5, weightKg: 100 })]],
			unit: "lb",
		});
		expect(grid.rows[0]?.cells[0]?.weight).toBe(220.5);
	});

	it("opens with a single empty round when nothing is known", () => {
		const grid = initialGrid({ exercises: [bench], unit: "kg" });
		expect(grid.rows).toHaveLength(1);
		expect(grid.rows[0]?.cells[0]).toEqual({
			reps: null,
			weight: null,
			duration: null,
			distance: null,
		});
	});
});

describe("editing", () => {
	it("copies the previous round when adding one", () => {
		let grid = initialGrid({
			exercises: [bench],
			lastSets: [[set(1, { reps: 8, weightKg: 60 })]],
			unit: "kg",
		});
		grid = toggleWarmup(grid, 0);
		grid = addRound(grid);
		expect(grid.rows[1]?.cells[0]).toEqual(grid.rows[0]?.cells[0]);
		expect(grid.rows[1]?.warmup).toBe(false);
		expect(grid.rows[1]?.id).not.toBe(grid.rows[0]?.id);
	});

	it("adds an exercise column prefilled from its last performance", () => {
		let grid = initialGrid({ exercises: [bench], unit: "kg" });
		grid = addRound(grid);
		grid = addExercise(
			grid,
			dips,
			[set(1, { reps: 12 }), set(2, { reps: 9 })],
			"kg",
		);
		expect(grid.exercises.map((e) => e.id)).toEqual(["bench", "dips"]);
		expect(grid.rows.map((r) => r.cells[1]?.reps)).toEqual([12, 9]);
	});

	it("steps values without going below zero, except an optional extra load", () => {
		expect(stepValue("reps", 8, 1, "required")).toBe(9);
		expect(stepValue("reps", 0, -1, "required")).toBe(0);
		expect(stepValue("weight", 60, 1, "required")).toBe(61);
		expect(stepValue("weight", 82.5, 1, "required")).toBe(83.5);
		expect(stepValue("weight", 0, -1, "required")).toBe(0);
		expect(stepValue("weight", null, -1, "optional")).toBe(-1);
		expect(stepValue("duration", null, 1, "none")).toBe(5);
		expect(stepValue("distance", 490, 1, "none")).toBe(500);
	});

	it("parses typed numbers with either separator", () => {
		expect(parseTyped("12,5")).toBe(12.5);
		expect(parseTyped("40")).toBe(40);
		expect(parseTyped("")).toBeNull();
		expect(parseTyped("abc")).toBeNull();
	});
});

describe("toBlockExercises", () => {
	it("builds one set per filled round, in kg, keeping warm-ups", () => {
		let grid = initialGrid({ exercises: [bench, dips], rounds: 2, unit: "lb" });
		grid = setCell(grid, 0, 0, "reps", 10);
		grid = setCell(grid, 0, 0, "weight", 95);
		grid = setCell(grid, 1, 0, "reps", 8);
		grid = setCell(grid, 1, 0, "weight", 135);
		grid = setCell(grid, 0, 1, "reps", 12);
		grid = setCell(grid, 1, 1, "reps", 10);
		grid = setCell(grid, 1, 1, "weight", 10);
		grid = toggleWarmup(grid, 0);
		const result = toBlockExercises(grid, "lb");
		expect(result).toEqual({
			ok: true,
			exercises: [
				{
					exerciseId: "bench",
					mode: "reps",
					equipment: "barbell",
					grip: null,
					sets: [
						{ round: 1, warmup: true, reps: 10, weightKg: 43.09 },
						{ round: 2, warmup: false, reps: 8, weightKg: 61.23 },
					],
				},
				{
					exerciseId: "dips",
					mode: "reps",
					equipment: "bodyweight",
					grip: null,
					sets: [
						{ round: 1, warmup: true, reps: 12 },
						{ round: 2, warmup: false, reps: 10, weightKg: 4.54 },
					],
				},
			],
		});
	});

	it("keeps round numbers when a round is skipped for one exercise", () => {
		let grid = initialGrid({ exercises: [plank], rounds: 3, unit: "kg" });
		grid = setCell(grid, 0, 0, "duration", 45);
		grid = setCell(grid, 2, 0, "duration", 40);
		const result = toBlockExercises(grid, "kg");
		expect(result.ok && result.exercises[0]?.sets.map((s) => s.round)).toEqual([
			1, 3,
		]);
	});

	it("refuses a weighted set without its load", () => {
		const grid = setCell(
			initialGrid({ exercises: [bench], unit: "kg" }),
			0,
			0,
			"reps",
			8,
		);
		expect(toBlockExercises(grid, "kg")).toEqual({
			ok: false,
			error: "Indique la charge de Développé couché au tour 1.",
		});
	});

	it("refuses an exercise with no set", () => {
		const grid = initialGrid({ exercises: [plank], unit: "kg" });
		expect(toBlockExercises(grid, "kg")).toEqual({
			ok: false,
			error: "Ajoute au moins une série pour Planche.",
		});
	});

	it("refuses an empty block", () => {
		expect(toBlockExercises({ exercises: [], rows: [] }, "kg").ok).toBe(false);
	});

	it("drops a removed round", () => {
		let grid = initialGrid({ exercises: [dips], rounds: 2, unit: "kg" });
		grid = setCell(grid, 0, 0, "reps", 12);
		grid = setCell(grid, 1, 0, "reps", 10);
		grid = removeRound(grid, 0);
		const result = toBlockExercises(grid, "kg");
		expect(result.ok && result.exercises[0]?.sets).toEqual([
			{ round: 1, warmup: false, reps: 10 },
		]);
	});
});

describe("gridFromBlock", () => {
	it("rebuilds rounds from a logged block", () => {
		const grid = gridFromBlock(
			{
				id: "b1",
				position: 1,
				kind: "superset",
				templateBlockId: null,
				restSeconds: null,
				exercises: [
					{
						id: "ex1",
						exercise: bench,
						mode: "reps",
						equipment: "barbell",
						comments: [],
						grip: null,
						sets: [
							set(1, { reps: 10, weightKg: 40, warmup: true }),
							set(2, { reps: 8, weightKg: 60 }),
						],
					},
					{
						id: "ex2",
						exercise: crunch,
						mode: "time",
						equipment: "bodyweight",
						comments: [],
						grip: null,
						sets: [set(2, { durationSeconds: 60 })],
					},
				],
			},
			"kg",
		);
		expect(grid.rows).toHaveLength(2);
		expect(grid.rows[0]?.warmup).toBe(true);
		expect(grid.rows[0]?.cells[1]).toEqual({
			reps: null,
			weight: null,
			duration: null,
			distance: null,
		});
		expect(grid.rows[1]?.cells[1]?.duration).toBe(60);
		expect(grid.exercises.map((e) => e.chosen.mode)).toEqual(["reps", "time"]);
		expect(grid.exercises.map((e) => e.blockExerciseId)).toEqual([
			"ex1",
			"ex2",
		]);
	});

	it("sends the ids of the logged exercises it keeps, and none for new ones", () => {
		let grid = initialGrid({ exercises: [bench, dips], unit: "kg" });
		grid = setCell(grid, 0, 0, "reps", 8);
		grid = setCell(grid, 0, 0, "weight", 60);
		grid = setCell(grid, 0, 1, "reps", 12);
		const logged = {
			id: "b1",
			position: 1,
			kind: "superset" as const,
			templateBlockId: null,
			restSeconds: null,
			exercises: [{ id: "be1" }, { id: "be2" }].map((e, i) => ({
				...e,
				exercise: [bench, dips][i] as GridExercise,
				mode: "reps" as const,
				equipment: "barbell" as const,
				grip: null,
				comments: [],
				sets: [],
			})),
		};
		const linked = linkToBlock(grid, logged);
		const result = toBlockExercises(linked, "kg");
		expect(result.ok && result.exercises.map((e) => e.id)).toEqual([
			"be1",
			"be2",
		]);
		const fresh = toBlockExercises(grid, "kg");
		expect(fresh.ok && fresh.exercises.every((e) => !("id" in e))).toBe(true);
	});
});

describe("targetFromSets", () => {
	it("summarises logged sets as a target", () => {
		expect(
			targetFromSets("reps", [set(1, { reps: 8 }), set(2, { reps: 8 })]),
		).toBe("8");
		expect(
			targetFromSets("reps", [set(1, { reps: 12 }), set(2, { reps: 9 })]),
		).toBe("9–12");
		expect(targetFromSets("time", [set(1, { durationSeconds: 45 })])).toBe(
			"45 s",
		);
		expect(targetFromSets("time", [set(1, { durationSeconds: 60 })])).toBe(
			"1 min",
		);
		expect(
			targetFromSets("time", [
				set(1, { durationSeconds: 45 }),
				set(2, { durationSeconds: 60 }),
			]),
		).toBe("45–60 s");
		expect(targetFromSets("reps", [])).toBeNull();
	});
});

describe("modes", () => {
	it("counts an exercise in its default mode unless the template says otherwise", () => {
		const { chosen, ...summary } = crunch;
		expect(withChoices(summary).chosen.mode).toBe("reps");
		expect(withChoices(summary, { ...chosen, mode: "time" }).chosen.mode).toBe(
			"time",
		);
		expect(
			withChoices(summary, { ...chosen, mode: "distance" }).chosen.mode,
		).toBe("reps");
	});

	it("asks for a weight only when the exercise takes one", () => {
		expect(fieldsFor(bench)).toEqual(["reps", "weight"]);
		expect(
			fieldsFor({ ...crunch, chosen: { ...crunch.chosen, mode: "time" } }),
		).toEqual(["duration"]);
	});

	it("reads the template target in the column's mode", () => {
		const grid = initialGrid({
			exercises: [{ ...crunch, chosen: { ...crunch.chosen, mode: "time" } }],
			targets: ["1 min"],
			rounds: 2,
			unit: "kg",
		});
		expect(grid.rows.map((r) => r.cells[0]?.duration)).toEqual([60, 60]);
		expect(grid.rows[0]?.cells[0]?.reps).toBeNull();
	});

	it("switches every round of a column to the other field, keeping the load", () => {
		let grid = initialGrid({
			exercises: [crunch, dips],
			rounds: 2,
			unit: "kg",
		});
		expect(switchDiscards(grid, 0, { mode: "time" })).toBe(false);
		grid = setCell(grid, 0, 0, "reps", 20);
		grid = setCell(grid, 1, 0, "reps", 18);
		grid = setCell(grid, 0, 1, "reps", 10);
		expect(switchDiscards(grid, 0, { mode: "time" })).toBe(true);

		grid = switchChoice(
			grid,
			0,
			{ mode: "time" },
			[set(1, { durationSeconds: 45 }), set(2, { durationSeconds: 40 })],
			"kg",
		);
		expect(grid.exercises[0]?.chosen.mode).toBe("time");
		expect(grid.rows.map((r) => r.cells[0])).toEqual([
			{ reps: null, weight: null, duration: 45, distance: null },
			{ reps: null, weight: null, duration: 40, distance: null },
		]);
		expect(grid.rows[0]?.cells[1]?.reps).toBe(10);

		const result = toBlockExercises(grid, "kg");
		expect(result.ok && result.exercises[0]).toEqual({
			exerciseId: "crunch",
			mode: "time",
			equipment: "bodyweight",
			grip: null,
			sets: [
				{ round: 1, warmup: false, durationSeconds: 45 },
				{ round: 2, warmup: false, durationSeconds: 40 },
			],
		});
	});

	it("leaves the cells empty when the new mode was never logged", () => {
		let grid = initialGrid({ exercises: [crunch], unit: "kg" });
		grid = setCell(grid, 0, 0, "reps", 20);
		grid = switchChoice(grid, 0, { mode: "time" }, undefined, "kg");
		expect(grid.rows[0]?.cells[0]?.duration).toBeNull();
		expect(toBlockExercises(grid, "kg").ok).toBe(false);
	});
});

describe("equipment", () => {
	const press: GridExercise = {
		...bench,
		id: "press",
		name: "Développé militaire",
		equipment: ["barbell", "dumbbell"],
	};

	it("does an exercise with its default equipment unless the template says otherwise", () => {
		const { chosen, ...summary } = press;
		expect(withChoices(summary).chosen.equipment).toBe("barbell");
		expect(
			withChoices(summary, { ...chosen, equipment: "dumbbell" }).chosen
				.equipment,
		).toBe("dumbbell");
		expect(
			withChoices(summary, { ...chosen, equipment: "cable" }).chosen.equipment,
		).toBe("barbell");
	});

	it("keeps the loads entered on other equipment, and the reps", () => {
		let grid = initialGrid({
			exercises: [press],
			rounds: 2,
			lastSets: [[set(1, { reps: 8, weightKg: 40 })]],
			unit: "kg",
		});
		expect(switchDiscards(grid, 0, { equipment: "dumbbell" })).toBe(false);
		grid = setCell(grid, 1, 0, "reps", 6);

		grid = switchChoice(
			grid,
			0,
			{ equipment: "dumbbell" },
			[set(1, { reps: 10, weightKg: 16 }), set(2, { reps: 10, weightKg: 14 })],
			"kg",
		);
		expect(grid.exercises[0]?.chosen.equipment).toBe("dumbbell");
		expect(grid.rows.map((r) => r.cells[0])).toEqual([
			{ reps: 8, weight: 40, duration: null, distance: null },
			{ reps: 6, weight: 40, duration: null, distance: null },
		]);
		const result = toBlockExercises(grid, "kg");
		expect(result.ok && result.exercises[0]?.equipment).toBe("dumbbell");
	});

	it("fills the cells without a load from the other equipment's history", () => {
		let grid = initialGrid({
			exercises: [press],
			rounds: 2,
			lastSets: [[set(1, { reps: 8, weightKg: 40 })]],
			unit: "kg",
		});
		grid = setCell(grid, 1, 0, "weight", null);
		grid = switchChoice(
			grid,
			0,
			{ equipment: "dumbbell" },
			[set(1, { reps: 10, weightKg: 16 }), set(2, { reps: 10, weightKg: 14 })],
			"kg",
		);
		expect(grid.rows.map((r) => r.cells[0]?.weight)).toEqual([40, 14]);
	});

	it("leaves a cell without a load empty when the other equipment was never logged", () => {
		let grid = initialGrid({
			exercises: [press],
			lastSets: [[set(1, { reps: 8, weightKg: 40 })]],
			unit: "kg",
		});
		grid = setCell(grid, 0, 0, "weight", null);
		grid = switchChoice(grid, 0, { equipment: "dumbbell" }, undefined, "kg");
		expect(grid.rows[0]?.cells[0]?.weight).toBeNull();
	});
});

describe("grip", () => {
	const pulldown: GridExercise = {
		...bench,
		id: "pulldown",
		name: "Tirage vertical",
		equipment: ["cable"],
	};

	it("keeps the loads entered on another grip, the history having none", () => {
		let grid = initialGrid({
			exercises: [pulldown],
			rounds: 2,
			lastSets: [
				[
					set(1, { reps: 10, weightKg: 30 }),
					set(2, { reps: 10, weightKg: 34 }),
				],
			],
			unit: "kg",
		});
		expect(switchDiscards(grid, 0, { grip: "pronation" })).toBe(false);
		grid = switchChoice(grid, 0, { grip: "pronation" }, undefined, "kg");
		expect(grid.exercises[0]?.chosen.grip).toBe("pronation");
		expect(grid.rows.map((r) => r.cells[0]?.weight)).toEqual([30, 34]);
	});

	it("fills the cells without a load from the new grip's history", () => {
		let grid = initialGrid({
			exercises: [pulldown],
			rounds: 2,
			lastSets: [
				[
					set(1, { reps: 10, weightKg: 30 }),
					set(2, { reps: 10, weightKg: 34 }),
				],
			],
			unit: "kg",
		});
		grid = setCell(grid, 1, 0, "weight", null);
		grid = switchChoice(
			grid,
			0,
			{ grip: "supination" },
			[set(1, { reps: 8, weightKg: 60 }), set(2, { reps: 8, weightKg: 55 })],
			"kg",
		);
		expect(grid.rows.map((r) => r.cells[0]?.weight)).toEqual([30, 55]);
		expect(grid.rows.map((r) => r.cells[0]?.reps)).toEqual([10, 10]);
	});
});
