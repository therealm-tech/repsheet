import { useTranslation } from "react-i18next";
import { BlockCard, PlannedBlockCard } from "@/components/BlockCard";
import type { TemplateBlock, Workout } from "@/lib/api/schemas";
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
}: {
	workout: Workout;
	athleteId: string;
	plannedBlocks?: TemplateBlock[];
}) {
	const { t } = useTranslation();
	const unit = useUnit();
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
				/>
			))}
			{skipped.map((block, i) => (
				<PlannedBlockCard
					key={block.id}
					block={block}
					index={workout.blocks.length + i + 1}
					status={t("plannedSession.notLoggedBlock")}
				/>
			))}
			{workout.note ? <p className="workout-note">{workout.note}</p> : null}
		</div>
	);
}
