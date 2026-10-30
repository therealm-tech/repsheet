import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { KindTag } from "@/components/ui";
import { previousPerformanceQuery } from "@/lib/api/endpoints";
import type {
	Block,
	ExerciseSummary,
	Mode,
	TemplateBlock,
	WeightUnit,
	WorkoutSet,
} from "@/lib/api/schemas";
import { letter, maxWorkingWeight, summarizeSets } from "@/lib/blocks";
import { formatShortDay } from "@/lib/dates";
import { formatNumber, kgToUnit } from "@/lib/units";

/** "+2,5 kg vs 14 oct." against the last time this exercise was done before this workout. */
function Progress({
	exercise,
	mode,
	sets,
	workoutId,
	unit,
}: {
	exercise: ExerciseSummary;
	mode: Mode;
	sets: WorkoutSet[];
	workoutId: string;
	unit: WeightUnit;
}) {
	const { t } = useTranslation();
	const current = maxWorkingWeight(sets);
	const performances = useQuery({
		...previousPerformanceQuery(exercise.id, workoutId, mode),
		enabled:
			mode === "reps" && exercise.load === "required" && current !== null,
	});
	const previous = performances.data?.items[0];
	const before = previous ? maxWorkingWeight(previous.sets) : null;
	if (current === null || before === null || !previous) {
		return null;
	}
	const delta = kgToUnit(current, unit) - kgToUnit(before, unit);
	if (delta === 0) {
		return (
			<div className="small muted">
				= {formatShortDay(previous.performedOn)}
			</div>
		);
	}
	return (
		<div className={delta > 0 ? "small up" : "small down"}>
			{delta > 0 ? "↑ +" : "↓ "}
			{t("block.versus", {
				delta: `${formatNumber(delta)} ${unit}`,
				date: formatShortDay(previous.performedOn),
			})}
		</div>
	);
}

export function BlockCard({
	block,
	workoutId,
	unit,
	onOpen,
}: {
	block: Block;
	workoutId: string;
	unit: WeightUnit;
	onOpen: () => void;
}) {
	const { t } = useTranslation();
	return (
		<button
			type="button"
			className="block"
			onClick={onOpen}
			aria-label={t("block.title", { position: block.position })}
		>
			<span className="block-head">
				<b>{block.position}</b>
				<KindTag kind={block.kind} />
				<span className="grow" />
				<span className="tag tag-ok">
					<span aria-hidden="true">✓</span>
					<span className="sr-only">{t("block.done")}</span>
				</span>
			</span>
			{block.exercises.map((entry, i) => (
				<span key={entry.exercise.id} className="block-exercise">
					<span className="ex">
						<span className="ex-letter">{letter(i)}</span>
						<span className="ex-name">{entry.exercise.name}</span>
						<span className="ex-value">
							{summarizeSets(entry.mode, entry.exercise.load, entry.sets, unit)}
						</span>
					</span>
					{block.exercises.length === 1 ? (
						<Progress
							exercise={entry.exercise}
							mode={entry.mode}
							sets={entry.sets}
							workoutId={workoutId}
							unit={unit}
						/>
					) : null}
				</span>
			))}
		</button>
	);
}

export function PlannedBlockCard({
	block,
	index,
	onOpen,
}: {
	block: TemplateBlock;
	index: number;
	onOpen: () => void;
}) {
	const { t } = useTranslation();
	return (
		<button
			type="button"
			className="block planned"
			onClick={onOpen}
			aria-label={t("block.plannedLabel", { position: index })}
		>
			<span className="block-head">
				<b>{index}</b>
				<KindTag kind={block.kind} />
				<span className="grow" />
				<span className="muted small">{t("block.planned")}</span>
			</span>
			{block.exercises.map((entry, i) => (
				<span key={entry.exercise.id} className="ex muted">
					<span className="ex-letter">{letter(i)}</span>
					<span className="ex-name">{entry.exercise.name}</span>
					<span className="ex-value">
						{[
							block.rounds && i === 0
								? t("block.rounds", { count: block.rounds })
								: null,
							entry.target,
						]
							.filter(Boolean)
							.join(" · ")}
					</span>
				</span>
			))}
			<span className="small accent">{t("block.tapToLog")}</span>
		</button>
	);
}
