import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PlannedBlockCard } from "@/components/BlockCard";
import { lostAccess, NoLongerCoach } from "@/components/NoLongerCoach";
import { ConfirmButton, ErrorText } from "@/components/ui";
import { WorkoutReadOnly } from "@/components/WorkoutReadOnly";
import { api, keys } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/errors";
import { formatDay, formatMinutes, formatShortDay } from "@/lib/dates";

/** A session the caller planned, and what the athlete logged from it. */
export function PlannedSessionPage({
	athleteId,
	sessionId,
}: {
	athleteId: string;
	sessionId: string;
}) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const athlete = useQuery({
		queryKey: keys.athlete(athleteId),
		queryFn: () => api.athlete(athleteId),
	});
	const session = useQuery({
		queryKey: keys.plannedSession(sessionId),
		queryFn: () => api.plannedSession(sessionId),
	});
	const outcome = useQuery({
		queryKey: keys.plannedSessionWorkouts(sessionId),
		queryFn: () => api.plannedSessionWorkouts(sessionId),
	});
	const remove = useMutation({
		mutationFn: () => api.deletePlannedSession(sessionId),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: keys.plannedSessions });
			void navigate({
				to: "/coaching/athletes/$athleteId",
				params: { athleteId },
			});
		},
	});

	if ([athlete, session, outcome].some((q) => lostAccess(q.error))) {
		return <NoLongerCoach />;
	}
	if (session.isError) {
		return (
			<main className="screen narrow">
				<ErrorText>{t("plannedSession.loadFailed")}</ErrorText>
			</main>
		);
	}
	if (!session.data) {
		return <main className="screen muted">{t("common.loading")}</main>;
	}
	const s = session.data;
	const workouts = outcome.data?.items ?? [];
	const first = workouts[0];

	return (
		<main className="screen narrow">
			<header className="bar">
				<Link
					to="/coaching/athletes/$athleteId"
					params={{ athleteId }}
					className="icon-button"
					aria-label={t("coaching.back")}
				>
					‹
				</Link>
				<h1 className="workout-title">
					<span className="strong truncate">{s.name}</span>
					<span className="muted small">
						{[athlete.data?.name, formatDay(s.plannedOn)]
							.filter(Boolean)
							.join(" · ")}
					</span>
				</h1>
				<span className="icon-spacer" />
			</header>
			<div className="row">
				{first ? (
					<span className="tag tag-ok">
						{t("plannedSession.loggedOn", {
							date: formatShortDay(first.performedOn),
						})}
					</span>
				) : outcome.isSuccess ? (
					<span className="tag">{t("plannedSession.notLogged")}</span>
				) : null}
				{first?.durationMinutes ? (
					<span className="muted small">
						{formatMinutes(first.durationMinutes)}
					</span>
				) : null}
			</div>
			{s.note ? <p className="workout-note">{s.note}</p> : null}

			{workouts.length > 0 ? (
				<section className="stack-tight" aria-labelledby="logged-title">
					<h2 id="logged-title" className="display section-title">
						{t("plannedSession.whatWasLogged")}
					</h2>
					{workouts.map((workout) => (
						<WorkoutReadOnly
							key={workout.id}
							workout={workout}
							plannedBlocks={s.blocks}
						/>
					))}
				</section>
			) : (
				<section className="stack-tight" aria-labelledby="plan-title">
					<h2 id="plan-title" className="display section-title">
						{t("plannedSession.plan")}
					</h2>
					{s.blocks.map((block, i) => (
						<PlannedBlockCard
							key={block.id}
							block={block}
							index={i + 1}
							status=""
						/>
					))}
				</section>
			)}

			<Link
				to="/coaching/athletes/$athleteId/sessions/$sessionId/edit"
				params={{ athleteId, sessionId }}
				className="btn"
			>
				{t("plannedSession.edit")}
			</Link>
			{remove.isError ? (
				<ErrorText>
					{errorMessage(remove.error, { fallback: "deleteFailed" })}
				</ErrorText>
			) : null}
			<ConfirmButton
				label={t("plannedSession.delete")}
				confirmLabel={t("common.confirmDelete")}
				onConfirm={() => remove.mutate()}
				disabled={remove.isPending}
			/>
		</main>
	);
}
