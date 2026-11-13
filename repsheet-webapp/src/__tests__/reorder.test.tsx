import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	Block,
	PlannedSession,
	Template,
	TemplateBlock,
	Workout,
} from "@/lib/api/schemas";
import { dropIndex, moveBlock, moveItem } from "@/lib/reorder";
import { PlannedSessionPage } from "@/pages/PlannedSessionPage";
import { TemplateEditorPage } from "@/pages/TemplateEditorPage";
import { WorkoutPage } from "@/pages/WorkoutPage";
import { exercise, mockApi, page, renderRoute, user } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

const bench = exercise({ id: "bench", name: "Développé couché" });
const squat = exercise({ id: "squat", name: "Squat" });

function templateBlock(
	id: string,
	position: number,
	ex: typeof bench,
): TemplateBlock {
	return {
		id,
		position,
		kind: "simple",
		rounds: 3,
		restSeconds: null,
		exercises: [
			{
				id: `${id}-e`,
				exercise: ex,
				mode: "reps",
				equipment: "barbell",
				grip: null,
				target: "5",
				note: null,
				sets: [],
			},
		],
	};
}

function loggedBlock(id: string, position: number, ex: typeof bench): Block {
	return {
		id,
		position,
		kind: "simple",
		templateBlockId: null,
		restSeconds: null,
		exercises: [
			{
				id: `${id}-e`,
				exercise: ex,
				mode: "reps",
				equipment: "barbell",
				grip: null,
				comments: [],
				sets: [
					{
						round: 1,
						reps: 5,
						weightKg: 100,
						durationSeconds: null,
						distanceMeters: null,
						warmup: false,
					},
				],
			},
		],
	};
}

describe("moving an item", () => {
	it("moves it anywhere, and leaves the list alone out of range", () => {
		expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
		expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
		expect(moveItem(["a", "b", "c"], 0, 3)).toEqual(["a", "b", "c"]);
		expect(moveItem(["a", "b", "c"], 3, 0)).toEqual(["a", "b", "c"]);
	});

	it("renumbers blocks from 1", () => {
		const blocks = [
			{ id: "a", position: 1 },
			{ id: "b", position: 3 },
			{ id: "c", position: 4 },
		];
		expect(moveBlock(blocks, 2, 0)).toEqual([
			{ id: "c", position: 1 },
			{ id: "a", position: 2 },
			{ id: "b", position: 3 },
		]);
	});

	it("drops a dragged item past the centres it crossed", () => {
		const centers = [50, 150, 250, 350];
		expect(dropIndex(centers, 0, 60)).toBe(0);
		expect(dropIndex(centers, 0, 160)).toBe(1);
		expect(dropIndex(centers, 0, 400)).toBe(3);
		expect(dropIndex(centers, 3, 140)).toBe(1);
		expect(dropIndex(centers, 3, -20)).toBe(0);
	});
});

describe("reordering the blocks of a template", () => {
	it("moves a block with the buttons and saves the new order", async () => {
		const template: Template = {
			id: "t1",
			name: "Legs",
			note: null,
			author: null,
			updatedAt: "2026-11-01T10:00:00Z",
			blocks: [templateBlock("tb1", 1, bench), templateBlock("tb2", 2, squat)],
		};
		const calls = mockApi({
			"GET /v1/templates/t1": () => ({ status: 200, body: template }),
			"PUT /v1/templates/t1": () => ({ status: 200, body: template }),
		});
		await renderRoute(
			() => <TemplateEditorPage templateId="t1" />,
			"/templates/t1",
		);
		const ui = userEvent.setup();

		const first = await screen.findByRole("region", { name: "Bloc 1" });
		expect(
			within(first).getByRole("button", { name: "Monter le bloc 1" }),
		).toBeDisabled();
		await ui.click(
			within(first).getByRole("button", { name: "Descendre le bloc 1" }),
		);
		expect(
			within(screen.getByRole("region", { name: "Bloc 1" })).getByText("Squat"),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Descendre le bloc 2" }),
		).toBeDisabled();
		await ui.click(
			screen.getByRole("button", { name: "Enregistrer le modèle" }),
		);

		await waitFor(() => {
			const body = calls.find((c) => c.method === "PUT")?.body as {
				blocks: { id: string }[];
			};
			expect(body.blocks.map((b) => b.id)).toEqual(["tb2", "tb1"]);
		});
	});
});

describe("dragging a block", () => {
	it("drops it past the blocks it crossed", async () => {
		const template: Template = {
			id: "t1",
			name: "Legs",
			note: null,
			author: null,
			updatedAt: "2026-11-01T10:00:00Z",
			blocks: [templateBlock("tb1", 1, bench), templateBlock("tb2", 2, squat)],
		};
		mockApi({
			"GET /v1/templates/t1": () => ({ status: 200, body: template }),
		});
		await renderRoute(
			() => <TemplateEditorPage templateId="t1" />,
			"/templates/t1",
		);
		const sections = await screen.findAllByRole("region", { name: /^Bloc/ });
		// jsdom lays nothing out: each block is 100px tall, 10px apart.
		sections.forEach((section, i) => {
			section.getBoundingClientRect = () =>
				DOMRect.fromRect({ x: 0, y: i * 110, width: 300, height: 100 });
		});
		const [first] = sections;
		const grip = first?.querySelector(".drag-handle");
		if (!grip) {
			throw new Error("no drag handle");
		}

		fireEvent.pointerDown(grip, {
			button: 0,
			clientY: 50,
			pointerType: "touch",
		});
		fireEvent.pointerMove(window, { clientY: 180 });
		expect(first).toHaveAttribute("data-drag", "self");
		fireEvent.pointerUp(window, { clientY: 180 });

		const reordered = screen.getAllByRole("region", { name: /^Bloc/ });
		expect(reordered[0]).toHaveTextContent("Squat");
		expect(reordered[1]).toHaveTextContent("Développé couché");
		expect(reordered[1]).not.toHaveAttribute("data-drag");
	});
});

describe("reordering the blocks of a workout", () => {
	const workout: Workout = {
		id: "w1",
		name: "Legs",
		templateId: null,
		note: null,
		performedOn: "2026-11-12",
		durationMinutes: null,
		blocks: [loggedBlock("b1", 1, bench), loggedBlock("b2", 2, squat)],
	};

	it("moves a block with the buttons and sends its new position", async () => {
		const calls = mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/workouts/w1": () => ({ status: 200, body: workout }),
			"GET /v1/exercises/bench/performances": () => ({
				status: 200,
				body: page([]),
			}),
			"GET /v1/exercises/squat/performances": () => ({
				status: 200,
				body: page([]),
			}),
			"PUT /v1/workouts/w1/blocks/b2/position": () => ({
				status: 200,
				body: {
					...workout,
					blocks: [
						{ ...loggedBlock("b2", 1, squat) },
						{ ...loggedBlock("b1", 2, bench) },
					],
				},
			}),
		});
		await renderRoute(() => <WorkoutPage workoutId="w1" />, "/workouts/w1");
		const ui = userEvent.setup();

		await ui.click(
			await screen.findByRole("button", { name: "Monter le bloc 2" }),
		);

		await waitFor(() =>
			expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
				position: 1,
			}),
		);
		expect(calls.find((c) => c.method === "PUT")?.path).toBe(
			"/v1/workouts/w1/blocks/b2/position",
		);
		const blocks = screen.getAllByRole("button", { name: /^Bloc \d$/ });
		expect(blocks.map((b) => b.textContent)).toEqual([
			expect.stringContaining("Squat"),
			expect.stringContaining("Développé couché"),
		]);
		expect(
			screen.getByRole("button", { name: "Monter le bloc 1" }),
		).toBeDisabled();
	});

	it("puts the block back when the move fails", async () => {
		mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/workouts/w1": () => ({ status: 200, body: workout }),
			"PUT /v1/workouts/w1/blocks/b1/position": () => ({
				status: 500,
				body: { title: "Internal Server Error", status: 500 },
			}),
		});
		await renderRoute(() => <WorkoutPage workoutId="w1" />, "/workouts/w1");
		const ui = userEvent.setup();

		await ui.click(
			await screen.findByRole("button", { name: "Descendre le bloc 1" }),
		);

		expect(
			await screen.findByText(/Le serveur a rencontré un problème/),
		).toBeInTheDocument();
		const blocks = screen.getAllByRole("button", { name: /^Bloc \d$/ });
		expect(blocks[0]).toHaveTextContent("Développé couché");
	});

	it("has nothing to move with a single block", async () => {
		mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/workouts/w1": () => ({
				status: 200,
				body: { ...workout, blocks: [loggedBlock("b1", 1, bench)] },
			}),
		});
		await renderRoute(() => <WorkoutPage workoutId="w1" />, "/workouts/w1");

		await screen.findByRole("button", { name: "Bloc 1" });
		expect(
			screen.queryByRole("button", { name: /Monter|Descendre/ }),
		).not.toBeInTheDocument();
	});
});

describe("reordering the blocks of a planned session", () => {
	it("moves a block with the buttons and sends its new position", async () => {
		const session: PlannedSession = {
			id: "p1",
			athleteId: "a1",
			author: { id: user.id, name: user.name },
			plannedOn: "2026-11-14",
			name: "Legs",
			note: null,
			status: "draft",
			updatedAt: "2026-11-12T10:00:00Z",
			blocks: [templateBlock("tb1", 1, bench), templateBlock("tb2", 2, squat)],
		};
		const calls = mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/users/me/athletes/a1": () => ({
				status: 200,
				body: {
					id: "a1",
					name: "Paul",
					email: "paul@example.com",
					managed: false,
					weightUnit: "kg",
					linkedAt: "2026-11-03T10:00:00Z",
				},
			}),
			"GET /v1/planned-sessions/p1": () => ({ status: 200, body: session }),
			"GET /v1/planned-sessions/p1/workouts": () => ({
				status: 200,
				body: page([]),
			}),
			"PUT /v1/planned-sessions/p1/blocks/tb1/position": () => ({
				status: 200,
				body: {
					...session,
					blocks: [
						templateBlock("tb2", 1, squat),
						templateBlock("tb1", 2, bench),
					],
				},
			}),
		});
		await renderRoute(
			() => <PlannedSessionPage athleteId="a1" sessionId="p1" />,
			"/athletes/a1/sessions/p1",
		);
		const ui = userEvent.setup();

		await ui.click(
			await screen.findByRole("button", { name: "Descendre le bloc 1" }),
		);

		await waitFor(() =>
			expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
				position: 2,
			}),
		);
		expect(calls.find((c) => c.method === "PUT")?.path).toBe(
			"/v1/planned-sessions/p1/blocks/tb1/position",
		);
		expect(screen.getByRole("button", { name: "Bloc 1" })).toHaveTextContent(
			"Squat",
		);
	});
});
