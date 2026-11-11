import { describe, expect, it } from "vitest";
import type { WorkoutSet } from "@/lib/api/schemas";
import {
	choicesSummary,
	kindOf,
	letter,
	maxWorkingWeight,
	summarizeSets,
	unusualChoices,
} from "@/lib/blocks";
import { exercise } from "./helpers";

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

describe("kindOf", () => {
	it("derives the block kind from its exercise count", () => {
		expect(kindOf(1)).toBe("simple");
		expect(kindOf(2)).toBe("superset");
		expect(kindOf(3)).toBe("circuit");
		expect(kindOf(5)).toBe("circuit");
	});
});

describe("summarizeSets", () => {
	it("compacts identical sets", () => {
		const sets = [1, 2, 3, 4].map((r) => set(r, { reps: 8, weightKg: 60 }));
		expect(summarizeSets("reps", "required", sets, "kg")).toBe("4×8 · 60 kg");
	});

	it("shows a weight change across sets", () => {
		const sets = [
			set(1, { reps: 12, weightKg: 15 }),
			set(2, { reps: 12, weightKg: 15 }),
			set(3, { reps: 12, weightKg: 12.5 }),
		];
		expect(summarizeSets("reps", "required", sets, "kg")).toBe(
			"3×12 · 15→12,5 kg",
		);
	});

	it("shows the range when the weight goes up then down", () => {
		const sets = [
			set(1, { reps: 8, weightKg: 60 }),
			set(2, { reps: 6, weightKg: 62.5 }),
			set(3, { reps: 7, weightKg: 60 }),
		];
		expect(summarizeSets("reps", "required", sets, "kg")).toBe(
			"8/6/7 · 60–62,5 kg",
		);
	});

	it("leaves warm-ups out", () => {
		const sets = [
			set(1, { reps: 10, weightKg: 40, warmup: true }),
			set(2, { reps: 8, weightKg: 60 }),
		];
		expect(summarizeSets("reps", "required", sets, "kg")).toBe("1×8 · 60 kg");
	});

	it("labels bodyweight and weighted reps", () => {
		expect(
			summarizeSets(
				"reps",
				"optional",
				[set(1, { reps: 12 }), set(2, { reps: 10 })],
				"kg",
			),
		).toBe("12/10 · PDC");
		expect(
			summarizeSets(
				"reps",
				"optional",
				[set(1, { reps: 6, weightKg: 10 })],
				"kg",
			),
		).toBe("1×6 · +10 kg");
	});

	it("formats durations and distances", () => {
		expect(
			summarizeSets(
				"time",
				"optional",
				[set(1, { durationSeconds: 45 }), set(2, { durationSeconds: 40 })],
				"kg",
			),
		).toBe("45 s/40 s");
		expect(
			summarizeSets(
				"distance",
				"none",
				[set(1, { distanceMeters: 500 }), set(2, { distanceMeters: 500 })],
				"kg",
			),
		).toBe("2 × 500 m");
		expect(
			summarizeSets(
				"distance",
				"required",
				[set(1, { distanceMeters: 40, weightKg: 24 })],
				"kg",
			),
		).toBe("1 × 40 m · 24 kg");
	});

	it("converts to pounds", () => {
		expect(
			summarizeSets(
				"reps",
				"required",
				[set(1, { reps: 5, weightKg: 100 })],
				"lb",
			),
		).toBe("1×5 · 220,5 lb");
	});
});

describe("summaries per mode", () => {
	const crunchReps = [20, 20, 18].map((reps, i) => set(i + 1, { reps }));
	const crunchTime = [60, 60, 60].map((d, i) =>
		set(i + 1, { durationSeconds: d }),
	);

	it("counts reps with no load as reps", () => {
		expect(summarizeSets("reps", "none", crunchReps, "kg")).toBe(
			"20/20/18 reps",
		);
	});

	it("counts timed rounds", () => {
		expect(summarizeSets("time", "none", crunchTime, "kg")).toBe("3 × 1 min");
	});

	it("hides a load the exercise does not take", () => {
		const sets = [set(1, { durationSeconds: 75, weightKg: 10 })];
		expect(summarizeSets("time", "none", sets, "kg")).toBe("1 × 1 min 15");
		expect(summarizeSets("time", "optional", sets, "kg")).toBe(
			"1 × 1 min 15 · +10 kg",
		);
	});
});

describe("helpers", () => {
	it("letters exercises", () => {
		expect([0, 1, 2].map(letter)).toEqual(["A", "B", "C"]);
	});

	it("finds the heaviest working set", () => {
		expect(
			maxWorkingWeight([
				set(1, { weightKg: 80, warmup: true }),
				set(2, { weightKg: 60 }),
			]),
		).toBe(60);
		expect(maxWorkingWeight([set(1, { reps: 10 })])).toBeNull();
	});
});

describe("choices", () => {
	const row = exercise({
		id: "row",
		name: "Rowing",
		equipment: ["barbell", "dumbbell"],
		defaultEquipment: "barbell",
		grips: ["pronation", "supination", "neutral"],
		defaultGrip: "pronation",
	});

	it("names only the equipment and grip that depart from the defaults", () => {
		expect(
			unusualChoices(row, {
				mode: "reps",
				equipment: "barbell",
				grip: "pronation",
			}),
		).toBeNull();
		expect(
			unusualChoices(row, { mode: "reps", equipment: "barbell", grip: null }),
		).toBeNull();
		expect(
			unusualChoices(row, {
				mode: "reps",
				equipment: "dumbbell",
				grip: "supination",
			}),
		).toBe("haltères · supination");
	});

	it("sums up the open choices for the chip, unknown grip included", () => {
		expect(
			choicesSummary(row, { mode: "reps", equipment: "dumbbell", grip: null }),
		).toBe("Haltères · prise ?");
		expect(
			choicesSummary(row, {
				mode: "reps",
				equipment: "barbell",
				grip: "neutral",
			}),
		).toBe("Barre · neutre");
		expect(
			choicesSummary(exercise({ id: "fly", name: "Oiseau" }), {
				mode: "reps",
				equipment: "barbell",
				grip: null,
			}),
		).toBeNull();
	});
});
