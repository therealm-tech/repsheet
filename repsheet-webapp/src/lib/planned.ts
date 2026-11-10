import type { PlannedSessionSummary } from "@/lib/api/schemas";

export type PlannedStatus = "draft" | "logged" | "missed" | "planned";

/**
 * A draft until it is sent; then logged once a workout comes from it, missed
 * once its day is past without one.
 */
export function plannedStatus(
	session: Pick<PlannedSessionSummary, "plannedOn" | "workoutCount" | "status">,
	today: string,
): PlannedStatus {
	if (session.status === "draft") {
		return "draft";
	}
	if (session.workoutCount > 0) {
		return "logged";
	}
	return session.plannedOn < today ? "missed" : "planned";
}
