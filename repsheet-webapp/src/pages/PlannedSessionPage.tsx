import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExerciseName, plannedSummary } from "@/components/BlockCard";
import { BlockSheet, type PlanSheetMode } from "@/components/BlockSheet";
import { lostAccess, NoLongerCoach } from "@/components/NoLongerCoach";
import { ReorderableBlock, useDragReorder } from "@/components/Reorder";
import { SendSessionSheet } from "@/components/SendSessionSheet";
import { ConfirmButton, ErrorText, KindTag, Sheet } from "@/components/ui";
import { WorkoutForm } from "@/components/WorkoutForm";
import { WorkoutReadOnly } from "@/components/WorkoutReadOnly";
import { api, athletePerformanceQuery, keys } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/errors";
import type {
	PlannedSession,
	TemplateBlock,
	UpdatePlannedSessionInput,
	WeightUnit,
} from "@/lib/api/schemas";
import { letter, summarizeSets } from "@/lib/blocks";
import { formatDay, formatShortDay, today } from "@/lib/dates";
import { useMe, useUnit } from "@/lib/hooks";
import { moveBlock } from "@/lib/reorder";

interface BlockMove {
	from: number;
	to: number;
	blockId: string;
}

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
	unit,
	onOpen,
}: {
	block: TemplateBlock;
	index: number;
	athleteId: string;
	unit: WeightUnit;
	onOpen: () => void;
}) {
	const { t } = useTranslation();
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
						<ExerciseName exercise={entry.exercise} chosen={entry} />
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
 * sent. Below, what the athlete logged from it. For a profile the caller
 * manages, the coach starts the session with the athlete, logging it for
 * them, or sends it to them as text.
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
	const [sending, setSending] = useState(false);
	const me = useMe().data;
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
	const start = useMutation({
		mutationFn: api.createWorkout,
		onSuccess: (workout) => {
			void queryClient.invalidateQueries({
				queryKey: keys.plannedSessionWorkouts(sessionId),
			});
			void queryClient.invalidateQueries({ queryKey: keys.plannedSessions });
			void queryClient.invalidateQueries({
				queryKey: keys.sharedWorkouts(athleteId),
			});
			void navigate({
				to: "/athletes/$athleteId/workouts/$workoutId",
				params: { athleteId, workoutId: workout.id },
			});
		},
	});
	// Applied at once, so that a dropped block stays where it was dropped.
	const reorder = useMutation({
		mutationFn: ({ to, blockId }: BlockMove) =>
			api.movePlannedBlock(sessionId, blockId, to + 1),
		onMutate: async ({ from, to }) => {
			await queryClient.cancelQueries({
				queryKey: keys.plannedSession(sessionId),
			});
			const previous = queryClient.getQueryData<PlannedSession>(
				keys.plannedSession(sessionId),
			);
			if (previous) {
				queryClient.setQueryData(keys.plannedSession(sessionId), {
					...previous,
					blocks: moveBlock(previous.blocks, from, to),
				});
			}
			return { previous };
		},
		onError: (_error, _move, context) => {
			if (context?.previous) {
				queryClient.setQueryData(
					keys.plannedSession(sessionId),
					context.previous,
				);
			}
		},
		onSuccess: (updated) => {
			queryClient.setQueryData(keys.plannedSession(sessionId), updated);
		},
	});
	const blocks = session.data?.blocks ?? [];
	function move(from: number, to: number) {
		const block = blocks[from];
		if (block) {
			reorder.mutate({ from, to, blockId: block.id });
		}
	}
	const drag = useDragReorder(blocks.length, move);
	const managed = athlete.data?.managed ?? false;
	const unit = useUnit(managed ? athlete.data?.weightUnit : undefined);
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
	const sessionActions = managed ? (
		<div className="session-actions">
			{first ? (
				<Link
					to="/athletes/$athleteId/workouts/$workoutId"
					params={{ athleteId, workoutId: first.id }}
					className="btn btn-primary"
				>
					{t("plannedSession.resume", { name })}
				</Link>
			) : (
				<button
					type="button"
					className="btn btn-primary"
					disabled={s.blocks.length === 0 || start.isPending}
					onClick={() =>
						start.mutate({
							athleteId,
							templateId: sessionId,
							name: s.name,
							performedOn: today(),
						})
					}
				>
					{t("plannedSession.start", { name })}
				</button>
			)}
			<button
				type="button"
				className="btn btn-ghost"
				disabled={s.blocks.length === 0}
				onClick={() => setSending(true)}
			>
				{t("plannedSession.sendTo", { name })}
			</button>
			{start.isError ? (
				<ErrorText>
					{errorMessage(start.error, { fallback: "createWorkoutFailed" })}
				</ErrorText>
			) : null}
		</div>
	) : null;
	const meta = [
		formatDay(s.plannedOn),
		name ? t("plannedSession.forAthlete", { name }) : null,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<main
			className={managed ? "screen with-fab with-fab-pair" : "screen with-fab"}
		>
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

			{s.status === "draft" && !managed ? (
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
					{reorder.isError ? (
						<ErrorText>
							{errorMessage(reorder.error, { fallback: "saveFailed" })}
						</ErrorText>
					) : null}
					{s.blocks.map((block, i) => {
						const card = (
							<PlanBlockCard
								block={block}
								index={i + 1}
								athleteId={athleteId}
								unit={unit}
								onOpen={() => setSheet({ kind: "edit", block })}
							/>
						);
						return s.blocks.length > 1 ? (
							<ReorderableBlock
								key={block.id}
								index={i}
								count={s.blocks.length}
								reorder={drag}
								onMove={(to) => move(i, to)}
							>
								{card}
							</ReorderableBlock>
						) : (
							<Fragment key={block.id}>{card}</Fragment>
						);
					})}
					{managed ? (
						<button
							type="button"
							className="btn btn-ghost mobile-only"
							onClick={() => setSheet({ kind: "new" })}
						>
							{t("workout.addBlock")}
						</button>
					) : null}
				</div>

				<div className="workout-aside">
					{sessionActions ? (
						<div className="desktop-only">{sessionActions}</div>
					) : null}
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
									managedAthlete={managed ? athlete.data : undefined}
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
				{sessionActions ?? (
					<button
						type="button"
						className="btn btn-primary btn-fab"
						onClick={() => setSheet({ kind: "new" })}
					>
						{t("workout.addBlock")}
					</button>
				)}
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

			{sending ? (
				<SendSessionSheet
					session={s}
					athleteName={name}
					coachName={me?.name ?? ""}
					unit={unit}
					onClose={() => setSending(false)}
				/>
			) : null}

			{sheet ? (
				<BlockSheet
					plan={{
						sessionId,
						athlete: {
							id: athleteId,
							name,
							...(managed && athlete.data
								? { weightUnit: athlete.data.weightUnit }
								: {}),
						},
					}}
					mode={sheet}
					onClose={() => setSheet(null)}
				/>
			) : null}
		</main>
	);
}
