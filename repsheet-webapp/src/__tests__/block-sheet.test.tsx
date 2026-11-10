import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlockSheet } from "@/components/BlockSheet";
import { keys } from "@/lib/api/endpoints";
import type { Block, ExerciseSummary, TemplateBlock } from "@/lib/api/schemas";
import {
	exercise,
	mockApi,
	newClient,
	page,
	performance,
	renderWithClient,
	user,
} from "./helpers";

const bench: ExerciseSummary = {
	id: "bench",
	name: "Développé couché",
	modes: ["reps"],
	defaultMode: "reps",
	load: "required",
	equipment: ["barbell"],
	defaultEquipment: "barbell",
	unilateral: false,
};
const plank: ExerciseSummary = {
	id: "plank",
	name: "Planche",
	modes: ["time"],
	defaultMode: "time",
	load: "optional",
	equipment: ["bodyweight"],
	defaultEquipment: "bodyweight",
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
	unilateral: false,
};

function timedSet(round: number, durationSeconds: number) {
	return {
		round,
		reps: null,
		weightKg: null,
		durationSeconds,
		distanceMeters: null,
		warmup: false,
	};
}

function repsSet(round: number, reps: number) {
	return { ...timedSet(round, 0), durationSeconds: null, reps };
}

function client() {
	const c = newClient();
	c.setQueryData(keys.me, user);
	return c;
}

const savedBlock = (body: unknown): Block => ({
	id: "b9",
	position: 1,
	kind: "superset",
	templateBlockId: null,
	restSeconds: null,
	exercises: [],
	...(body as object),
});

afterEach(() => vi.unstubAllGlobals());

describe("BlockSheet", () => {
	it("prefills a planned block from the template and the last performance, then saves it", async () => {
		const templateBlock: TemplateBlock = {
			id: "tb1",
			position: 1,
			kind: "superset",
			rounds: 2,
			restSeconds: 90,
			exercises: [
				{ exercise: bench, mode: "reps", equipment: "barbell", target: "6–8" },
				{
					exercise: plank,
					mode: "time",
					equipment: "bodyweight",
					target: "45 s",
				},
			],
		};
		const calls = mockApi({
			"GET /v1/exercises/bench/performances": () => ({
				status: 200,
				body: page([
					performance([
						{
							round: 1,
							reps: 8,
							weightKg: 60,
							durationSeconds: null,
							distanceMeters: null,
							warmup: false,
						},
						{
							round: 2,
							reps: 7,
							weightKg: 62.5,
							durationSeconds: null,
							distanceMeters: null,
							warmup: false,
						},
					]),
				]),
			}),
			"GET /v1/exercises/plank/performances": () => ({
				status: 200,
				body: page([]),
			}),
			"POST /v1/workouts/w1/blocks": () => ({
				status: 201,
				body: savedBlock({}),
			}),
		});
		const onClose = vi.fn();
		renderWithClient(
			<BlockSheet
				workoutId="w1"
				mode={{ kind: "new", templateBlock }}
				onClose={onClose}
			/>,
			client(),
		);
		const ui = userEvent.setup();

		expect(await screen.findByText("Superset · auto")).toBeInTheDocument();
		expect(
			screen.getByRole("button", {
				name: "Tour 1, A Développé couché : 8 reps 60 kg",
			}),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", {
				name: "Tour 2, A Développé couché : 8 reps 62,5 kg",
			}),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Tour 2, B Planche : 45 s" }),
		).toBeInTheDocument();
		expect(screen.getByText(/Dernière fois/)).toHaveTextContent(
			"8/7 · 60→62,5 kg",
		);

		await ui.click(
			screen.getByRole("button", { name: "Tour 2, B Planche : 45 s" }),
		);
		await ui.click(
			screen.getByRole("button", { name: "B · Planche — Durée moins" }),
		);
		await ui.click(screen.getByRole("button", { name: "Enregistrer le bloc" }));

		expect(
			calls
				.filter((c) => c.path.includes("/performances"))
				.every((c) => c.path.includes("beforeWorkoutId=w1")),
		).toBe(true);
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		const post = calls.find((c) => c.method === "POST");
		expect(post?.body).toEqual({
			templateBlockId: "tb1",
			restSeconds: 90,
			exercises: [
				{
					exerciseId: "bench",
					mode: "reps",
					equipment: "barbell",
					sets: [
						{ round: 1, warmup: false, reps: 8, weightKg: 60 },
						{ round: 2, warmup: false, reps: 8, weightKg: 62.5 },
					],
				},
				{
					exerciseId: "plank",
					mode: "time",
					equipment: "bodyweight",
					sets: [
						{ round: 1, warmup: false, durationSeconds: 45 },
						{ round: 2, warmup: false, durationSeconds: 40 },
					],
				},
			],
		});
	});

	it("builds a free block: pick an exercise, add a round, type a value", async () => {
		const calls = mockApi({
			"GET /v1/exercises": () => ({
				status: 200,
				body: page([exercise({ ...bench, lastUsedOn: null })]),
			}),
			"GET /v1/exercises/bench/performances": () => ({
				status: 200,
				body: page([
					performance([
						{
							round: 1,
							reps: 5,
							weightKg: 80,
							durationSeconds: null,
							distanceMeters: null,
							warmup: false,
						},
					]),
				]),
			}),
			"POST /v1/workouts/w1/blocks": () => ({
				status: 201,
				body: savedBlock({}),
			}),
		});
		const onClose = vi.fn();
		renderWithClient(
			<BlockSheet workoutId="w1" mode={{ kind: "new" }} onClose={onClose} />,
			client(),
		);
		const ui = userEvent.setup();

		await ui.click(await screen.findByText("Développé couché"));
		expect(await screen.findByText("Simple · auto")).toBeInTheDocument();
		await ui.click(
			screen.getByRole("button", { name: "＋ Tour (copie du tour 1)" }),
		);
		expect(
			screen.getByRole("button", {
				name: "Tour 2, A Développé couché : 5 reps 80 kg",
			}),
		).toBeInTheDocument();

		await ui.click(
			screen.getByRole("button", {
				name: "Tour 2, A Développé couché : 5 reps 80 kg",
			}),
		);
		const input = screen.getByRole("textbox", {
			name: "A · Développé couché — Charge",
		});
		await ui.clear(input);
		await ui.type(input, "82,5{Enter}");
		await ui.click(
			screen.getByRole("button", { name: "Tour 1 en échauffement" }),
		);
		await ui.click(screen.getByRole("button", { name: "Enregistrer le bloc" }));

		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(calls.find((c) => c.method === "POST")?.body).toEqual({
			exercises: [
				{
					exerciseId: "bench",
					mode: "reps",
					equipment: "barbell",
					sets: [
						{ round: 1, warmup: true, reps: 5, weightKg: 80 },
						{ round: 2, warmup: false, reps: 5, weightKg: 82.5 },
					],
				},
			],
		});
	});

	it("refuses to save a weighted set without its load", async () => {
		mockApi({
			"GET /v1/exercises": () => ({
				status: 200,
				body: page([exercise({ ...bench })]),
			}),
			"GET /v1/exercises/bench/performances": () => ({
				status: 200,
				body: page([]),
			}),
		});
		renderWithClient(
			<BlockSheet workoutId="w1" mode={{ kind: "new" }} onClose={vi.fn()} />,
			client(),
		);
		const ui = userEvent.setup();

		await ui.click(await screen.findByText("Développé couché"));
		await ui.click(
			await screen.findByRole("button", {
				name: "A · Développé couché — Reps plus",
			}),
		);
		await ui.click(screen.getByRole("button", { name: "Enregistrer le bloc" }));

		expect(screen.getByRole("alert")).toHaveTextContent(
			"Indique la charge de Développé couché au tour 1.",
		);
	});

	it("switches a column between reps and time, confirming before it clears values", async () => {
		const calls = mockApi({
			"GET /v1/exercises": () => ({
				status: 200,
				body: page([exercise({ ...crunch })]),
			}),
			"GET /v1/exercises/crunch/performances": (call) => ({
				status: 200,
				body: page(
					call.path.includes("mode=time")
						? [
								performance(
									[timedSet(1, 45), timedSet(2, 45)],
									"2026-10-08",
									"time",
								),
							]
						: [performance([repsSet(1, 20)], "2026-10-15")],
				),
			}),
			"POST /v1/workouts/w1/blocks": () => ({
				status: 201,
				body: savedBlock({}),
			}),
		});
		const onClose = vi.fn();
		renderWithClient(
			<BlockSheet workoutId="w1" mode={{ kind: "new" }} onClose={onClose} />,
			client(),
		);
		const ui = userEvent.setup();

		await ui.click(await screen.findByText("Crunch"));
		expect(
			await screen.findByRole("button", { name: "Tour 1, A Crunch : 20 reps" }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("textbox", { name: /Lest/ }),
		).not.toBeInTheDocument();
		expect(await screen.findByText(/Dernière fois/)).toHaveTextContent(
			"Dernière fois en reps (15 oct.) : 1×20 reps",
		);

		const modes = within(screen.getByRole("group", { name: "Mode de Crunch" }));
		await ui.click(modes.getByRole("button", { name: "Temps" }));
		expect(
			screen.getByText(
				"Compter Crunch au temps ? Les valeurs déjà saisies en reps seront effacées.",
			),
		).toBeInTheDocument();
		await ui.click(screen.getByRole("button", { name: "Annuler" }));
		expect(
			screen.getByRole("button", { name: "Tour 1, A Crunch : 20 reps" }),
		).toBeInTheDocument();

		await ui.click(modes.getByRole("button", { name: "Temps" }));
		await ui.click(screen.getByRole("button", { name: "Changer" }));
		expect(
			await screen.findByRole("button", { name: "Tour 1, A Crunch : 45 s" }),
		).toBeInTheDocument();
		expect(
			modes.getByRole("button", { name: "Temps", pressed: true }),
		).toBeInTheDocument();
		expect(await screen.findByText(/Dernière fois/)).toHaveTextContent(
			"Dernière fois au temps (8 oct.) : 2 × 45 s",
		);

		await ui.click(
			screen.getByRole("button", { name: "Tour 1, A Crunch : 45 s" }),
		);
		const duration = screen.getByRole("textbox", {
			name: "A · Crunch — Durée",
		});
		expect(duration).toHaveValue("0:45");
		expect(screen.getByText("± 5 s · ou tape la valeur")).toBeInTheDocument();
		await ui.clear(duration);
		await ui.type(duration, "1:15{Enter}");
		expect(
			screen.getByRole("button", { name: "Tour 1, A Crunch : 1 min 15" }),
		).toBeInTheDocument();

		await ui.click(modes.getByRole("button", { name: "Reps" }));
		await ui.click(screen.getByRole("button", { name: "Annuler" }));
		await ui.click(screen.getByRole("button", { name: "Enregistrer le bloc" }));

		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(calls.find((c) => c.method === "POST")?.body).toEqual({
			exercises: [
				{
					exerciseId: "crunch",
					mode: "time",
					equipment: "bodyweight",
					sets: [{ round: 1, warmup: false, durationSeconds: 75 }],
				},
			],
		});
		expect(
			calls.some((c) =>
				c.path.startsWith("/v1/exercises/crunch/performances?"),
			),
		).toBe(true);
		expect(
			calls
				.filter((c) => c.path.includes("/performances"))
				.every((c) => /mode=(reps|time)/.test(c.path)),
		).toBe(true);
	});

	it("opens a template block in the template's mode", async () => {
		const calls = mockApi({
			"GET /v1/exercises/crunch/performances": () => ({
				status: 200,
				body: page([]),
			}),
		});
		renderWithClient(
			<BlockSheet
				workoutId="w1"
				mode={{
					kind: "new",
					templateBlock: {
						id: "tb1",
						position: 1,
						kind: "simple",
						rounds: 3,
						restSeconds: null,
						exercises: [
							{
								exercise: crunch,
								mode: "time",
								equipment: "bodyweight",
								target: "1 min",
							},
						],
					},
				}}
				onClose={vi.fn()}
			/>,
			client(),
		);

		expect(
			await screen.findByRole("button", { name: "Tour 3, A Crunch : 1 min" }),
		).toBeInTheDocument();
		expect(
			within(screen.getByRole("group", { name: "Mode de Crunch" })).getByRole(
				"button",
				{ name: "Temps", pressed: true },
			),
		).toBeInTheDocument();
		expect(calls[0]?.path).toContain("mode=time");
	});

	it("edits and deletes a logged block", async () => {
		const block: Block = {
			id: "b1",
			position: 2,
			kind: "simple",
			templateBlockId: null,
			restSeconds: null,
			exercises: [
				{
					exercise: bench,
					mode: "reps",
					equipment: "barbell",
					sets: [
						{
							round: 1,
							reps: 8,
							weightKg: 60,
							durationSeconds: null,
							distanceMeters: null,
							warmup: false,
						},
					],
				},
			],
		};
		const calls = mockApi({
			"GET /v1/exercises/bench/performances": () => ({
				status: 200,
				body: page([]),
			}),
			"PUT /v1/workouts/w1/blocks/b1": () => ({ status: 200, body: block }),
			"DELETE /v1/workouts/w1/blocks/b1": () => ({ status: 204 }),
		});
		const onClose = vi.fn();
		renderWithClient(
			<BlockSheet
				workoutId="w1"
				mode={{ kind: "edit", block }}
				onClose={onClose}
			/>,
			client(),
		);
		const ui = userEvent.setup();

		expect(screen.getByRole("heading", { name: "Bloc 2" })).toBeInTheDocument();
		await ui.click(
			screen.getByRole("button", {
				name: "Tour 1, A Développé couché : 8 reps 60 kg",
			}),
		);
		await ui.click(
			screen.getByRole("button", { name: "A · Développé couché — Reps plus" }),
		);
		await ui.click(screen.getByRole("button", { name: "Enregistrer le bloc" }));
		await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
		expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
			exercises: [
				{
					exerciseId: "bench",
					mode: "reps",
					equipment: "barbell",
					sets: [{ round: 1, warmup: false, reps: 9, weightKg: 60 }],
				},
			],
		});

		await ui.click(screen.getByText("Supprimer le bloc"));
		await ui.click(
			screen.getByRole("button", { name: "Confirmer la suppression" }),
		);
		await waitFor(() =>
			expect(calls.some((c) => c.method === "DELETE")).toBe(true),
		);
	});
});
