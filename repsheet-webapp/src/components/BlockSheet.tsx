import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExercisePicker } from "@/components/ExercisePicker";
import { Stepper } from "@/components/Stepper";
import {
	ConfirmButton,
	ErrorText,
	KindTag,
	ModeSwitch,
	Sheet,
} from "@/components/ui";
import i18n from "@/i18n";
import { api, keys, previousPerformanceQuery } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/errors";
import type {
	Block,
	BlockInput,
	ExerciseSummary,
	Load,
	Mode,
	TemplateBlock,
	WeightUnit,
	WorkoutSet,
} from "@/lib/api/schemas";
import { kindOf, letter, modeInLower, summarizeSets } from "@/lib/blocks";
import { formatShortDay } from "@/lib/dates";
import {
	addExercise,
	addRound,
	type Cell,
	type Field,
	fieldsFor,
	type Grid,
	gridFromBlock,
	initialGrid,
	primaryField,
	removeExercise,
	removeRound,
	setCell,
	stepFor,
	stepValue,
	switchDiscards,
	switchMode,
	toBlockExercises,
	toggleWarmup,
	weightRequired,
	withMode,
} from "@/lib/grid";
import { useUnit } from "@/lib/hooks";
import {
	formatClock,
	formatDistance,
	formatDuration,
	formatNumber,
	parseDuration,
} from "@/lib/units";

export type BlockSheetMode =
	| { kind: "new"; templateBlock?: TemplateBlock }
	| { kind: "edit"; block: Block };

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
	mode: Mode;
}

export function BlockSheet({
	workoutId,
	mode,
	onClose,
}: {
	workoutId: string;
	mode: BlockSheetMode;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const unit = useUnit();
	const queryClient = useQueryClient();
	const templateBlock = mode.kind === "new" ? mode.templateBlock : undefined;
	const [grid, setGrid] = useState<Grid | null>(() => {
		if (mode.kind === "edit") {
			return gridFromBlock(mode.block, unit);
		}
		return templateBlock ? null : { exercises: [], rows: [] };
	});
	const [picking, setPicking] = useState(mode.kind === "new" && !templateBlock);
	const [active, setActive] = useState<Active | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [focusExercise, setFocusExercise] = useState<string | null>(null);
	const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(
		null,
	);

	const planned =
		templateBlock?.exercises.map((e) => withMode(e.exercise, e.mode)) ?? [];
	const prefill = useQueries({
		queries: planned.map((e) =>
			previousPerformanceQuery(e.id, workoutId, e.mode),
		),
	});
	const prefillDone = prefill.every((q) => !q.isPending);

	useEffect(() => {
		if (grid !== null || !templateBlock || !prefillDone) {
			return;
		}
		const next = initialGrid({
			exercises: templateBlock.exercises.map((e) =>
				withMode(e.exercise, e.mode),
			),
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
		queries: (grid?.exercises ?? []).map((e) =>
			previousPerformanceQuery(e.id, workoutId, e.mode),
		),
	});

	const save = useMutation({
		mutationFn: (body: BlockInput) =>
			mode.kind === "edit"
				? api.updateBlock(workoutId, mode.block.id, body)
				: api.createBlock(workoutId, body),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: keys.workout(workoutId) });
			void queryClient.invalidateQueries({ queryKey: keys.workouts });
			void queryClient.invalidateQueries({ queryKey: ["performances"] });
			void queryClient.invalidateQueries({ queryKey: ["exercises"] });
			onClose();
		},
		onError: (err) => setError(errorMessage(err, { fallback: "saveFailed" })),
	});

	const remove = useMutation({
		mutationFn: () =>
			mode.kind === "edit"
				? api.deleteBlock(workoutId, mode.block.id)
				: Promise.resolve(),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: keys.workout(workoutId) });
			void queryClient.invalidateQueries({ queryKey: ["performances"] });
			onClose();
		},
		onError: (err) => setError(errorMessage(err, { fallback: "deleteFailed" })),
	});

	async function lastSetsIn(
		exerciseId: string,
		mode: Mode,
	): Promise<WorkoutSet[] | undefined> {
		try {
			const page = await queryClient.fetchQuery(
				previousPerformanceQuery(exerciseId, workoutId, mode),
			);
			return page.items[0]?.sets;
		} catch {
			return undefined;
		}
	}

	async function pick(exercise: ExerciseSummary) {
		setPicking(false);
		const lastSets = await lastSetsIn(exercise.id, exercise.defaultMode);
		setGrid((current) =>
			addExercise(
				current ?? { exercises: [], rows: [] },
				withMode(exercise),
				lastSets,
				unit,
			),
		);
		setFocusExercise(exercise.id);
	}

	async function applySwitch({ col, mode }: PendingSwitch) {
		setPendingSwitch(null);
		const exercise = grid?.exercises[col];
		if (!exercise) {
			return;
		}
		const lastSets = await lastSetsIn(exercise.id, mode);
		setGrid((current) =>
			current ? switchMode(current, col, mode, lastSets, unit) : current,
		);
	}

	function requestSwitch(change: PendingSwitch) {
		if (grid && switchDiscards(grid, change.col)) {
			setPendingSwitch(change);
		} else {
			void applySwitch(change);
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
		const body: BlockInput = { exercises: built.exercises };
		const templateBlockId =
			mode.kind === "edit" ? mode.block.templateBlockId : templateBlock?.id;
		const restSeconds =
			mode.kind === "edit"
				? mode.block.restSeconds
				: templateBlock?.restSeconds;
		if (templateBlockId) {
			body.templateBlockId = templateBlockId;
		}
		if (restSeconds !== null && restSeconds !== undefined) {
			body.restSeconds = restSeconds;
		}
		save.mutate(body);
	}

	const title =
		mode.kind === "edit"
			? t("block.title", { position: mode.block.position })
			: t("block.newTitle");
	const activeExercise =
		active && grid ? grid.exercises[active.col] : undefined;
	const activeCell =
		active && grid ? grid.rows[active.row]?.cells[active.col] : undefined;
	const switching = pendingSwitch
		? grid?.exercises[pendingSwitch.col]
		: undefined;

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
						<ul className="last-time">
							{grid.exercises.map((exercise, i) => {
								const last = lastPerformances[i]?.data?.items[0];
								if (!last) {
									return null;
								}
								const details = {
									date: formatShortDay(last.performedOn),
									summary: summarizeSets(
										exercise.mode,
										exercise.load,
										last.sets,
										unit,
									),
								};
								return (
									<li key={exercise.id} className="muted small">
										<b className="accent">{letter(i)}</b>{" "}
										{exercise.modes.length > 1
											? t("block.lastTimeIn", {
													...details,
													mode: modeInLower(exercise.mode),
												})
											: t("block.lastTime", details)}
									</li>
								);
							})}
						</ul>

						{pendingSwitch && switching ? (
							<div className="switch-confirm">
								<p>
									{t("block.switchConfirm", {
										name: switching.name,
										mode: modeInLower(pendingSwitch.mode),
										previous: modeInLower(switching.mode),
									})}
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
									<div key={exercise.id} className="grid-head">
										<b className="accent">{letter(col)}</b>
										<span className="truncate">{exercise.name}</span>
										{exercise.modes.length > 1 ? (
											<ModeSwitch
												modes={exercise.modes}
												value={exercise.mode}
												label={t("block.modeOf", { name: exercise.name })}
												onChange={(mode) => requestSwitch({ col, mode })}
											/>
										) : null}
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
						disabled={save.isPending}
					>
						{t("block.save")}
					</button>
					{mode.kind === "edit" ? (
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
				if (!cell) {
					return <div key={exercise.id} />;
				}
				const text = cellText(exercise.mode, exercise.load, cell, unit);
				const isActive = isActiveRow && active?.col === col;
				return (
					<button
						key={exercise.id}
						type="button"
						className={[
							"cell",
							isActive ? "active" : "",
							warmup ? "warmup" : "",
							text.empty ? "empty" : "",
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
								<span className={text.sub.endsWith("?") ? "missing" : ""}>
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
