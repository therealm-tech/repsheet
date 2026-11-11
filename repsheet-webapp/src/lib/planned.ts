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

export const STATUS_TAG: Record<PlannedStatus, string> = {
	draft: "tag tag-coach",
	logged: "tag tag-ok",
	missed: "tag tag-orange",
	planned: "tag",
};

export type Outlook = {
	/** The earliest session on or after today with no workout logged yet, drafts included. */
	next: PlannedSessionSummary | undefined;
	/** The latest of the others, once there is no next one to show. */
	last: PlannedSessionSummary | undefined;
};

/** Where an athlete stands, from their sessions listed latest day first. */
export function outlook(
	sessions: PlannedSessionSummary[],
	today: string,
): Outlook {
	const upcoming = (s: PlannedSessionSummary) =>
		s.plannedOn >= today && s.workoutCount === 0;
	return {
		next: sessions.filter(upcoming).at(-1),
		last: sessions.find((s) => !upcoming(s)),
	};
}
