import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { DateIcon } from "@/components/DateIcon";
import { lostAccess, NoLongerCoach } from "@/components/NoLongerCoach";
import { Empty, ErrorText } from "@/components/ui";
import { api, keys } from "@/lib/api/endpoints";
import { formatDay, formatMinutes, today } from "@/lib/dates";
import { type PlannedStatus, plannedStatus } from "@/lib/planned";

const STATUS_CLASS: Record<PlannedStatus, string> = {
	logged: "tag tag-ok",
	missed: "tag tag-orange",
	planned: "tag",
};

/** One athlete, as their coach sees them: the sessions planned for them and the workouts they shared. */
export function AthletePage({ athleteId }: { athleteId: string }) {
	const { t } = useTranslation();
	const athlete = useQuery({
		queryKey: keys.athlete(athleteId),
		queryFn: () => api.athlete(athleteId),
	});
	const sessions = useQuery({
		queryKey: [...keys.plannedSessions, athleteId],
		queryFn: () => api.plannedSessions({ athleteId, perPage: 50 }),
	});
	const shared = useQuery({
		queryKey: keys.sharedWorkouts(athleteId),
		queryFn: () => api.workouts({ athleteId, perPage: 50 }),
	});

	if ([athlete, sessions, shared].some((q) => lostAccess(q.error))) {
		return <NoLongerCoach />;
	}
	const now = today();
	const planned = sessions.data?.items ?? [];
	const workouts = shared.data?.items ?? [];

	return (
		<main className="screen narrow">
			<header className="bar">
				<Link
					to="/coaching"
					className="icon-button"
					aria-label={t("athlete.backToAthletes")}
				>
					‹
				</Link>
				<h1 className="display page-title center grow truncate">
					{athlete.data?.name ?? ""}
				</h1>
				<span className="icon-spacer" />
			</header>
			<Link
				to="/coaching/athletes/$athleteId/sessions/new"
				params={{ athleteId }}
				className="btn btn-primary"
			>
				{t("athlete.planSession")}
			</Link>

			<section className="stack-tight" aria-labelledby="planned-title">
				<h2 id="planned-title" className="display section-title">
					{t("athlete.planned")}
				</h2>
				{sessions.isError ? (
					<ErrorText>{t("athlete.loadFailed")}</ErrorText>
				) : null}
				{sessions.isSuccess && planned.length === 0 ? (
					<Empty>{t("athlete.plannedEmpty")}</Empty>
				) : null}
				{planned.length > 0 ? (
					<ul className="card list">
						{planned.map((session) => {
							const status = plannedStatus(session, now);
							return (
								<li key={session.id}>
									<Link
										to="/coaching/athletes/$athleteId/sessions/$sessionId"
										params={{ athleteId, sessionId: session.id }}
										className="list-item"
									>
										<DateIcon day={session.plannedOn} />
										<span className="grow">
											<span className="strong">{session.name}</span>
											<span className="muted small line-block">
												{formatDay(session.plannedOn)} ·{" "}
												{t("common.blocks", { count: session.blockCount })}
											</span>
										</span>
										<span className={STATUS_CLASS[status]}>
											{t(`athlete.status.${status}`)}
										</span>
									</Link>
								</li>
							);
						})}
					</ul>
				) : null}
			</section>

			<section className="stack-tight" aria-labelledby="shared-title">
				<h2 id="shared-title" className="display section-title">
					{t("athlete.shared")}
				</h2>
				{shared.isError ? (
					<ErrorText>{t("athlete.loadFailed")}</ErrorText>
				) : null}
				{shared.isSuccess && workouts.length === 0 ? (
					<Empty>{t("athlete.sharedEmpty")}</Empty>
				) : null}
				{workouts.length > 0 ? (
					<ul className="card list">
						{workouts.map((workout) => (
							<li key={workout.id}>
								<Link
									to="/coaching/athletes/$athleteId/workouts/$workoutId"
									params={{ athleteId, workoutId: workout.id }}
									className="list-item"
								>
									<DateIcon day={workout.performedOn} />
									<span className="grow">
										<span className="strong">{workout.name}</span>
										<span className="muted small line-block">
											{[
												formatDay(workout.performedOn),
												t("common.blocks", { count: workout.blockCount }),
												workout.durationMinutes === null
													? null
													: formatMinutes(workout.durationMinutes),
											]
												.filter(Boolean)
												.join(" · ")}
										</span>
									</span>
									<span className="tag">{t("athlete.sharedTag")}</span>
								</Link>
							</li>
						))}
					</ul>
				) : null}
			</section>
		</main>
	);
}
