import { useTranslation } from "react-i18next";
import { BlockCard, PlannedBlockCard } from "@/components/BlockCard";
import type { Athlete, TemplateBlock, Workout } from "@/lib/api/schemas";
import { useUnit } from "@/lib/hooks";

/**
 * A workout as a coach reads it: logged blocks with their sets and the
 * comments on their exercises, which the coach joins, then the planned blocks
 * that were not logged, then the athlete's note.
 */
export function WorkoutReadOnly({
	workout,
	athleteId,
	plannedBlocks = [],
	managedAthlete,
}: {
	workout: Workout;
	athleteId: string;
	plannedBlocks?: TemplateBlock[];
	/** Set for a profile the caller manages: their unit, and no comments. */
	managedAthlete?: Athlete | undefined;
}) {
	const { t } = useTranslation();
	const unit = useUnit(managedAthlete?.weightUnit);
	const logged = new Set(workout.blocks.map((b) => b.templateBlockId));
	const skipped = plannedBlocks.filter((b) => !logged.has(b.id));
	return (
		<div className="stack-tight">
			{workout.blocks.map((block) => (
				<BlockCard
					key={block.id}
					block={block}
					workoutId={workout.id}
					ownerId={athleteId}
					unit={unit}
					managed={managedAthlete !== undefined}
				/>
			))}
			{skipped.map((block, i) => (
				<PlannedBlockCard
					key={block.id}
					block={block}
					index={workout.blocks.length + i + 1}
					status={t("plannedSession.notLoggedBlock")}
					unit={unit}
				/>
			))}
			{workout.note ? <p className="workout-note">{workout.note}</p> : null}
		</div>
	);
}
