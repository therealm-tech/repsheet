import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlannedBlockCard } from "@/components/BlockCard";
import { BlockSheet } from "@/components/BlockSheet";
import type {
	Comment,
	LinkedAccount,
	TemplateBlock,
	Workout,
} from "@/lib/api/schemas";
import { ExerciseDetailPage } from "@/pages/ExerciseDetailPage";
import { SharedWorkoutPage } from "@/pages/SharedWorkoutPage";
import { WorkoutPage } from "@/pages/WorkoutPage";
import {
	exercise,
	mockApi,
	page,
	performance,
	renderRoute,
	renderWithClient,
	user,
} from "./helpers";

afterEach(() => vi.unstubAllGlobals());

const marie = { id: "c1", name: "Marie" };
const paul: LinkedAccount = {
	id: "a1",
	name: "Paul",
	email: "paul@example.com",
	linkedAt: "2026-11-03T10:00:00Z",
};
const bench = exercise({ id: "e1", name: "Développé couché" });
const dips = exercise({ id: "e2", name: "Dips", load: "optional" });

function comment(overrides: Partial<Comment> & Pick<Comment, "id">): Comment {
	return {
		blockExerciseId: "be1",
		author: { id: user.id, name: user.name },
		text: "Épaule gauche qui tire",
		createdAt: "2026-11-12T18:00:00Z",
		updatedAt: "2026-11-12T18:00:00Z",
		...overrides,
	};
}

const set = {
	round: 1,
	reps: 6,
	weightKg: 80,
	durationSeconds: null,
	distanceMeters: null,
	warmup: false,
};

function workout(ownerComments: Comment[], dipsComments: Comment[]): Workout {
	return {
		id: "w1",
		name: "Push",
		templateId: null,
		note: null,
		performedOn: "2026-11-12",
		durationMinutes: null,
		blocks: [
			{
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
						comments: ownerComments,
						sets: [set],
					},
					{
						id: "be2",
						exercise: dips,
						mode: "reps",
						equipment: "barbell",
						grip: null,
						comments: dipsComments,
						sets: [{ ...set, weightKg: null, reps: 12 }],
					},
				],
			},
		],
	};
}

describe("comments on an exercise", () => {
	it("show under the athlete's block, the coach named as such", async () => {
		mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/workouts/w1": () => ({
				status: 200,
				body: workout(
					[
						comment({ id: "k1" }),
						comment({
							id: "k2",
							author: marie,
							text: "On redescend à 77,5 kg",
							createdAt: "2026-11-13T08:00:00Z",
							updatedAt: "2026-11-13T09:00:00Z",
						}),
					],
					[comment({ id: "k3", author: null, text: "Trop facile" })],
				),
			}),
			"GET /v1/users/me/coaches": () => ({ status: 200, body: page([]) }),
		});
		await renderRoute(() => <WorkoutPage workoutId="w1" />, "/workouts/w1");

		const card = await screen.findByRole("button", { name: "Bloc 1" });
		await waitFor(() => expect(card).toHaveTextContent("Moi · 12 nov."));
		expect(card).toHaveTextContent(
			"Marie · coach · 13 nov. · modifiéOn redescend à 77,5 kg",
		);
		expect(card).toHaveTextContent("BDips12 nov.Trop facile");
		expect(within(card).queryByRole("textbox")).not.toBeInTheDocument();
	});

	it("let a coach reply, and edit only their own", async () => {
		const posted = comment({
			id: "k9",
			author: marie,
			text: "Garde 2 reps en réserve",
		});
		const calls = mockApi({
			"GET /v1/users/me": () => ({
				status: 200,
				body: { ...user, id: marie.id, name: marie.name },
			}),
			"GET /v1/users/me/athletes/a1": () => ({ status: 200, body: paul }),
			"GET /v1/workouts/w1": () => ({
				status: 200,
				body: workout(
					[comment({ id: "k1", author: { id: paul.id, name: paul.name } })],
					[],
				),
			}),
			"POST /v1/comments": () => ({ status: 201, body: posted }),
		});
		await renderRoute(
			() => <SharedWorkoutPage athleteId="a1" workoutId="w1" />,
			"/coaching/athletes/a1/workouts/w1",
		);

		const block = await screen.findByRole("region", { name: "Bloc 1" });
		expect(block).toHaveTextContent("Paul · 12 nov.");
		expect(
			within(block).queryByRole("button", { name: "Modifier" }),
		).toBeNull();
		expect(
			within(block).queryByRole("button", { name: "Supprimer" }),
		).toBeNull();

		await userEvent.click(
			within(block).getByRole("button", {
				name: "Ajouter un commentaire sur Dips",
			}),
		);
		const box = within(block).getByRole("textbox", {
			name: "Ajouter un commentaire sur Dips",
		});
		expect(box).toHaveFocus();
		await userEvent.type(box, "  Garde 2 reps en réserve ");
		await userEvent.click(
			within(block).getByRole("button", { name: "Envoyer" }),
		);

		await waitFor(() =>
			expect(calls.find((c) => c.method === "POST")?.body).toEqual({
				blockExerciseId: "be2",
				text: "Garde 2 reps en réserve",
			}),
		);
	});

	it("let the athlete reply and delete a coach's one, keeping the block's exercises", async () => {
		const logged = workout([comment({ id: "k2", author: marie })], []);
		const block = logged.blocks[0];
		if (!block) {
			throw new Error("no block");
		}
		const calls = mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/workouts/w1": () => ({ status: 200, body: logged }),
			"GET /v1/exercises/e1/performances": () => ({
				status: 200,
				body: page([]),
			}),
			"GET /v1/exercises/e2/performances": () => ({
				status: 200,
				body: page([]),
			}),
			"DELETE /v1/comments/k2": () => ({ status: 204 }),
			"POST /v1/comments": () => ({
				status: 201,
				body: comment({ id: "k3", blockExerciseId: "be2" }),
			}),
			"PUT /v1/workouts/w1/blocks/b1": () => ({ status: 200, body: block }),
		});
		const onClose = vi.fn();
		renderWithClient(
			<BlockSheet
				workoutId="w1"
				mode={{ kind: "edit", block }}
				onClose={onClose}
			/>,
		);
		const ui = userEvent.setup();
		const thread = await screen.findByRole("region", { name: "Commentaires" });
		await waitFor(() =>
			expect(
				within(thread).getByRole("button", { name: "Supprimer" }),
			).toBeInTheDocument(),
		);
		expect(
			within(thread).queryByRole("button", { name: "Modifier" }),
		).toBeNull();

		await ui.click(within(thread).getByRole("button", { name: "Supprimer" }));
		expect(calls.some((c) => c.method === "DELETE")).toBe(false);
		await ui.click(within(thread).getByRole("button", { name: "Supprimer" }));
		await waitFor(() =>
			expect(calls.some((c) => c.path === "/v1/comments/k2")).toBe(true),
		);

		await ui.type(
			within(thread).getByRole("textbox", {
				name: "Ajouter un commentaire sur Dips",
			}),
			"Trop facile",
		);
		await ui.click(
			within(thread).getAllByRole("button", {
				name: "Envoyer",
			})[1] as HTMLElement,
		);
		await waitFor(() =>
			expect(calls.find((c) => c.method === "POST")?.body).toEqual({
				blockExerciseId: "be2",
				text: "Trop facile",
			}),
		);

		await ui.click(screen.getByRole("button", { name: "Enregistrer le bloc" }));
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		const put = calls.find((c) => c.method === "PUT")?.body as {
			exercises: { id?: string }[];
		};
		expect(put.exercises.map((e) => e.id)).toEqual(["be1", "be2"]);
		expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
	});

	it("post a first comment once a new block is saved, under the coach's instructions", async () => {
		const planned: TemplateBlock = {
			id: "tb1",
			position: 1,
			kind: "simple",
			rounds: 1,
			restSeconds: null,
			exercises: [
				{
					id: "tbe1",
					exercise: bench,
					mode: "reps",
					equipment: "barbell",
					grip: null,
					target: "6",
					note: "Pause 1 s en bas",
					sets: [],
				},
			],
		};
		const created = workout([], []).blocks[0];
		const calls = mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/workouts/w1": () => ({ status: 200, body: workout([], []) }),
			"GET /v1/exercises/e1/performances": () => ({
				status: 200,
				body: page([performance([set], "2026-11-05")]),
			}),
			"POST /v1/workouts/w1/blocks": () => ({ status: 201, body: created }),
			"POST /v1/comments": () => ({ status: 201, body: comment({ id: "k1" }) }),
		});
		const onClose = vi.fn();
		renderWithClient(
			<BlockSheet
				workoutId="w1"
				mode={{ kind: "new", templateBlock: planned }}
				onClose={onClose}
			/>,
		);
		const ui = userEvent.setup();
		expect(await screen.findByText("Consignes du coach")).toBeInTheDocument();
		expect(screen.getByText("Pause 1 s en bas")).toBeInTheDocument();

		const box = screen.getByRole("textbox", {
			name: "Ajouter un commentaire sur Développé couché",
		});
		expect(box).toHaveValue("");
		expect(screen.queryByRole("button", { name: "Envoyer" })).toBeNull();
		await ui.type(box, "Épaule OK ");
		await ui.click(screen.getByRole("button", { name: "Enregistrer le bloc" }));

		await waitFor(() => expect(onClose).toHaveBeenCalled());
		const posts = calls.filter((c) => c.method === "POST");
		expect(posts.map((c) => c.path)).toEqual([
			"/v1/workouts/w1/blocks",
			"/v1/comments",
		]);
		expect(posts[1]?.body).toEqual({
			blockExerciseId: "be1",
			text: "Épaule OK",
		});
	});

	it("follow their performance in the exercise's history", async () => {
		mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/exercises/e1": () => ({ status: 200, body: bench }),
			"GET /v1/exercises/e1/performances": () => ({
				status: 200,
				body: page([
					{
						...performance([set], "2026-11-12"),
						comments: [
							comment({ id: "k1" }),
							comment({ id: "k2", author: marie, text: "Bien" }),
						],
					},
					performance([set], "2026-11-05"),
				]),
			}),
		});
		await renderRoute(
			() => <ExerciseDetailPage exerciseId="e1" />,
			"/exercises/e1",
		);

		const history = await screen.findByRole("region", { name: "Historique" });
		const [latest, before] = within(history).getAllByRole("listitem");
		await waitFor(() =>
			expect(latest).toHaveTextContent("Moi · 12 nov.Épaule gauche qui tire"),
		);
		expect(latest).toHaveTextContent("Marie · coach · 12 nov.Bien");
		expect(before).not.toHaveTextContent("coach");
	});
});

describe("instructions of a planned exercise", () => {
	it("show under the exercise of a block to log", () => {
		const block: TemplateBlock = {
			id: "tb1",
			position: 1,
			kind: "simple",
			rounds: 3,
			restSeconds: null,
			exercises: [
				{
					exercise: bench,
					mode: "reps",
					equipment: "barbell",
					id: "tbe-10",
					grip: null,
					target: "12–15",
					note: "Pause 1 s en haut",
					sets: [],
				},
			],
		};
		renderWithClient(<PlannedBlockCard block={block} index={3} />);
		expect(
			screen.getByRole("region", { name: "Bloc prévu 3" }),
		).toHaveTextContent("Consignes du coachPause 1 s en haut");
	});
});
