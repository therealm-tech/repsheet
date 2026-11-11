import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CommentThread } from "@/components/CommentThread";
import { KindTag } from "@/components/ui";
import i18n from "@/i18n";
import { previousPerformanceQuery } from "@/lib/api/endpoints";
import type {
	Author,
	Block,
	ExerciseSummary,
	TemplateBlock,
	WeightUnit,
	WorkoutSet,
} from "@/lib/api/schemas";
import {
	letter,
	maxWorkingWeight,
	summarizeSets,
	unusualChoices,
} from "@/lib/blocks";
import type { Choices } from "@/lib/choices";
import { formatShortDay } from "@/lib/dates";
import { useUnit } from "@/lib/hooks";
import { formatNumber, kgToUnit } from "@/lib/units";

/** The exercise's name, over the equipment and grip chosen where they depart from its defaults. */
export function ExerciseName({
	exercise,
	chosen,
}: {
	exercise: ExerciseSummary;
	chosen: Choices;
}) {
	const unusual = unusualChoices(exercise, chosen);
	return (
		<span className="ex-name">
			{exercise.name}
			{unusual ? <span className="ex-choices">{unusual}</span> : null}
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
 * A logged block, with the comments on its exercises. Without `onOpen` it is
 * read-only, as a coach sees it: no comparison with "last time", which would
 * be the reader's history, and a way to comment instead.
 */
export function BlockCard({
	block,
	workoutId,
	ownerId,
	unit,
	onOpen,
}: {
	block: Block;
	workoutId: string;
	/** The athlete who logged the workout, told apart from their coaches. */
	ownerId: string;
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
			{block.exercises.map((entry, i) => (
				<CommentThread
					key={entry.id}
					comments={entry.comments}
					ownerId={ownerId}
					subject={{
						name: entry.exercise.name,
						...(block.exercises.length > 1 ? { letter: letter(i) } : {}),
					}}
					{...(onOpen
						? {}
						: {
								target: {
									workoutId,
									blockExerciseId: entry.id,
									composer: "collapsed",
								},
							})}
				/>
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

/** What a planned exercise asks: its sets summarised like logged ones, or the coach's target. */
export function plannedSummary(
	block: TemplateBlock,
	index: number,
	unit: WeightUnit,
): string {
	const entry = block.exercises[index];
	if (!entry) {
		return "";
	}
	if (entry.sets.length > 0) {
		return summarizeSets(entry.mode, entry.exercise.load, entry.sets, unit);
	}
	return [
		block.rounds && index === 0
			? i18n.t("block.rounds", { count: block.rounds })
			: null,
		entry.target,
	]
		.filter(Boolean)
		.join(" · ");
}

/**
 * A block planned and not logged yet. Without `onOpen` it is read-only. The
 * notes of a session a coach planned show as theirs, those of one of the
 * user's templates as instructions.
 */
export function PlannedBlockCard({
	block,
	index,
	onOpen,
	status,
	coach,
}: {
	block: TemplateBlock;
	index: number;
	onOpen?: () => void;
	/** What the corner says; "planned" by default. */
	status?: string;
	coach?: Author | null;
}) {
	const { t } = useTranslation();
	const unit = useUnit();
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
				<span key={entry.id} className="block-exercise">
					<span className="ex muted">
						<span className="ex-letter">{letter(i)}</span>
						<ExerciseName exercise={entry.exercise} chosen={entry} />
						<span
							className={
								entry.sets.length > 0 ? "ex-value planned-value" : "ex-value"
							}
						>
							{plannedSummary(block, i, unit)}
						</span>
					</span>
					{entry.note && coach ? (
						<span className="plan-note">
							<span className="avatar avatar-coach" aria-hidden="true">
								{coach.name.charAt(0).toUpperCase()}
							</span>
							<span className="sr-only">
								{coach.name} · {t("comments.coach")} :
							</span>
							« {entry.note} »
						</span>
					) : entry.note ? (
						<span className="instruction-planned">
							<InstructionIcon />
							<span className="sr-only">{t("comments.instructions")}</span>
							{entry.note}
						</span>
					) : null}
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

/** A clipboard, marking the instructions written in the plan. */
export function InstructionIcon() {
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className="accent"
		>
			<path d="M9 4h6v3H9z" />
			<path d="M15 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
		</svg>
	);
}
