import type {
	ExerciseSummary,
	Template,
	TemplateBlockInput,
	TemplateExerciseInput,
	TemplateInput,
	Workout,
} from "@/lib/api/schemas";
import { roundCount } from "@/lib/blocks";
import { type Choices, startingChoices } from "@/lib/choices";
import { targetFromSets } from "@/lib/grid";

export interface DraftExercise extends Choices {
	/** Tells apart two entries of the same exercise; never sent to the API. */
	key: string;
	exercise: ExerciseSummary;
	target: string;
	/** Instructions for the exercise, shown while a block is logged from it. */
	note: string;
}

export interface DraftBlock {
	key: string;
	id?: string;
	rounds: number | null;
	restSeconds: number | null;
	exercises: DraftExercise[];
}

export interface Draft {
	name: string;
	note: string;
	blocks: DraftBlock[];
}

let counter = 0;
export function newKey(): string {
	counter += 1;
	return `draft-${counter}`;
}

/**
 * `exercise` in place of the entry's, with its target and instruction, done
 * the same way where it allows it and its default way otherwise.
 */
export function replaceDraftExercise(
	entry: DraftExercise,
	exercise: ExerciseSummary,
): DraftExercise {
	const { mode, equipment, grip } = entry;
	return {
		...entry,
		exercise,
		...startingChoices(exercise, { mode, equipment, grip }),
	};
}

export function emptyDraft(): Draft {
	return { name: "", note: "", blocks: [] };
}

export function draftFromTemplate(template: Template): Draft {
	return {
		name: template.name,
		note: template.note ?? "",
		blocks: template.blocks.map((block) => ({
			key: block.id,
			id: block.id,
			rounds: block.rounds,
			restSeconds: block.restSeconds,
			exercises: block.exercises.map((e) => ({
				key: e.id,
				exercise: e.exercise,
				mode: e.mode,
				equipment: e.equipment,
				grip: e.grip,
				target: e.target ?? "",
				note: e.note ?? "",
			})),
		})),
	};
}

/** A template that replays a logged workout: same blocks, targets read from the sets. */
export function draftFromWorkout(workout: Workout): Draft {
	return {
		name: workout.name,
		note: workout.note ?? "",
		blocks: workout.blocks.map((block) => ({
			key: newKey(),
			rounds:
				Math.max(0, ...block.exercises.map((e) => roundCount(e.sets))) || null,
			restSeconds: block.restSeconds,
			exercises: block.exercises.map((e) => ({
				key: newKey(),
				exercise: e.exercise,
				mode: e.mode,
				equipment: e.equipment,
				grip: e.grip,
				target: targetFromSets(e.mode, e.sets) ?? "",
				note: "",
			})),
		})),
	};
}

export function draftToInput(draft: Draft): TemplateInput {
	const input: TemplateInput = {
		name: draft.name.trim(),
		blocks: draft.blocks
			.filter((block) => block.exercises.length > 0)
			.map((block) => {
				const out: TemplateBlockInput = {
					exercises: block.exercises.map((e) => {
						const exercise: TemplateExerciseInput = {
							exerciseId: e.exercise.id,
							mode: e.mode,
							equipment: e.equipment,
							grip: e.grip,
						};
						const target = e.target.trim();
						if (target) {
							exercise.target = target;
						}
						const note = e.note.trim();
						if (note) {
							exercise.note = note;
						}
						return exercise;
					}),
				};
				if (block.id) {
					out.id = block.id;
				}
				if (block.rounds !== null) {
					out.rounds = block.rounds;
				}
				if (block.restSeconds !== null) {
					out.restSeconds = block.restSeconds;
				}
				return out;
			}),
	};
	const note = draft.note.trim();
	if (note) {
		input.note = note;
	}
	return input;
}
