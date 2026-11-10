import {
	useMutation,
	useQueries,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { InstructionIcon } from "@/components/BlockCard";
import {
	COMMENT_MAX_LENGTH,
	CommentThread,
	FirstCommentDraft,
	type ThreadSubject,
} from "@/components/CommentThread";
import { ExercisePicker } from "@/components/ExercisePicker";
import { Stepper } from "@/components/Stepper";
import {
	ChoiceSwitches,
	ConfirmButton,
	ErrorText,
	KindTag,
	Sheet,
} from "@/components/ui";
import i18n from "@/i18n";
import {
	api,
	athletePerformanceQuery,
	keys,
	type LastTimeQuery,
	previousPerformanceQuery,
} from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/errors";
import type {
	Author,
	Block,
	BlockInput,
	ExerciseSummary,
	Load,
	Mode,
	Performance,
	PlannedBlockInput,
	TemplateBlock,
	WeightUnit,
	WorkoutSet,
} from "@/lib/api/schemas";
import {
	choicesText,
	equipmentWith,
	gripWith,
	kindOf,
	letter,
	modeInLower,
	summarizeSets,
} from "@/lib/blocks";
import type { ChoiceChange, Choices } from "@/lib/choices";
import { formatShortDay } from "@/lib/dates";
import {
	addExercise,
	addRound,
	type Cell,
	type Field,
	fieldsFor,
	type Grid,
	gridFromBlock,
	gridFromPlan,
	initialGrid,
	linkToBlock,
	plannedSetBySet,
	primaryField,
	removeExercise,
	removeRound,
	setCell,
	stepFor,
	stepValue,
	switchChoice,
	switchDiscards,
	toBlockExercises,
	toggleWarmup,
	weightRequired,
	withChoices,
} from "@/lib/grid";
import { useMe, useUnit } from "@/lib/hooks";
import {
	formatClock,
	formatDistance,
	formatDuration,
	formatNumber,
	kgToUnit,
	parseDuration,
} from "@/lib/units";

/**
 * `templateBlock` is the planned block it is logged from: a coach's, whose
 * cells and notes it starts from, or one of the user's templates, whose
 * instructions it shows.
 */
export type BlockSheetMode =
	| { kind: "new"; templateBlock?: TemplateBlock }
	| { kind: "edit"; block: Block; templateBlock?: TemplateBlock };

export type PlanSheetMode =
	| { kind: "new" }
	| { kind: "edit"; block: TemplateBlock };

/** A session a coach plans for one of their athletes. */
export interface PlanTarget {
	sessionId: string;
	athlete: { id: string; name: string };
}

/**
 * Logs a block of the user's workout, or, with `plan`, plans one for an
 * athlete: the same grid, filled from the athlete's last time, with a note for
 * them in place of the comments.
 */
export type BlockSheetProps = { onClose: () => void } & (
	| {
			workoutId: string;
			mode: BlockSheetMode;
			/** The coach who planned the session the workout is logged from. */
			coach?: Author | null;
			plan?: undefined;
	  }
	| {
			plan: PlanTarget;
			mode: PlanSheetMode;
			workoutId?: undefined;
			coach?: undefined;
	  }
);

/**
 * The planned exercise a column logs: the one of the same exercise at the
 * same rank among those of that exercise, as the API matches them.
 */
function plannedExerciseOf(
	grid: Grid,
	col: number,
	block: TemplateBlock,
): TemplateBlock["exercises"][number] | undefined {
	const id = grid.exercises[col]?.id;
	const rank = grid.exercises.slice(0, col).filter((e) => e.id === id).length;
	return block.exercises.filter((e) => e.exercise.id === id)[rank];
}

/** What a grid cell shows: each value with its unit, a "?" for a missing one. */
export function cellText(
	mode: Mode,
	load: Load,
	cell: Cell,
	unit: WeightUnit,
): { main: string; sub: string; empty: boolean } {
	let main: string;
	switch (mode) {
		case "reps":
			main =
				cell.reps === null
					? i18n.t("cell.missingReps")
					: i18n.t("cell.reps", { count: cell.reps });
			break;
		case "time":
			main =
				cell.duration === null
					? i18n.t("cell.missingDuration")
					: formatDuration(cell.duration);
			break;
		case "distance":
			main =
				cell.distance === null
					? i18n.t("cell.missingDistance")
					: formatDistance(cell.distance);
			break;
	}
	let sub = "";
	if (load === "required") {
		sub =
			cell.weight === null
				? i18n.t("cell.missingWeight", { unit })
				: `${formatNumber(cell.weight)} ${unit}`;
	} else if (load === "optional" && cell.weight !== null) {
		sub =
			cell.weight > 0
				? i18n.t("cell.extraLoad", {
						weight: `${formatNumber(cell.weight)} ${unit}`,
					})
				: i18n.t("cell.assistance", {
						weight: `${formatNumber(-cell.weight)} ${unit}`,
					});
	} else if (load === "optional" && mode === "reps") {
		sub = i18n.t("cell.bodyweight");
	}
	return {
		main,
		sub,
		empty: cell[primaryField(mode)] === null && cell.weight === null,
	};
}

/** One set as the coach reads it: "12 × 14 kg", "0:40 · 16 kg", "500 m". */
function setText(
	mode: Mode,
	load: Load,
	set: WorkoutSet,
	unit: WeightUnit,
): string {
	const weight =
		set.weightKg === null || load === "none"
			? null
			: `${formatNumber(kgToUnit(set.weightKg, unit))} ${unit}`;
	switch (mode) {
		case "reps":
			return weight
				? `${set.reps ?? "?"} × ${weight}`
				: i18n.t("cell.reps", { count: set.reps ?? 0 });
		case "time":
			return [formatDuration(set.durationSeconds ?? 0), weight]
				.filter(Boolean)
				.join(" · ");
		case "distance":
			return [formatDistance(set.distanceMeters ?? 0), weight]
				.filter(Boolean)
				.join(" · ");
	}
}

function fieldLabel(field: Field, load: Load): string {
	switch (field) {
		case "reps":
			return i18n.t("fields.reps");
		case "duration":
			return i18n.t("fields.duration");
		case "distance":
			return i18n.t("fields.distance");
		case "weight":
			return weightRequired(load)
				? i18n.t("fields.weight")
				: i18n.t("fields.extraLoad");
	}
}

/** The unit next to the stepper's field; a duration reads as m:ss and needs none. */
function fieldUnit(field: Field, unit: WeightUnit): string {
	switch (field) {
		case "reps":
		case "duration":
			return "";
		case "distance":
			return "m";
		case "weight":
			return unit;
	}
}

function stepText(field: Field, unit: WeightUnit): string {
	const step = formatNumber(stepFor(field));
	const suffix = field === "duration" ? "s" : fieldUnit(field, unit);
	return suffix ? `${step} ${suffix}` : step;
}

interface Active {
	row: number;
	col: number;
}

interface PendingSwitch {
	col: number;
	change: ChoiceChange;
}

/** What a switch that would clear values asks before going ahead. */
function switchQuestion(
	name: string,
	change: ChoiceChange,
	chosen: Choices,
): string {
	if ("mode" in change) {
		return i18n.t("block.switchConfirm", {
			name,
			mode: modeInLower(change.mode),
			previous: modeInLower(chosen.mode),
		});
	}
	const [how, previous] =
		"equipment" in change
			? [equipmentWith(change.equipment), equipmentWith(chosen.equipment)]
			: [gripWith(change.grip), gripWith(chosen.grip)];
	return i18n.t("block.switchLoadsConfirm", { name, how, previous });
}

export function BlockSheet(props: BlockSheetProps) {
	const { onClose } = props;
	const { t } = useTranslation();
	const unit = useUnit();
	const meId = useMe().data?.id ?? "";
	const queryClient = useQueryClient();
	const plan = props.plan ?? null;
	const logMode = props.plan ? null : props.mode;
	const planMode = props.plan ? props.mode : null;
	const workoutId = props.workoutId ?? "";
	const coach = props.plan ? null : (props.coach ?? null);
	const templateBlock =
		logMode?.kind === "new" ? logMode.templateBlock : undefined;
	const fromPlannedSets =
		templateBlock !== undefined && plannedSetBySet(templateBlock);
	const lastTime = (exerciseId: string, chosen: Choices): LastTimeQuery =>
		plan
			? athletePerformanceQuery(plan.athlete.id, exerciseId, chosen)
			: previousPerformanceQuery(exerciseId, workoutId, chosen);

	const [saved, setSaved] = useState<Block | null>(
		logMode?.kind === "edit" ? logMode.block : null,
	);
	const [drafts, setDrafts] = useState<Record<number, string>>({});
	const workout = useQuery({
		queryKey: keys.workout(workoutId),
		queryFn: () => api.workout(workoutId),
		enabled: saved !== null && !plan,
	});
	const [grid, setGrid] = useState<Grid | null>(() => {
		if (logMode?.kind === "edit") {
			return gridFromBlock(logMode.block, unit);
		}
		if (planMode?.kind === "edit") {
			return gridFromPlan(planMode.block, unit, false);
		}
		if (templateBlock && fromPlannedSets) {
			return gridFromPlan(templateBlock, unit, true);
		}
		return templateBlock ? null : { exercises: [], rows: [] };
	});
	const [notes, setNotes] = useState<Record<number, string>>(() =>
		planMode?.kind === "edit" && grid
			? Object.fromEntries(
					grid.exercises.map((e, i) => [
						e.columnId,
						planMode.block.exercises[i]?.note ?? "",
					]),
				)
			: {},
	);
	const [picking, setPicking] = useState(
		(logMode?.kind === "new" && !templateBlock) || planMode?.kind === "new",
	);
	const [active, setActive] = useState<Active | null>(() =>
		templateBlock && fromPlannedSets ? { row: 0, col: 0 } : null,
	);
	const [error, setError] = useState<string | null>(null);
	const [focusExercise, setFocusExercise] = useState<string | null>(null);
	const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(
		null,
	);

	const targeted =
		templateBlock && !fromPlannedSets
			? templateBlock.exercises.map((e) => withChoices(e.exercise, e))
			: [];
	const prefill = useQueries({
		queries: targeted.map((e) => lastTime(e.id, e.chosen)),
	});
	const prefillDone = prefill.every((q) => !q.isPending);

	useEffect(() => {
		if (grid !== null || !templateBlock || !prefillDone) {
			return;
		}
		const next = initialGrid({
			exercises: templateBlock.exercises.map((e) => withChoices(e.exercise, e)),
			targets: templateBlock.exercises.map((e) => e.target),
			rounds: templateBlock.rounds,
			lastSets: prefill.map((q) => q.data?.items[0]?.sets),
			unit,
		});
		setGrid(next);
		setActive(
			next.rows.length > 0 ? { row: next.rows.length - 1, col: 0 } : null,
		);
	}, [grid, templateBlock, prefillDone, prefill, unit]);

	const exerciseIds = grid?.exercises.map((e) => e.id) ?? [];
	const lastPerformances = useQueries({
		queries: (grid?.exercises ?? []).map((e) => lastTime(e.id, e.chosen)),
	});

	const save = useMutation({
		mutationFn: async ({ body }: { body: BlockInput; columns: number[] }) =>
			saved
				? api.updateBlock(workoutId, saved.id, body)
				: api.createBlock(workoutId, body),
		onSuccess: async (block, { columns }) => {
			setSaved(block);
			setGrid((current) => current && linkToBlock(current, block));
			const pending = columns.flatMap((column, i) => {
				const text = drafts[column]?.trim();
				const target = block.exercises[i];
				return text && target ? [{ column, text, id: target.id }] : [];
			});
			const posted = await Promise.allSettled(
				pending.map((p) =>
					api.createComment({ blockExerciseId: p.id, text: p.text }),
				),
			);
			setDrafts((current) => {
				const next = { ...current };
				pending.forEach((p, i) => {
					if (posted[i]?.status === "fulfilled") {
						delete next[p.column];
					}
				});
				return next;
			});
			void queryClient.invalidateQueries({ queryKey: keys.workout(workoutId) });
			void queryClient.invalidateQueries({ queryKey: keys.workouts });
			void queryClient.invalidateQueries({ queryKey: ["performances"] });
			void queryClient.invalidateQueries({ queryKey: ["exercises"] });
			if (posted.every((p) => p.status === "fulfilled")) {
				onClose();
			} else {
				setError(t("errors.commentFailed"));
			}
		},
		onError: (err) => setError(errorMessage(err, { fallback: "saveFailed" })),
	});

	const savePlan = useMutation({
		mutationFn: (body: PlannedBlockInput) => {
			const sessionId = plan?.sessionId ?? "";
			return planMode?.kind === "edit"
				? api.updatePlannedBlock(sessionId, planMode.block.id, body)
				: api.createPlannedBlock(sessionId, body);
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: keys.plannedSession(plan?.sessionId ?? ""),
			});
			void queryClient.invalidateQueries({ queryKey: keys.plannedSessions });
			onClose();
		},
		onError: (err) => setError(errorMessage(err, { fallback: "saveFailed" })),
	});

	const remove = useMutation({
		mutationFn: () => {
			if (logMode?.kind === "edit") {
				return api.deleteBlock(workoutId, logMode.block.id);
			}
			if (plan && planMode?.kind === "edit") {
				return api.deletePlannedBlock(plan.sessionId, planMode.block.id);
			}
			return Promise.resolve();
		},
		onSuccess: () => {
			if (plan) {
				void queryClient.invalidateQueries({
					queryKey: keys.plannedSession(plan.sessionId),
				});
				void queryClient.invalidateQueries({ queryKey: keys.plannedSessions });
			} else {
				void queryClient.invalidateQueries({
					queryKey: keys.workout(workoutId),
				});
				void queryClient.invalidateQueries({ queryKey: ["performances"] });
			}
			onClose();
		},
		onError: (err) => setError(errorMessage(err, { fallback: "deleteFailed" })),
	});

	async function lastSetsIn(
		exerciseId: string,
		chosen: Choices,
	): Promise<WorkoutSet[] | undefined> {
		try {
			const page = await queryClient.fetchQuery(lastTime(exerciseId, chosen));
			return page.items[0]?.sets;
		} catch {
			return undefined;
		}
	}

	async function pick(exercise: ExerciseSummary) {
		setPicking(false);
		const added = withChoices(exercise);
		const lastSets = await lastSetsIn(added.id, added.chosen);
		setGrid((current) =>
			addExercise(
				current ?? { exercises: [], rows: [] },
				added,
				lastSets,
				unit,
			),
		);
		setFocusExercise(exercise.id);
	}

	async function applySwitch({ col, change }: PendingSwitch) {
		setPendingSwitch(null);
		const exercise = grid?.exercises[col];
		if (!exercise) {
			return;
		}
		const lastSets = await lastSetsIn(exercise.id, {
			...exercise.chosen,
			...change,
		});
		setGrid((current) =>
			current ? switchChoice(current, col, change, lastSets, unit) : current,
		);
	}

	function requestSwitch(pending: PendingSwitch) {
		if (grid && switchDiscards(grid, pending.col, pending.change)) {
			setPendingSwitch(pending);
		} else {
			void applySwitch(pending);
		}
	}

	useEffect(() => {
		if (!focusExercise || !grid) {
			return;
		}
		const col = grid.exercises.findIndex((e) => e.id === focusExercise);
		if (col >= 0) {
			setActive({ row: Math.max(0, grid.rows.length - 1), col });
			setFocusExercise(null);
		}
	}, [focusExercise, grid]);

	function submit() {
		if (!grid) {
			return;
		}
		const built = toBlockExercises(grid, unit);
		if (!built.ok) {
			setError(built.error);
			return;
		}
		setError(null);
		if (plan) {
			savePlan.mutate({
				exercises: built.exercises.map(({ id: _logged, ...exercise }, i) => {
					const column = grid.exercises[i]?.columnId;
					const note = column === undefined ? undefined : notes[column]?.trim();
					return note ? { ...exercise, note } : exercise;
				}),
			});
			return;
		}
		const body: BlockInput = { exercises: built.exercises };
		const templateBlockId =
			logMode?.kind === "edit"
				? logMode.block.templateBlockId
				: templateBlock?.id;
		const restSeconds =
			logMode?.kind === "edit"
				? logMode.block.restSeconds
				: templateBlock?.restSeconds;
		if (templateBlockId) {
			body.templateBlockId = templateBlockId;
		}
		if (restSeconds !== null && restSeconds !== undefined) {
			body.restSeconds = restSeconds;
		}
		save.mutate({ body, columns: grid.exercises.map((e) => e.columnId) });
	}

	/** The thread of a logged exercise, as fresh as the workout last fetched. */
	function commentsOf(blockExerciseId: string) {
		const blocks = [...(workout.data?.blocks ?? []), ...(saved ? [saved] : [])];
		for (const block of blocks) {
			const found = block.exercises.find((e) => e.id === blockExerciseId);
			if (found) {
				return found.comments;
			}
		}
		return [];
	}

	const libraryBlock = coach ? undefined : logMode?.templateBlock;
	const instructions = (libraryBlock?.exercises ?? []).flatMap((e, i) =>
		e.note
			? [
					{
						key: e.id,
						note: e.note,
						letter:
							(libraryBlock?.exercises.length ?? 0) > 1 ? letter(i) : null,
					},
				]
			: [],
	);
	const hasPlannedCells =
		grid?.rows.some((row) => row.cells.some((c) => c.planned)) ?? false;

	const title =
		logMode?.kind === "edit"
			? t("block.title", { position: logMode.block.position })
			: planMode?.kind === "edit"
				? t("block.title", { position: planMode.block.position })
				: t("block.newTitle");
	const activeExercise =
		active && grid ? grid.exercises[active.col] : undefined;
	const activeCell =
		active && grid ? grid.rows[active.row]?.cells[active.col] : undefined;
	const switching = pendingSwitch
		? grid?.exercises[pendingSwitch.col]
		: undefined;
	const pending = save.isPending || savePlan.isPending;
	const editing = logMode?.kind === "edit" || planMode?.kind === "edit";

	return (
		<Sheet title={title} onClose={onClose}>
			<div className="row">
				<h2 className="display sheet-title">{title}</h2>
				{grid && grid.exercises.length > 0 ? (
					<KindTag kind={kindOf(grid.exercises.length)} auto />
				) : null}
				<span className="grow" />
				{grid && !picking && grid.exercises.length < 10 ? (
					<button
						type="button"
						className="link-button"
						onClick={() => setPicking(true)}
					>
						{t("block.addExercise")}
					</button>
				) : null}
				<button
					type="button"
					className="icon-button"
					aria-label={t("common.close")}
					onClick={onClose}
				>
					✕
				</button>
			</div>

			<div className="sheet-body">
				{picking ? (
					<>
						<ExercisePicker
							onSelect={(e) => void pick(e)}
							excludeIds={exerciseIds}
							builtInOnly={plan !== null}
						/>
						{grid && grid.exercises.length > 0 ? (
							<button
								type="button"
								className="btn"
								onClick={() => setPicking(false)}
							>
								{t("block.backToBlock")}
							</button>
						) : null}
					</>
				) : grid === null ? (
					<p className="muted">{t("block.preparing")}</p>
				) : (
					<>
						{instructions.length > 0 ? (
							<div className="instructions">
								<span className="instructions-title">
									<InstructionIcon />
									{t("comments.instructions")}
								</span>
								{instructions.map((instruction) => (
									<span key={instruction.key} className="instruction">
										{instruction.letter ? (
											<span className="ex-letter">{instruction.letter}</span>
										) : null}
										<span>{instruction.note}</span>
									</span>
								))}
							</div>
						) : null}

						{plan ? (
							<AthleteLastTime
								athlete={plan.athlete.name}
								exercises={grid.exercises}
								performances={lastPerformances.map((q) => q.data?.items[0])}
								unit={unit}
							/>
						) : (
							<ul className="last-time">
								{grid.exercises.map((exercise, i) => {
									const last = lastPerformances[i]?.data?.items[0];
									if (!last) {
										return null;
									}
									const details = {
										date: formatShortDay(last.performedOn),
										summary: summarizeSets(
											exercise.chosen.mode,
											exercise.load,
											last.sets,
											unit,
										),
									};
									const how = choicesText(exercise, exercise.chosen);
									return (
										<li key={exercise.columnId} className="muted small">
											<b className="accent">{letter(i)}</b>{" "}
											{how
												? t("block.lastTimeIn", { ...details, how })
												: t("block.lastTime", details)}
										</li>
									);
								})}
							</ul>
						)}

						{hasPlannedCells ? (
							<p className="planned-legend">
								<i aria-hidden="true" />
								{coach
									? t("block.plannedBy", { name: coach.name })
									: t("block.plannedByCoach")}
							</p>
						) : null}

						{pendingSwitch && switching ? (
							<div className="switch-confirm">
								<p>
									{switchQuestion(
										switching.name,
										pendingSwitch.change,
										switching.chosen,
									)}
								</p>
								<div className="row">
									<button
										type="button"
										className="btn btn-small"
										onClick={() => setPendingSwitch(null)}
									>
										{t("common.cancel")}
									</button>
									<button
										type="button"
										className="btn btn-small btn-primary grow"
										onClick={() => void applySwitch(pendingSwitch)}
									>
										{t("block.switchMode")}
									</button>
								</div>
							</div>
						) : null}

						<div className="grid-scroll">
							<div
								className="set-grid"
								style={{
									gridTemplateColumns: `68px repeat(${grid.exercises.length}, minmax(76px, 1fr))`,
								}}
							>
								<div />
								{grid.exercises.map((exercise, col) => (
									<div key={exercise.columnId} className="grid-head">
										<b className="accent">{letter(col)}</b>
										<span className="truncate">{exercise.name}</span>
										<ChoiceSwitches
											exercise={exercise}
											chosen={exercise.chosen}
											onChange={(change) => requestSwitch({ col, change })}
										/>
										<button
											type="button"
											className="grid-head-remove"
											aria-label={t("block.removeExercise", {
												name: exercise.name,
											})}
											onClick={() => {
												setGrid(removeExercise(grid, col));
												setActive(null);
												setPendingSwitch(null);
											}}
										>
											✕
										</button>
									</div>
								))}
								{grid.rows.map((row, r) => (
									<RowView
										key={row.id}
										grid={grid}
										rowIndex={r}
										unit={unit}
										active={active}
										onSelect={(col) => setActive({ row: r, col })}
										onToggleWarmup={() => setGrid(toggleWarmup(grid, r))}
										warmup={row.warmup}
									/>
								))}
							</div>
						</div>

						<button
							type="button"
							className="btn btn-ghost btn-small"
							disabled={grid.exercises.length === 0}
							onClick={() => {
								const next = addRound(grid);
								setGrid(next);
								setActive({ row: next.rows.length - 1, col: active?.col ?? 0 });
							}}
						>
							{grid.rows.length > 0
								? t("block.addRoundCopy", { round: grid.rows.length })
								: t("block.addRound")}
						</button>

						{active && activeExercise && activeCell ? (
							<div className="stack-tight">
								<div className="active-round">
									<span>
										{t("block.round", { round: active.row + 1 })} ·{" "}
										<b>{letter(active.col)}</b> {activeExercise.name}
									</span>
									<button
										type="button"
										className="link-button danger"
										onClick={() => {
											setGrid(removeRound(grid, active.row));
											setActive(null);
										}}
									>
										{t("block.deleteRound", { round: active.row + 1 })}
									</button>
								</div>
								{fieldsFor(activeExercise).map((field) => (
									<Stepper
										key={field}
										label={`${letter(active.col)} · ${activeExercise.name} — ${fieldLabel(field, activeExercise.load)}`}
										visibleLabel={fieldLabel(field, activeExercise.load)}
										value={activeCell[field]}
										unit={fieldUnit(field, unit)}
										hint={t("block.stepHint", { step: stepText(field, unit) })}
										emptyText={
											field === "weight" && activeExercise.load === "optional"
												? t("units.bodyweightShort")
												: "—"
										}
										{...(field === "duration"
											? { format: formatClock, parse: parseDuration }
											: {})}
										onStep={(direction) =>
											setGrid(
												setCell(
													grid,
													active.row,
													active.col,
													field,
													stepValue(
														field,
														activeCell[field],
														direction,
														activeExercise.load,
													),
												),
											)
										}
										onChange={(value) =>
											setGrid(
												setCell(grid, active.row, active.col, field, value),
											)
										}
									/>
								))}
							</div>
						) : null}

						{grid.exercises.length > 0 && plan ? (
							<section
								className="stack-tight"
								aria-labelledby="block-notes-title"
							>
								<h3 id="block-notes-title" className="comments-title">
									{t("block.noteFor", { name: plan.athlete.name })}
								</h3>
								{grid.exercises.map((exercise, col) => (
									<span key={exercise.columnId} className="thread">
										<span className="thread-head">
											{grid.exercises.length > 1 ? (
												<span className="ex-letter">{letter(col)}</span>
											) : null}
											{t("block.noteVisible", { name: exercise.name })}
										</span>
										<textarea
											className="input compose-input"
											rows={1}
											maxLength={COMMENT_MAX_LENGTH}
											aria-label={t("block.noteOn", {
												name: exercise.name,
												athlete: plan.athlete.name,
											})}
											placeholder={t("block.notePlaceholder")}
											value={notes[exercise.columnId] ?? ""}
											onChange={(e) =>
												setNotes((current) => ({
													...current,
													[exercise.columnId]: e.target.value,
												}))
											}
										/>
									</span>
								))}
							</section>
						) : null}

						{grid.exercises.length > 0 && !plan ? (
							<section
								className="stack-tight"
								aria-labelledby="block-comments-title"
							>
								<h3 id="block-comments-title" className="comments-title">
									{t("comments.title")}
								</h3>
								{grid.exercises.map((exercise, col) => {
									const subject: ThreadSubject = {
										name: exercise.name,
										...(grid.exercises.length > 1
											? { letter: letter(col) }
											: {}),
									};
									const draft = {
										value: drafts[exercise.columnId] ?? "",
										onChange: (value: string) =>
											setDrafts((current) => ({
												...current,
												[exercise.columnId]: value,
											})),
									};
									const coachNote =
										coach && templateBlock
											? plannedExerciseOf(grid, col, templateBlock)?.note
											: null;
									return exercise.blockExerciseId ? (
										<CommentThread
											key={exercise.columnId}
											comments={commentsOf(exercise.blockExerciseId)}
											ownerId={meId}
											subject={subject}
											target={{
												workoutId,
												blockExerciseId: exercise.blockExerciseId,
												composer: "open",
												draft,
											}}
										/>
									) : (
										<FirstCommentDraft
											key={exercise.columnId}
											subject={subject}
											draft={draft}
											{...(coach && coachNote
												? { coachNote: { author: coach, text: coachNote } }
												: {})}
										/>
									);
								})}
							</section>
						) : null}
					</>
				)}
			</div>

			{error ? <ErrorText>{error}</ErrorText> : null}
			{!picking && grid ? (
				<div className="stack-tight">
					<button
						type="button"
						className="btn btn-primary"
						onClick={submit}
						disabled={pending}
					>
						{t("block.save")}
					</button>
					{editing ? (
						<ConfirmButton
							label={t("block.delete")}
							confirmLabel={t("common.confirmDelete")}
							onConfirm={() => remove.mutate()}
							disabled={remove.isPending}
						/>
					) : null}
				</div>
			) : null}
		</Sheet>
	);
}

/** The athlete's last time at each exercise of the block, set by set, as their coach sees it. */
function AthleteLastTime({
	athlete,
	exercises,
	performances,
	unit,
}: {
	athlete: string;
	exercises: Grid["exercises"];
	performances: (Performance | undefined)[];
	unit: WeightUnit;
}) {
	const { t } = useTranslation();
	return exercises.map((exercise, i) => {
		const last = performances[i];
		if (!last) {
			return null;
		}
		const how = choicesText(exercise, exercise.chosen);
		return (
			<div key={exercise.columnId} className="last-sets">
				<div className="last-sets-head">
					<span>
						{exercises.length > 1 ? (
							<b className="ex-letter">{letter(i)}</b>
						) : null}
						<b>{t("block.athleteLastTime", { name: athlete })}</b>
						{how ? ` ${how}` : ""}
					</span>
					<span>{formatShortDay(last.performedOn)}</span>
				</div>
				<div className="last-sets-list">
					{last.sets.map((set) => (
						<span
							key={`${set.round}-${set.warmup}`}
							className={set.warmup ? "warmup" : undefined}
						>
							{[
								setText(exercise.chosen.mode, exercise.load, set, unit),
								set.warmup ? t("block.warmupShort") : null,
							]
								.filter(Boolean)
								.join(" · ")}
						</span>
					))}
				</div>
			</div>
		);
	});
}

function RowView({
	grid,
	rowIndex,
	unit,
	active,
	warmup,
	onSelect,
	onToggleWarmup,
}: {
	grid: Grid;
	rowIndex: number;
	unit: WeightUnit;
	active: Active | null;
	warmup: boolean;
	onSelect: (col: number) => void;
	onToggleWarmup: () => void;
}) {
	const { t } = useTranslation();
	const row = grid.rows[rowIndex];
	if (!row) {
		return null;
	}
	const isActiveRow = active?.row === rowIndex;
	return (
		<>
			<div className={isActiveRow ? "grid-round on" : "grid-round"}>
				<span>{t("block.round", { round: rowIndex + 1 })}</span>
				<button
					type="button"
					className={warmup ? "warmup-toggle on" : "warmup-toggle"}
					aria-pressed={warmup}
					aria-label={t("block.warmupLabel", { round: rowIndex + 1 })}
					title={t("block.warmupTitle")}
					onClick={onToggleWarmup}
				>
					{t("block.warmupShort")}
				</button>
			</div>
			{grid.exercises.map((exercise, col) => {
				const cell = row.cells[col];
				const key = exercise.columnId;
				if (!cell) {
					return <div key={key} />;
				}
				const text = cellText(exercise.chosen.mode, exercise.load, cell, unit);
				const isActive = isActiveRow && active?.col === col;
				return (
					<button
						key={key}
						type="button"
						className={[
							"cell",
							isActive ? "active" : "",
							warmup ? "warmup" : "",
							text.empty ? "empty" : "",
							cell.planned ? "planned" : "",
						].join(" ")}
						aria-label={t("block.cellLabel", {
							round: rowIndex + 1,
							letter: letter(col),
							name: exercise.name,
							value: text.empty
								? t("block.toFillLower")
								: `${text.main}${text.sub ? ` ${text.sub}` : ""}`,
						})}
						aria-pressed={isActive}
						onClick={() => onSelect(col)}
					>
						{text.empty ? (
							<span className="cell-empty">{t("block.toFill")}</span>
						) : (
							<>
								<b className={text.main.endsWith("?") ? "missing" : ""}>
									{text.main}
								</b>
								<span
									className={
										text.sub.endsWith("?") ? "cell-sub missing" : "cell-sub"
									}
								>
									{text.sub || " "}
								</span>
							</>
						)}
					</button>
				);
			})}
		</>
	);
}
