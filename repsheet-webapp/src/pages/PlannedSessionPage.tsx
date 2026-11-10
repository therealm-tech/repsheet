import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { plannedSummary } from "@/components/BlockCard";
import { BlockSheet, type PlanSheetMode } from "@/components/BlockSheet";
import { lostAccess, NoLongerCoach } from "@/components/NoLongerCoach";
import { ConfirmButton, ErrorText, KindTag, Sheet } from "@/components/ui";
import { WorkoutForm } from "@/components/WorkoutForm";
import { WorkoutReadOnly } from "@/components/WorkoutReadOnly";
import { api, athletePerformanceQuery, keys } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/errors";
import type {
	TemplateBlock,
	UpdatePlannedSessionInput,
	WeightUnit,
} from "@/lib/api/schemas";
import { choiceTags, letter, summarizeSets } from "@/lib/blocks";
import { formatDay, formatShortDay } from "@/lib/dates";
import { useUnit } from "@/lib/hooks";

/** "↺ 10 nov. : 2×12 · 14→16 kg": the athlete's last time at the exercise, as their coach reads it. */
function LastSince({
	athleteId,
	entry,
	unit,
}: {
	athleteId: string;
	entry: TemplateBlock["exercises"][number];
	unit: WeightUnit;
}) {
	const { t } = useTranslation();
	const last = useQuery(
		athletePerformanceQuery(athleteId, entry.exercise.id, entry),
	).data?.items[0];
	if (!last) {
		return null;
	}
	return (
		<span className="plan-since">
			{t("plannedSession.lastSince", {
				date: formatShortDay(last.performedOn),
				summary: summarizeSets(
					entry.mode,
					entry.exercise.load,
					last.sets,
					unit,
				),
			})}
		</span>
	);
}

/** A block the coach plans, summarised as a logged one, over the athlete's last time. */
function PlanBlockCard({
	block,
	index,
	athleteId,
	onOpen,
}: {
	block: TemplateBlock;
	index: number;
	athleteId: string;
	onOpen: () => void;
}) {
	const { t } = useTranslation();
	const unit = useUnit();
	return (
		<button
			type="button"
			className="block"
			onClick={onOpen}
			aria-label={t("block.title", { position: index })}
		>
			<span className="block-head">
				<b>{index}</b>
				<KindTag kind={block.kind} />
				<span className="grow" />
				<span className="muted small">{t("block.planned")}</span>
			</span>
			{block.exercises.map((entry, i) => (
				<span key={entry.id} className="block-exercise">
					<span className="ex">
						<span className="ex-letter">{letter(i)}</span>
						<span className="ex-name">
							{entry.exercise.name}
							{choiceTags(entry.exercise, entry).map((tag) => (
								<span key={tag} className="muted">
									{" "}
									· {tag}
								</span>
							))}
						</span>
						<span className="ex-value">{plannedSummary(block, i, unit)}</span>
					</span>
					<LastSince athleteId={athleteId} entry={entry} unit={unit} />
				</span>
			))}
		</button>
	);
}

/**
 * A session the caller plans for an athlete, laid out as a workout: its
 * blocks, saved one by one, stay a draft the athlete does not see until it is
 * sent. Below, what the athlete logged from it.
 */
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
	const [sheet, setSheet] = useState<PlanSheetMode | null>(null);
	const [editing, setEditing] = useState(false);
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
	const update = useMutation({
		mutationFn: (body: UpdatePlannedSessionInput) =>
			api.updatePlannedSession(sessionId, body),
		onSuccess: (updated) => {
			queryClient.setQueryData(keys.plannedSession(sessionId), updated);
			void queryClient.invalidateQueries({ queryKey: keys.plannedSessions });
			setEditing(false);
		},
	});
	const send = useMutation({
		mutationFn: () => api.sendPlannedSession(sessionId),
		onSuccess: (sent) => {
			queryClient.setQueryData(keys.plannedSession(sessionId), sent);
			void queryClient.invalidateQueries({ queryKey: keys.plannedSessions });
		},
	});
	const remove = useMutation({
		mutationFn: () => api.deletePlannedSession(sessionId),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: keys.plannedSessions });
			void navigate({
				to: "/athletes/$athleteId",
				params: { athleteId },
			});
		},
	});

	if ([athlete, session, outcome].some((q) => lostAccess(q.error))) {
		return <NoLongerCoach />;
	}
	if (session.isError) {
		return (
			<main className="screen">
				<ErrorText>{t("plannedSession.loadFailed")}</ErrorText>
			</main>
		);
	}
	if (!session.data) {
		return <main className="screen muted">{t("common.loading")}</main>;
	}
	const s = session.data;
	const name = athlete.data?.name ?? "";
	const workouts = outcome.data?.items ?? [];
	const first = workouts[0];
	const meta = [
		formatDay(s.plannedOn),
		name ? t("plannedSession.forAthlete", { name }) : null,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<main className="screen with-fab">
			<header className="bar">
				<Link
					to="/athletes/$athleteId"
					params={{ athleteId }}
					className="icon-button"
					aria-label={t("coaching.back")}
				>
					✕
				</Link>
				<button
					type="button"
					className="workout-title"
					aria-label={t("plannedSession.editNamed", { name: s.name, meta })}
					onClick={() => setEditing(true)}
				>
					<span className="strong truncate">{s.name}</span>
					<span className="muted small">{meta}</span>
				</button>
				<button
					type="button"
					className="btn btn-primary btn-small desktop-only"
					onClick={() => setSheet({ kind: "new" })}
				>
					{t("workout.addBlock")}
				</button>
				<button
					type="button"
					className="icon-button"
					aria-label={t("plannedSession.edit")}
					onClick={() => setEditing(true)}
				>
					✎
				</button>
			</header>

			{s.status === "draft" ? (
				<div className="row draft-banner">
					<span className="tag">{t("plannedSession.draft")}</span>
					<span className="muted small grow">
						{t("plannedSession.draftHint", { name })}
					</span>
					<button
						type="button"
						className="btn btn-small btn-primary"
						disabled={s.blocks.length === 0 || send.isPending}
						onClick={() => send.mutate()}
					>
						{t("plannedSession.send")}
					</button>
				</div>
			) : null}
			{send.isError ? (
				<ErrorText>
					{errorMessage(send.error, { fallback: "saveFailed" })}
				</ErrorText>
			) : null}

			<div className="workout-layout">
				<div className="workout-blocks">
					{s.blocks.length === 0 ? (
						<p className="empty">{t("plannedSession.empty", { name })}</p>
					) : null}
					{s.blocks.map((block, i) => (
						<PlanBlockCard
							key={block.id}
							block={block}
							index={i + 1}
							athleteId={athleteId}
							onOpen={() => setSheet({ kind: "edit", block })}
						/>
					))}
				</div>

				<div className="workout-aside">
					{s.note ? <p className="workout-note">{s.note}</p> : null}
					{workouts.length > 0 ? (
						<section className="stack-tight" aria-labelledby="logged-title">
							<div className="row">
								<h2 id="logged-title" className="display section-title grow">
									{t("plannedSession.whatWasLogged")}
								</h2>
								{first ? (
									<span className="tag tag-ok">
										{t("plannedSession.loggedOn", {
											date: formatShortDay(first.performedOn),
										})}
									</span>
								) : null}
							</div>
							{workouts.map((workout) => (
								<WorkoutReadOnly
									key={workout.id}
									workout={workout}
									athleteId={athleteId}
									plannedBlocks={s.blocks}
								/>
							))}
						</section>
					) : null}
					<div className="stack-tight workout-actions">
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
					</div>
				</div>
			</div>

			<div className="fab mobile-only">
				<button
					type="button"
					className="btn btn-primary btn-fab"
					onClick={() => setSheet({ kind: "new" })}
				>
					{t("workout.addBlock")}
				</button>
			</div>

			{editing ? (
				<Sheet
					title={t("plannedSession.edit")}
					onClose={() => setEditing(false)}
				>
					<h2 className="display sheet-title">{t("plannedSession.edit")}</h2>
					<div className="sheet-body">
						<WorkoutForm
							title={t("plannedSession.edit")}
							submitLabel={t("common.save")}
							withNote
							withDuration={false}
							notePlaceholder={t("plannedSession.notePlaceholder")}
							initial={{
								name: s.name,
								performedOn: s.plannedOn,
								durationMinutes: null,
								note: s.note,
							}}
							pending={update.isPending}
							error={
								update.isError
									? errorMessage(update.error, { fallback: "updateFailed" })
									: null
							}
							onCancel={() => {
								update.reset();
								setEditing(false);
							}}
							onSubmit={(values) =>
								update.mutate({
									plannedOn: values.performedOn,
									name: values.name,
									note: values.note,
								})
							}
						/>
					</div>
				</Sheet>
			) : null}

			{sheet ? (
				<BlockSheet
					plan={{ sessionId, athlete: { id: athleteId, name } }}
					mode={sheet}
					onClose={() => setSheet(null)}
				/>
			) : null}
		</main>
	);
}
