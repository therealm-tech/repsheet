import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BlockCard, PlannedBlockCard } from "@/components/BlockCard";
import { BlockSheet, type BlockSheetMode } from "@/components/BlockSheet";
import { ReorderableBlock, useDragReorder } from "@/components/Reorder";
import { ShareWithCoaches } from "@/components/ShareWithCoaches";
import { ConfirmButton, ErrorText, Sheet } from "@/components/ui";
import { WorkoutForm } from "@/components/WorkoutForm";
import { api, keys } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/errors";
import type {
	Athlete,
	Author,
	TemplateBlock,
	UpdateWorkoutInput,
	Workout,
} from "@/lib/api/schemas";
import { formatDay, formatMinutes } from "@/lib/dates";
import { useMe, useUnit } from "@/lib/hooks";
import { moveBlock } from "@/lib/reorder";

interface BlockMove {
	from: number;
	to: number;
	blockId: string;
}

/**
 * A workout the caller logs: their own, or, with `athlete`, one of a profile
 * they manage, logged on its behalf with its unit and history.
 */
export function WorkoutPage({
	workoutId,
	athlete,
}: {
	workoutId: string;
	athlete?: Athlete;
}) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const unit = useUnit(athlete?.weightUnit);
	const meId = useMe().data?.id ?? "";
	const ownerId = athlete?.id ?? meId;
	const [sheet, setSheet] = useState<BlockSheetMode | null>(null);
	const [editing, setEditing] = useState(false);
	const workout = useQuery({
		queryKey: keys.workout(workoutId),
		queryFn: () => api.workout(workoutId),
	});
	const templateId = workout.data?.templateId ?? null;
	// A profile's sessions are its manager's to read as planned sessions, not
	// as templates of their own.
	const template = useQuery<{
		author: Author | null;
		note: string | null;
		blocks: TemplateBlock[];
	}>({
		queryKey: athlete
			? keys.plannedSession(templateId ?? "")
			: keys.template(templateId ?? ""),
		queryFn: () =>
			athlete
				? api.plannedSession(templateId ?? "")
				: api.template(templateId ?? ""),
		enabled: templateId !== null,
	});
	const coach = template.data?.author ?? null;

	const update = useMutation({
		mutationFn: (body: UpdateWorkoutInput) =>
			api.updateWorkout(workoutId, body),
		onSuccess: (updated) => {
			queryClient.setQueryData(keys.workout(workoutId), updated);
			void queryClient.invalidateQueries({ queryKey: keys.workouts });
			// A new date changes which earlier sessions the comparisons use.
			void queryClient.invalidateQueries({ queryKey: ["performances"] });
			setEditing(false);
		},
	});

	// Applied at once, so that a dropped block stays where it was dropped.
	const reorder = useMutation({
		mutationFn: ({ to, blockId }: BlockMove) =>
			api.moveBlock(workoutId, blockId, to + 1),
		onMutate: async ({ from, to }) => {
			await queryClient.cancelQueries({ queryKey: keys.workout(workoutId) });
			const previous = queryClient.getQueryData<Workout>(
				keys.workout(workoutId),
			);
			if (previous) {
				queryClient.setQueryData(keys.workout(workoutId), {
					...previous,
					blocks: moveBlock(previous.blocks, from, to),
				});
			}
			return { previous };
		},
		onError: (_error, _move, context) => {
			if (context?.previous) {
				queryClient.setQueryData(keys.workout(workoutId), context.previous);
			}
		},
		onSuccess: (updated) => {
			queryClient.setQueryData(keys.workout(workoutId), updated);
		},
	});
	const blocks = workout.data?.blocks ?? [];
	function move(from: number, to: number) {
		const block = blocks[from];
		if (block) {
			reorder.mutate({ from, to, blockId: block.id });
		}
	}
	const drag = useDragReorder(blocks.length, move);

	const remove = useMutation({
		mutationFn: () => api.deleteWorkout(workoutId),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: keys.workouts });
			if (athlete) {
				void queryClient.invalidateQueries({
					queryKey: keys.plannedSessionWorkouts(templateId ?? ""),
				});
				void navigate({
					to: "/athletes/$athleteId",
					params: { athleteId: athlete.id },
				});
			} else {
				void navigate({ to: "/" });
			}
		},
	});

	if (workout.isPending) {
		return <main className="screen muted">{t("common.loading")}</main>;
	}
	if (workout.isError) {
		return (
			<main className="screen">
				<ErrorText>{t("workout.notFound")}</ErrorText>
				<Link to="/">{t("common.backHome")}</Link>
			</main>
		);
	}

	const w = workout.data;
	const loggedTemplateBlocks = new Set(
		w.blocks.map((b) => b.templateBlockId).filter(Boolean),
	);
	const planned = (template.data?.blocks ?? []).filter(
		(b) => !loggedTemplateBlocks.has(b.id),
	);
	const meta = [
		formatDay(w.performedOn),
		w.durationMinutes === null ? null : formatMinutes(w.durationMinutes),
		athlete
			? athlete.name
			: coach
				? t("workout.plannedBy", { name: coach.name })
				: null,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<main className="screen with-fab">
			<header className="bar">
				{athlete ? (
					<Link
						to="/athletes/$athleteId"
						params={{ athleteId: athlete.id }}
						className="icon-button"
						aria-label={t("coaching.back")}
					>
						✕
					</Link>
				) : (
					<Link
						to="/"
						className="icon-button"
						aria-label={t("common.backHome")}
					>
						✕
					</Link>
				)}
				<button
					type="button"
					className="workout-title"
					aria-label={t("workout.editNamed", { name: w.name, meta })}
					onClick={() => setEditing(true)}
				>
					<span className="strong truncate">{w.name}</span>
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
					aria-label={t("workout.edit")}
					onClick={() => setEditing(true)}
				>
					✎
				</button>
			</header>

			{athlete ? (
				<p className="logging-for small">
					{t("workout.loggedFor", { name: athlete.name })}
				</p>
			) : null}

			<div className="workout-layout">
				<div className="workout-blocks">
					{w.blocks.length === 0 && planned.length === 0 ? (
						<p className="empty">
							{athlete
								? t("workout.emptyFor", { name: athlete.name })
								: t("workout.empty")}
						</p>
					) : null}

					{reorder.isError ? (
						<ErrorText>
							{errorMessage(reorder.error, { fallback: "saveFailed" })}
						</ErrorText>
					) : null}
					{w.blocks.map((block, i) => {
						const card = (
							<BlockCard
								key={block.id}
								block={block}
								workoutId={w.id}
								ownerId={ownerId}
								unit={unit}
								managed={athlete !== undefined}
								onOpen={() => {
									const templateBlock = template.data?.blocks.find(
										(b) => b.id === block.templateBlockId,
									);
									setSheet({
										kind: "edit",
										block,
										...(templateBlock ? { templateBlock } : {}),
									});
								}}
							/>
						);
						return w.blocks.length > 1 ? (
							<ReorderableBlock
								key={block.id}
								index={i}
								count={w.blocks.length}
								reorder={drag}
								onMove={(to) => move(i, to)}
							>
								{card}
							</ReorderableBlock>
						) : (
							card
						);
					})}
					{planned.map((block, i) => (
						<PlannedBlockCard
							key={block.id}
							block={block}
							index={w.blocks.length + i + 1}
							coach={coach}
							unit={unit}
							onOpen={() => setSheet({ kind: "new", templateBlock: block })}
						/>
					))}
				</div>

				<div className="workout-aside">
					{coach && template.data?.note ? (
						<p className="workout-note">{template.data.note}</p>
					) : null}
					{w.note ? <p className="workout-note">{w.note}</p> : null}
					{athlete ? null : <ShareWithCoaches workoutId={w.id} />}
					<div className="stack-tight workout-actions">
						{athlete ? null : (
							<Link
								to="/templates/new"
								search={{ fromWorkout: w.id }}
								className="btn"
							>
								{t("workout.createTemplate")}
							</Link>
						)}
						<ConfirmButton
							label={t("workout.delete")}
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
				<Sheet title={t("workout.edit")} onClose={() => setEditing(false)}>
					<h2 className="display sheet-title">{t("workout.edit")}</h2>
					<div className="sheet-body">
						<WorkoutForm
							title={t("workout.edit")}
							submitLabel={t("common.save")}
							withNote
							initial={w}
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
							onSubmit={(values) => update.mutate(values)}
						/>
					</div>
				</Sheet>
			) : null}

			{sheet ? (
				<BlockSheet
					workoutId={w.id}
					mode={sheet}
					coach={athlete ? null : coach}
					athlete={athlete ?? null}
					onClose={() => setSheet(null)}
				/>
			) : null}
		</main>
	);
}
