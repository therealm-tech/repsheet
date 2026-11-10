import type { PlannedSessionSummary } from "@/lib/api/schemas";

export type PlannedStatus = "logged" | "missed" | "planned";

/** Logged once a workout comes from it; missed once its day is past without one. */
export function plannedStatus(
	session: Pick<PlannedSessionSummary, "plannedOn" | "workoutCount">,
	today: string,
): PlannedStatus {
	if (session.workoutCount > 0) {
		return "logged";
	}
	return session.plannedOn < today ? "missed" : "planned";
}
