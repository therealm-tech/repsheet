import { describe, expect, it } from "vitest";
import type { WorkoutSet } from "@/lib/api/schemas";
import { bestSet, bestVolume, metricFor, progression } from "@/lib/stats";
import { performance } from "./helpers";

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

const history = [
	performance(
		[
			set(1, { reps: 10, weightKg: 80, warmup: true }),
			set(2, { reps: 6, weightKg: 62.5 }),
			set(3, { reps: 8, weightKg: 60 }),
		],
		"2026-10-22",
	),
	performance(
		[set(1, { reps: 8, weightKg: 57.5 }), set(2, { reps: 8, weightKg: 57.5 })],
		"2026-10-14",
	),
];

describe("progression", () => {
	it("keeps the best working weight per performance, oldest first", () => {
		expect(progression("load", history)).toEqual([
			{ date: "2026-10-14", value: 57.5 },
			{ date: "2026-10-22", value: 62.5 },
		]);
	});

	it("tracks duration for timed exercises", () => {
		const timed = [
			performance([
				set(1, { durationSeconds: 40 }),
				set(2, { durationSeconds: 45 }),
			]),
		];
		expect(progression("time", timed).map((p) => p.value)).toEqual([45]);
	});
});

describe("metricFor", () => {
	it("tracks the load of weighted reps and the count otherwise", () => {
		expect(metricFor("reps", "required")).toBe("load");
		expect(metricFor("reps", "optional")).toBe("reps");
		expect(metricFor("reps", "none")).toBe("reps");
		expect(metricFor("time", "required")).toBe("time");
		expect(metricFor("distance", "none")).toBe("distance");
	});
});

describe("records", () => {
	it("ignores warm-ups for the best set", () => {
		expect(bestSet("load", history)).toMatchObject({
			reps: 6,
			weightKg: 62.5,
		});
	});

	it("breaks weight ties with reps", () => {
		const tie = [
			performance([
				set(1, { reps: 5, weightKg: 60 }),
				set(2, { reps: 7, weightKg: 60 }),
			]),
		];
		expect(bestSet("load", tie)?.reps).toBe(7);
	});

	it("computes the best tonnage without warm-ups", () => {
		expect(bestVolume(history)).toBe(2 * 8 * 57.5);
		expect(bestVolume([])).toBeNull();
	});
});
