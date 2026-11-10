import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { lostAccess, NoLongerCoach } from "@/components/NoLongerCoach";
import { WorkoutReadOnly } from "@/components/WorkoutReadOnly";
import { api, keys } from "@/lib/api/endpoints";
import { formatDay, formatMinutes } from "@/lib/dates";

/** A workout an athlete shared with the caller, read-only. */
export function SharedWorkoutPage({
	athleteId,
	workoutId,
}: {
	athleteId: string;
	workoutId: string;
}) {
	const { t } = useTranslation();
	const athlete = useQuery({
		queryKey: keys.athlete(athleteId),
		queryFn: () => api.athlete(athleteId),
	});
	const workout = useQuery({
		queryKey: keys.workout(workoutId),
		queryFn: () => api.workout(workoutId),
	});
	if (lostAccess(athlete.error) || lostAccess(workout.error)) {
		return <NoLongerCoach />;
	}
	if (!workout.data) {
		return <main className="screen muted">{t("common.loading")}</main>;
	}
	const w = workout.data;
	const meta = [
		athlete.data?.name,
		formatDay(w.performedOn),
		w.durationMinutes === null ? null : formatMinutes(w.durationMinutes),
	]
		.filter(Boolean)
		.join(" · ");
	return (
		<main className="screen narrow">
			<header className="bar">
				<Link
					to="/athletes/$athleteId"
					params={{ athleteId }}
					className="icon-button"
					aria-label={t("coaching.back")}
				>
					‹
				</Link>
				<h1 className="workout-title">
					<span className="strong truncate">{w.name}</span>
					<span className="muted small">{meta}</span>
				</h1>
				<span className="icon-spacer" />
			</header>
			<WorkoutReadOnly workout={w} athleteId={athleteId} />
		</main>
	);
}
