import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CommentThread } from "@/components/CommentThread";
import { ExerciseActions } from "@/components/ExerciseActions";
import { ExerciseLabelsEditor } from "@/components/ExerciseLabels";
import { LineChart } from "@/components/LineChart";
import { Empty, ErrorText, KindTag, Segmented } from "@/components/ui";
import i18n from "@/i18n";
import { api, keys } from "@/lib/api/endpoints";
import type {
	Equipment,
	GripFilter,
	Load,
	Mode,
	WeightUnit,
	WorkoutSet,
} from "@/lib/api/schemas";
import {
	describeExercise,
	equipmentLabel,
	gripLabel,
	gripTag,
	modeIn,
	modeInLower,
} from "@/lib/blocks";
import { gripFilter } from "@/lib/choices";
import { formatDay } from "@/lib/dates";
import { useMe, useUnit } from "@/lib/hooks";
import {
	bestSet,
	bestVolume,
	type Metric,
	metricFor,
	progression,
} from "@/lib/stats";
import {
	formatDistance,
	formatDuration,
	formatNumber,
	formatWeight,
	kgToUnit,
} from "@/lib/units";

const HISTORY_SIZE = 100;

function formatMetric(metric: Metric, value: number, unit: WeightUnit): string {
	switch (metric) {
		case "load":
			return formatWeight(value, unit);
		case "reps":
			return i18n.t("cell.reps", { count: value });
		case "time":
			return formatDuration(value);
		case "distance":
			return formatDistance(value);
	}
}

function formatDelta(metric: Metric, delta: number, unit: WeightUnit): string {
	const sign = delta > 0 ? "+" : "−";
	switch (metric) {
		case "load":
			return `${sign}${formatWeight(Math.abs(delta), unit)}`;
		case "reps":
			return `${sign}${formatNumber(Math.abs(delta))}`;
		case "time":
			return `${sign}${formatDuration(Math.abs(delta))}`;
		case "distance":
			return `${sign}${formatDistance(Math.abs(delta))}`;
	}
}

/** One set as the history lists it: "60×8", "12 (+10)", "1 min", "500 m (24 kg)". */
function formatSet(
	mode: Mode,
	load: Load,
	set: WorkoutSet,
	unit: WeightUnit,
): string {
	const weight = set.weightKg === null ? null : kgToUnit(set.weightKg, unit);
	const signed =
		weight === null
			? ""
			: `${weight > 0 && load === "optional" ? "+" : ""}${formatNumber(weight)}`;
	switch (mode) {
		case "reps":
			if (load === "required") {
				return `${signed || "?"}×${set.reps ?? "?"}`;
			}
			return signed
				? `${set.reps ?? "?"} (${signed})`
				: String(set.reps ?? "?");
		case "time":
		case "distance": {
			const main =
				mode === "time"
					? formatDuration(set.durationSeconds ?? 0)
					: formatDistance(set.distanceMeters ?? 0);
			return signed ? `${main} (${signed} ${unit})` : main;
		}
	}
}

/** A record spells out bare reps ("25 reps"), which a history line leaves implicit. */
function formatRecord(
	mode: Mode,
	load: Load,
	set: WorkoutSet,
	unit: WeightUnit,
): string {
	return mode === "reps" && set.weightKg === null
		? i18n.t("cell.reps", { count: set.reps ?? 0 })
		: formatSet(mode, load, set, unit);
}

/**
 * The value the page shows first: the one picked, else the latest
 * performance's while the exercise still offers it, else the default one.
 */
function shownFirst<T>(
	picked: T | null,
	latest: T | undefined,
	options: readonly T[],
	fallback: T,
): T {
	if (picked !== null) {
		return picked;
	}
	return latest !== undefined && options.includes(latest) ? latest : fallback;
}

export function ExerciseDetailPage({ exerciseId }: { exerciseId: string }) {
	const { t } = useTranslation();
	const unit = useUnit();
	const meId = useMe().data?.id ?? "";
	const exercise = useQuery({
		queryKey: keys.exercise(exerciseId),
		queryFn: () => api.exercise(exerciseId),
	});
	const performances = useQuery({
		queryKey: keys.performances(exerciseId, HISTORY_SIZE),
		queryFn: () => api.performances(exerciseId, { perPage: HISTORY_SIZE }),
	});
	const [chosenMode, setChosenMode] = useState<Mode | null>(null);
	const [chosenEquipment, setChosenEquipment] = useState<Equipment | null>(
		null,
	);
	const [chosenGrip, setChosenGrip] = useState<GripFilter | null>(null);

	if (exercise.isError) {
		return (
			<main className="screen">
				<ErrorText>{t("exercise.notFound")}</ErrorText>
				<Link to="/exercises">{t("exercise.back")}</Link>
			</main>
		);
	}

	const ex = exercise.data;
	const items = performances.data?.items ?? [];
	const load = ex?.load ?? "required";
	const modes = ex?.modes ?? [];
	const latest = items[0];
	const mode = shownFirst(
		chosenMode,
		latest?.mode,
		modes,
		ex?.defaultMode ?? "reps",
	);
	const equipmentOptions = ex?.equipment ?? [];
	const equipment = shownFirst(
		chosenEquipment,
		latest?.equipment,
		equipmentOptions,
		ex?.defaultEquipment ?? "other",
	);
	// The history logged with no grip forms a series of its own.
	const gripOptions: GripFilter[] = [
		...(ex?.grips ?? []),
		...(items.some((p) => p.grip === null) ? ["none" as const] : []),
	];
	const grip = shownFirst(
		chosenGrip,
		latest ? gripFilter(latest.grip) : undefined,
		gripOptions,
		gripFilter(ex?.defaultGrip ?? null),
	);
	// Loads lifted with different equipment or another grip are not
	// comparable: progress, records and volume only ever look at one of each.
	const comparable = items.filter(
		(p) => p.equipment === equipment && gripFilter(p.grip) === grip,
	);
	const inMode = comparable.filter((p) => p.mode === mode);
	const metric = metricFor(mode, load);
	const points = progression(metric, inMode);
	const last = points[points.length - 1];
	const first = points[0];
	const records = [mode, ...modes.filter((m) => m !== mode)].flatMap((m) => {
		const set = bestSet(
			metricFor(m, load),
			comparable.filter((p) => p.mode === m),
		);
		return set ? [{ mode: m, set }] : [];
	});
	const volume = metric === "load" ? bestVolume(inMode) : null;
	const metricFormat = (v: number) => formatMetric(metric, v, unit);
	const multiMode = modes.length > 1;
	const multiEquipment = equipmentOptions.length > 1;
	const multiGrip = gripOptions.length > 1;

	return (
		<main className="screen">
			<header className="bar">
				<Link
					to="/exercises"
					className="icon-button"
					aria-label={t("exercise.back")}
				>
					‹
				</Link>
				<h1 className="display page-title center grow">{ex?.name ?? "…"}</h1>
				<span className="icon-spacer" />
			</header>
			<div className="two-col">
				<div className="col-side">
					{ex ? (
						<p className="muted small">{describeExercise(ex).join(" · ")}</p>
					) : null}
					{ex ? <ExerciseLabelsEditor key={ex.id} exercise={ex} /> : null}
					{ex ? <ExerciseActions key={ex.id} exercise={ex} /> : null}

					{multiMode ? (
						<Segmented
							label={t("exercise.modeShown")}
							value={mode}
							onChange={setChosenMode}
							options={modes.map((m) => ({ value: m, label: modeIn(m) }))}
						/>
					) : null}

					{multiEquipment ? (
						<Segmented
							label={t("exercise.equipmentShown")}
							value={equipment}
							onChange={setChosenEquipment}
							options={equipmentOptions.map((e) => ({
								value: e,
								label: equipmentLabel(e),
							}))}
						/>
					) : null}

					{multiGrip ? (
						<Segmented
							label={t("exercise.gripShown")}
							value={grip}
							onChange={setChosenGrip}
							options={gripOptions.map((g) => ({
								value: g,
								label: g === "none" ? t("exercise.gripUnknown") : gripLabel(g),
							}))}
						/>
					) : null}

					{performances.isSuccess && items.length === 0 ? (
						<Empty>{t("exercise.noSets")}</Empty>
					) : null}

					{last && first ? (
						<section
							className="card chart-card"
							aria-label={t(`metrics.${metric}`)}
						>
							<div className="row">
								<span className="muted small">{t(`metrics.${metric}`)}</span>
							</div>
							<div className="row">
								<b className="display big-number">{metricFormat(last.value)}</b>
								<span className="grow" />
								{points.length > 1 && last.value !== first.value ? (
									<span
										className={
											last.value > first.value ? "small up" : "small down"
										}
									>
										{t("exercise.sinceStart", {
											delta: formatDelta(
												metric,
												last.value - first.value,
												unit,
											),
										})}
									</span>
								) : null}
							</div>
							<LineChart points={points} format={metricFormat} />
						</section>
					) : null}

					{records.length > 0 ? (
						<div className="row stats">
							{records.map((record) => (
								<div key={record.mode} className="card stat">
									<span className="muted small">
										{multiMode
											? t("exercise.recordIn", {
													mode: modeInLower(record.mode),
												})
											: t("exercise.record")}
									</span>
									<b>{formatRecord(record.mode, load, record.set, unit)}</b>
								</div>
							))}
							{volume !== null ? (
								<div className="card stat">
									<span className="muted small">
										{t("exercise.bestVolume")}
									</span>
									<b>{formatWeight(volume, unit)}</b>
								</div>
							) : null}
						</div>
					) : null}
				</div>
				{items.length > 0 ? (
					<section
						className="stack-tight col-main"
						aria-labelledby="history-title"
					>
						<h2 id="history-title" className="display section-title">
							{t("nav.history")}
						</h2>
						<ul className="card list">
							{items.map((p) => {
								const otherMode = p.mode !== mode;
								const otherEquipment = p.equipment !== equipment;
								const otherGrip = gripFilter(p.grip) !== grip;
								const other = otherMode || otherEquipment || otherGrip;
								return (
									<li key={p.blockExerciseId}>
										<Link
											to="/workouts/$workoutId"
											params={{ workoutId: p.workoutId }}
											className={other ? "list-item other-mode" : "list-item"}
										>
											<span className="grow">
												<span className="row-tight">
													<span className="strong">
														{formatDay(p.performedOn)}
													</span>
													<KindTag kind={p.blockKind} />
													{otherMode ? (
														<span className="tag">{modeIn(p.mode)}</span>
													) : null}
													{otherEquipment ? (
														<span className="tag">
															{equipmentLabel(p.equipment)}
														</span>
													) : null}
													{otherGrip ? (
														<span className="tag">{gripTag(p.grip)}</span>
													) : null}
												</span>
												<span className="muted small line-block">
													{p.sets.map((s, i) => (
														<span
															key={`round-${s.round}`}
															className={s.warmup ? "warmup-set" : undefined}
														>
															{i > 0 ? " · " : ""}
															{s.warmup ? `${t("exercise.warmupShort")} ` : ""}
															{formatSet(p.mode, load, s, unit)}
														</span>
													))}
													{p.mode === "reps" && load !== "required"
														? ` ${t("units.reps")}`
														: ""}
												</span>
												<CommentThread
													comments={p.comments}
													ownerId={meId}
													subject={{ name: ex?.name ?? "" }}
												/>
											</span>
										</Link>
									</li>
								);
							})}
						</ul>
					</section>
				) : null}
			</div>
		</main>
	);
}
