import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlockSheet } from "@/components/BlockSheet";
import { keys } from "@/lib/api/endpoints";
import type { Block, Exercise, Template, WorkoutSet } from "@/lib/api/schemas";
import { TemplateEditorPage } from "@/pages/TemplateEditorPage";
import {
	exercise,
	mockApi,
	newClient,
	page,
	performance,
	renderRoute,
	renderWithClient,
	user,
} from "./helpers";

afterEach(() => vi.unstubAllGlobals());

const bench: Exercise = exercise({ id: "bench", name: "Développé couché" });
const pushUp: Exercise = exercise({
	id: "push-up",
	name: "Pompes",
	load: "none",
	equipment: ["bodyweight"],
	defaultEquipment: "bodyweight",
});
const crunch: Exercise = exercise({
	id: "crunch",
	name: "Crunch",
	modes: ["reps", "time"],
	load: "none",
	equipment: ["bodyweight"],
	defaultEquipment: "bodyweight",
});
const cableCrunch: Exercise = exercise({
	id: "cable-crunch",
	name: "Crunch à la poulie",
	equipment: ["cable"],
	defaultEquipment: "cable",
});

function set(round: number, values: Partial<WorkoutSet>): WorkoutSet {
	return {
		round,
		reps: null,
		weightKg: null,
		durationSeconds: null,
		distanceMeters: null,
		warmup: false,
		...values,
	};
}

describe("replacing an exercise", () => {
	it("keeps the target and the instruction of a template, and resets a mode the new exercise lacks", async () => {
		const template: Template = {
			id: "t1",
			name: "Core",
			note: null,
			author: null,
			updatedAt: "2026-10-20T10:00:00Z",
			blocks: [
				{
					id: "tb1",
					position: 1,
					kind: "superset",
					rounds: 3,
					restSeconds: null,
					exercises: [
						{
							id: "ex1",
							exercise: crunch,
							mode: "time",
							equipment: "bodyweight",
							grip: null,
							target: "45 s",
							note: "Dos plaqué",
							sets: [],
						},
						{
							id: "ex2",
							exercise: pushUp,
							mode: "reps",
							equipment: "bodyweight",
							grip: null,
							target: "12",
							note: null,
							sets: [],
						},
					],
				},
			],
		};
		const calls = mockApi({
			"GET /v1/templates/t1": () => ({ status: 200, body: template }),
			"PUT /v1/templates/t1": () => ({ status: 200, body: template }),
			"GET /v1/exercises": () => ({
				status: 200,
				body: page([crunch, pushUp, cableCrunch]),
			}),
		});
		await renderRoute(
			() => <TemplateEditorPage templateId="t1" />,
			"/templates/t1",
		);
		const ui = userEvent.setup();

		await ui.click(
			await screen.findByRole("button", { name: "Remplacer Crunch" }),
		);
		expect(
			screen.getByRole("heading", { name: "Remplacer Crunch" }),
		).toBeInTheDocument();
		await ui.click(await screen.findByText("Crunch à la poulie"));
		expect(
			screen.getByRole("textbox", { name: "Cible pour Crunch à la poulie" }),
		).toHaveValue("45 s");
		await ui.click(
			screen.getByRole("button", { name: "Enregistrer le modèle" }),
		);

		await waitFor(() =>
			expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
				name: "Core",
				blocks: [
					{
						id: "tb1",
						rounds: 3,
						exercises: [
							{
								exerciseId: "cable-crunch",
								mode: "reps",
								equipment: "cable",
								grip: null,
								target: "45 s",
								note: "Dos plaqué",
							},
							{
								exerciseId: "push-up",
								mode: "reps",
								equipment: "bodyweight",
								grip: null,
								target: "12",
							},
						],
					},
				],
			}),
		);
	});

	it("keeps the sets of a workout block, dropping what the new exercise cannot hold", async () => {
		const block: Block = {
			id: "b1",
			position: 1,
			kind: "superset",
			templateBlockId: null,
			restSeconds: null,
			exercises: [
				{
					id: "be1",
					exercise: bench,
					mode: "reps",
					equipment: "barbell",
					grip: null,
					comments: [],
					sets: [
						set(1, { reps: 8, weightKg: 60 }),
						set(2, { reps: 6, weightKg: 65 }),
					],
				},
				{
					id: "be2",
					exercise: crunch,
					mode: "time",
					equipment: "bodyweight",
					grip: null,
					comments: [],
					sets: [
						set(1, { durationSeconds: 45 }),
						set(2, { durationSeconds: 60 }),
					],
				},
			],
		};
		const calls = mockApi({
			"GET /v1/exercises": () => ({
				status: 200,
				body: page([bench, crunch, pushUp, cableCrunch]),
			}),
			"GET /v1/exercises/bench/performances": () => ({
				status: 200,
				body: page([]),
			}),
			"GET /v1/exercises/crunch/performances": () => ({
				status: 200,
				body: page([]),
			}),
			"GET /v1/exercises/push-up/performances": () => ({
				status: 200,
				body: page([]),
			}),
			"GET /v1/exercises/cable-crunch/performances": () => ({
				status: 200,
				body: page([
					performance(
						[set(1, { reps: 15, weightKg: 20 })],
						"2026-10-15",
						"reps",
						"cable",
					),
				]),
			}),
			"PUT /v1/workouts/w1/blocks/b1": () => ({ status: 200, body: block }),
		});
		const client = newClient();
		client.setQueryData(keys.me, user);
		const onClose = vi.fn();
		renderWithClient(
			<BlockSheet
				workoutId="w1"
				mode={{ kind: "edit", block }}
				onClose={onClose}
			/>,
			client,
		);
		const ui = userEvent.setup();

		await ui.click(
			screen.getByRole("button", { name: "Remplacer Développé couché" }),
		);
		expect(screen.getByText("Remplacer Développé couché")).toBeInTheDocument();
		await ui.click(await screen.findByText("Pompes"));
		expect(
			await screen.findByRole("button", { name: "Tour 2, A Pompes : 6 reps" }),
		).toBeInTheDocument();

		await ui.click(screen.getByRole("button", { name: "Remplacer Crunch" }));
		await ui.click(await screen.findByText("Crunch à la poulie"));
		expect(
			await screen.findByRole("button", {
				name: "Tour 2, B Crunch à la poulie : 15 reps 20 kg",
			}),
		).toBeInTheDocument();

		await ui.click(screen.getByRole("button", { name: "Enregistrer le bloc" }));
		await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
		expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
			exercises: [
				{
					id: "be1",
					exerciseId: "push-up",
					mode: "reps",
					equipment: "bodyweight",
					grip: null,
					sets: [
						{ round: 1, warmup: false, reps: 8 },
						{ round: 2, warmup: false, reps: 6 },
					],
				},
				{
					id: "be2",
					exerciseId: "cable-crunch",
					mode: "reps",
					equipment: "cable",
					grip: null,
					sets: [
						{ round: 1, warmup: false, reps: 15, weightKg: 20 },
						{ round: 2, warmup: false, reps: 15, weightKg: 20 },
					],
				},
			],
		});
	});
});
