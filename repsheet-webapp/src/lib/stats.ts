import type { Load, Mode, Performance, WorkoutSet } from "@/lib/api/schemas";

export interface Point {
	date: string;
	value: number;
}

/** What progress means for an exercise counted in a mode. */
export type Metric = "load" | "reps" | "time" | "distance";

/** Heaviest load for weighted reps; most reps, longest time or distance otherwise. */
export function metricFor(mode: Mode, load: Load): Metric {
	if (mode === "reps") {
		return load === "required" ? "load" : "reps";
	}
	return mode;
}

function metricValue(metric: Metric, set: WorkoutSet): number | null {
	switch (metric) {
		case "load":
			return set.weightKg;
		case "reps":
			return set.reps;
		case "time":
			return set.durationSeconds;
		case "distance":
			return set.distanceMeters;
	}
}

/** The best working value of each performance, oldest first. Warm-ups never count. */
export function progression(
	metric: Metric,
	performances: Performance[],
): Point[] {
	return (
		performances
			.flatMap((p) => {
				const values = p.sets.flatMap((s) => {
					const v = s.warmup ? null : metricValue(metric, s);
					return v === null ? [] : [v];
				});
				return values.length === 0
					? []
					: [{ date: p.performedOn, value: Math.max(...values) }];
			})
			// The API lists newest first; reversing keeps same-day sessions in creation order.
			.reverse()
			.sort((a, b) => a.date.localeCompare(b.date))
	);
}

/** The best working set for the metric; for the heaviest load, most reps breaks ties. */
export function bestSet(
	metric: Metric,
	performances: Performance[],
): WorkoutSet | null {
	let best: WorkoutSet | null = null;
	for (const set of performances.flatMap((p) => p.sets)) {
		if (set.warmup || metricValue(metric, set) === null) {
			continue;
		}
		if (best === null) {
			best = set;
			continue;
		}
		const a = metricValue(metric, set) ?? 0;
		const b = metricValue(metric, best) ?? 0;
		if (
			a > b ||
			(a === b && metric === "load" && (set.reps ?? 0) > (best.reps ?? 0))
		) {
			best = set;
		}
	}
	return best;
}

/** The largest tonnage (reps × kg over working sets) lifted in one performance. */
export function bestVolume(performances: Performance[]): number | null {
	const volumes = performances.map((p) =>
		p.sets.reduce(
			(sum, s) => (s.warmup ? sum : sum + (s.reps ?? 0) * (s.weightKg ?? 0)),
			0,
		),
	);
	const max = Math.max(0, ...volumes);
	return max > 0 ? max : null;
}
