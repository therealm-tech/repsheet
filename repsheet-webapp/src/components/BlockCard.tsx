import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { KindTag } from "@/components/ui";
import { previousPerformanceQuery } from "@/lib/api/endpoints";
import type {
	Block,
	ExerciseSummary,
	TemplateBlock,
	WeightUnit,
	WorkoutSet,
} from "@/lib/api/schemas";
import {
	choiceTags,
	letter,
	maxWorkingWeight,
	summarizeSets,
} from "@/lib/blocks";
import type { Choices } from "@/lib/choices";
import { formatShortDay } from "@/lib/dates";
import { formatNumber, kgToUnit } from "@/lib/units";

/** The exercise's name, followed by the equipment and grip chosen where it offers a choice. */
function ExerciseName({
	exercise,
	chosen,
}: {
	exercise: ExerciseSummary;
	chosen: Choices;
}) {
	return (
		<span className="ex-name">
			{exercise.name}
			{choiceTags(exercise, chosen).map((tag) => (
				<span key={tag} className="muted">
					{" "}
					· {tag}
				</span>
			))}
		</span>
	);
}

/** "+2,5 kg vs 14 oct." against the last time this exercise was done the same way before this workout. */
function Progress({
	exercise,
	chosen,
	sets,
	workoutId,
	unit,
}: {
	exercise: ExerciseSummary;
	chosen: Choices;
	sets: WorkoutSet[];
	workoutId: string;
	unit: WeightUnit;
}) {
	const { t } = useTranslation();
	const current = maxWorkingWeight(sets);
	const performances = useQuery({
		...previousPerformanceQuery(exercise.id, workoutId, chosen),
		enabled:
			chosen.mode === "reps" &&
			exercise.load === "required" &&
			current !== null,
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

/**
 * A logged block. Without `onOpen` it is read-only, as a coach sees it: no
 * comparison with "last time", which would be the reader's history.
 */
export function BlockCard({
	block,
	workoutId,
	unit,
	onOpen,
}: {
	block: Block;
	workoutId: string;
	unit: WeightUnit;
	onOpen?: () => void;
}) {
	const { t } = useTranslation();
	const label = t("block.title", { position: block.position });
	const content = (
		<>
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
				<span key={entry.id} className="block-exercise">
					<span className="ex">
						<span className="ex-letter">{letter(i)}</span>
						<ExerciseName exercise={entry.exercise} chosen={entry} />
						<span className="ex-value">
							{summarizeSets(entry.mode, entry.exercise.load, entry.sets, unit)}
						</span>
					</span>
					{onOpen && block.exercises.length === 1 ? (
						<Progress
							exercise={entry.exercise}
							chosen={entry}
							sets={entry.sets}
							workoutId={workoutId}
							unit={unit}
						/>
					) : null}
				</span>
			))}
		</>
	);
	return onOpen ? (
		<button type="button" className="block" onClick={onOpen} aria-label={label}>
			{content}
		</button>
	) : (
		<section className="block" aria-label={label}>
			{content}
		</section>
	);
}

/** A block planned and not logged yet. Without `onOpen` it is read-only. */
export function PlannedBlockCard({
	block,
	index,
	onOpen,
	status,
}: {
	block: TemplateBlock;
	index: number;
	onOpen?: () => void;
	/** What the corner says; "planned" by default. */
	status?: string;
}) {
	const { t } = useTranslation();
	const label = t("block.plannedLabel", { position: index });
	const content = (
		<>
			<span className="block-head">
				<b>{index}</b>
				<KindTag kind={block.kind} />
				<span className="grow" />
				<span className="muted small">{status ?? t("block.planned")}</span>
			</span>
			{block.exercises.map((entry, i) => (
				<span key={entry.id} className="ex muted">
					<span className="ex-letter">{letter(i)}</span>
					<ExerciseName exercise={entry.exercise} chosen={entry} />
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
			{onOpen ? (
				<span className="small accent">{t("block.tapToLog")}</span>
			) : null}
		</>
	);
	return onOpen ? (
		<button
			type="button"
			className="block planned"
			onClick={onOpen}
			aria-label={label}
		>
			{content}
		</button>
	) : (
		<section className="block planned" aria-label={label}>
			{content}
		</section>
	);
}
