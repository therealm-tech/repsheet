import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DateIcon } from "@/components/DateIcon";
import { lostAccess, NoLongerCoach } from "@/components/NoLongerCoach";
import { Empty, ErrorText, Sheet } from "@/components/ui";
import { WorkoutForm } from "@/components/WorkoutForm";
import { api, keys } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/errors";
import { formatDay, formatMinutes, today } from "@/lib/dates";
import { type PlannedStatus, plannedStatus } from "@/lib/planned";

const STATUS_CLASS: Record<PlannedStatus, string> = {
	draft: "tag tag-coach",
	logged: "tag tag-ok",
	missed: "tag tag-orange",
	planned: "tag",
};

/** One athlete, as their coach sees them: the sessions planned for them and the workouts they shared. */
export function AthletePage({ athleteId }: { athleteId: string }) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [planning, setPlanning] = useState(false);
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

	const create = useMutation({
		mutationFn: api.createPlannedSession,
		onSuccess: (session) => {
			queryClient.setQueryData(keys.plannedSession(session.id), session);
			void queryClient.invalidateQueries({ queryKey: keys.plannedSessions });
			void navigate({
				to: "/coaching/athletes/$athleteId/sessions/$sessionId",
				params: { athleteId, sessionId: session.id },
			});
		},
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
			<button
				type="button"
				className="btn btn-primary"
				onClick={() => setPlanning(true)}
			>
				{t("athlete.planSession")}
			</button>

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

			{planning ? (
				<Sheet
					title={t("plannedSession.newTitle", {
						name: athlete.data?.name ?? "",
					})}
					onClose={() => {
						create.reset();
						setPlanning(false);
					}}
				>
					<h2 className="display sheet-title">
						{t("plannedSession.newTitle", { name: athlete.data?.name ?? "" })}
					</h2>
					<div className="sheet-body">
						<WorkoutForm
							title={t("plannedSession.newTitle", {
								name: athlete.data?.name ?? "",
							})}
							submitLabel={t("plannedSession.create")}
							withNote
							withDuration={false}
							notePlaceholder={t("plannedSession.notePlaceholder")}
							initial={{
								name: "",
								performedOn: today(),
								durationMinutes: null,
								note: null,
							}}
							pending={create.isPending}
							error={
								create.isError
									? errorMessage(create.error, { fallback: "saveFailed" })
									: null
							}
							onCancel={() => {
								create.reset();
								setPlanning(false);
							}}
							onSubmit={(values) =>
								create.mutate({
									athleteId,
									plannedOn: values.performedOn,
									name: values.name,
									note: values.note,
								})
							}
						/>
					</div>
				</Sheet>
			) : null}
		</main>
	);
}
