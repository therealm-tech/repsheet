import { describe, expect, it } from "vitest";
import type { ExerciseSummary, Template, Workout } from "@/lib/api/schemas";
import {
	draftFromTemplate,
	draftFromWorkout,
	draftToInput,
} from "@/lib/templates";

const squat: ExerciseSummary = {
	id: "squat",
	name: "Squat",
	modes: ["reps"],
	defaultMode: "reps",
	load: "required",
	equipment: ["barbell"],
	defaultEquipment: "barbell",
	grips: [],
	defaultGrip: null,
	unilateral: false,
};
const crunch: ExerciseSummary = {
	id: "crunch",
	name: "Crunch",
	modes: ["reps", "time"],
	defaultMode: "reps",
	load: "none",
	equipment: ["bodyweight"],
	defaultEquipment: "bodyweight",
	grips: [],
	defaultGrip: null,
	unilateral: false,
};

const workout: Workout = {
	id: "w1",
	name: "Jambes",
	templateId: null,
	note: null,
	performedOn: "2026-10-22",
	durationMinutes: 60,
	blocks: [
		{
			id: "b1",
			position: 1,
			kind: "superset",
			templateBlockId: null,
			restSeconds: 90,
			exercises: [
				{
					id: "ex1",
					exercise: squat,
					mode: "reps",
					equipment: "barbell",
					comments: [],
					grip: null,
					sets: [1, 2, 3].map((round) => ({
						round,
						reps: 8,
						weightKg: 80,
						durationSeconds: null,
						distanceMeters: null,
						warmup: false,
					})),
				},
				{
					id: "ex2",
					exercise: crunch,
					mode: "time",
					equipment: "bodyweight",
					comments: [],
					grip: null,
					sets: [1, 2, 3].map((round) => ({
						round,
						reps: null,
						weightKg: null,
						durationSeconds: 60,
						distanceMeters: null,
						warmup: false,
					})),
				},
			],
		},
	],
};

describe("template drafts", () => {
	it("turns a workout into a template body with modes, targets and no weights", () => {
		const input = draftToInput(draftFromWorkout(workout));
		expect(input).toEqual({
			name: "Jambes",
			blocks: [
				{
					rounds: 3,
					restSeconds: 90,
					exercises: [
						{
							exerciseId: "squat",
							mode: "reps",
							equipment: "barbell",
							grip: null,
							target: "8",
						},
						{
							exerciseId: "crunch",
							mode: "time",
							equipment: "bodyweight",
							grip: null,
							target: "1 min",
						},
					],
				},
			],
		});
	});

	it("keeps block ids, trims fields and drops empty blocks", () => {
		const input = draftToInput({
			name: "  Push A ",
			note: " Descente 3 s ",
			blocks: [
				{
					key: "k1",
					id: "tb1",
					rounds: null,
					restSeconds: null,
					exercises: [
						{
							key: "d1",
							exercise: squat,
							mode: "reps",
							equipment: "barbell",
							note: "",
							grip: null,
							target: "  ",
						},
					],
				},
				{ key: "k2", rounds: 3, restSeconds: null, exercises: [] },
			],
		});
		expect(input).toEqual({
			name: "Push A",
			note: "Descente 3 s",
			blocks: [
				{
					id: "tb1",
					exercises: [
						{
							exerciseId: "squat",
							mode: "reps",
							equipment: "barbell",
							grip: null,
						},
					],
				},
			],
		});
	});

	it("keeps the instructions of each exercise, trimmed, and none when blank", () => {
		const template: Template = {
			id: "t1",
			name: "Jambes",
			note: null,
			updatedAt: "2026-11-10T10:00:00Z",
			blocks: [
				{
					id: "tb1",
					position: 1,
					kind: "superset",
					rounds: 3,
					restSeconds: null,
					exercises: [
						{
							id: "tbe1",
							exercise: squat,
							mode: "reps",
							equipment: "barbell",
							grip: null,
							target: "5",
							note: "Tempo 3-1-1",
						},
						{
							id: "tbe2",
							exercise: crunch,
							mode: "reps",
							equipment: "bodyweight",
							grip: null,
							target: null,
							note: null,
						},
					],
				},
			],
		};
		const draft = draftFromTemplate(template);
		const first = draft.blocks[0]?.exercises[0];
		if (first) {
			first.note = " Tempo 3-1-1, descente lente ";
		}
		expect(draftToInput(draft).blocks[0]?.exercises.map((e) => e.note)).toEqual(
			["Tempo 3-1-1, descente lente", undefined],
		);
	});

	it("leaves a workout's comments out of the template made from it", () => {
		const commented: Workout = {
			...workout,
			blocks: workout.blocks.map((block) => ({
				...block,
				exercises: block.exercises.map((e) => ({
					...e,
					comments: [
						{
							id: "k1",
							blockExerciseId: e.id,
							author: null,
							text: "Genou sensible",
							createdAt: "2026-10-22T18:00:00Z",
							updatedAt: "2026-10-22T18:00:00Z",
						},
					],
				})),
			})),
		};
		const exercises = draftFromWorkout(commented).blocks[0]?.exercises ?? [];
		expect(exercises.map((e) => e.note)).toEqual(["", ""]);
	});
});
