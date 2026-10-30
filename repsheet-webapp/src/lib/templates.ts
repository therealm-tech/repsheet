import type {
	ExerciseSummary,
	Mode,
	Template,
	TemplateBlockInput,
	TemplateInput,
	Workout,
} from "@/lib/api/schemas";
import { roundCount } from "@/lib/blocks";
import { targetFromSets } from "@/lib/grid";

export interface DraftExercise {
	exercise: ExerciseSummary;
	mode: Mode;
	target: string;
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
				exercise: e.exercise,
				mode: e.mode,
				target: e.target ?? "",
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
				exercise: e.exercise,
				mode: e.mode,
				target: targetFromSets(e.mode, e.sets) ?? "",
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
						const target = e.target.trim();
						const exercise = { exerciseId: e.exercise.id, mode: e.mode };
						return target ? { ...exercise, target } : exercise;
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
