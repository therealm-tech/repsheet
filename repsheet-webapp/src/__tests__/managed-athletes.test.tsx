import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionMessage } from "@/components/SendSessionSheet";
import type {
	Athlete,
	PlannedSession,
	PlannedSessionSummary,
	Workout,
} from "@/lib/api/schemas";
import { tokenStore } from "@/lib/auth";
import { createAppRouter } from "@/router";
import {
	type Call,
	exercise,
	mockApi,
	newClient,
	page,
	performance,
	user,
} from "./helpers";

afterEach(() => {
	vi.unstubAllGlobals();
	tokenStore.clear();
});

const marc: Athlete = {
	id: "m1",
	name: "Marc",
	email: null,
	managed: true,
	weightUnit: "lb",
	linkedAt: "2026-11-03T10:00:00Z",
};

const squat = exercise({ id: "e1", name: "Squat" });
const bench = exercise({ id: "e2", name: "Développé couché" });
const row = exercise({
	id: "e3",
	name: "Rowing haltère",
	equipment: ["dumbbell"],
	defaultEquipment: "dumbbell",
});

const session: PlannedSession = {
	id: "p1",
	athleteId: marc.id,
	author: { id: user.id, name: user.name },
	plannedOn: "2026-11-11",
	name: "Full body A",
	note: null,
	status: "sent",
	updatedAt: "2026-11-10T10:00:00Z",
	blocks: [
		{
			id: "tb1",
			position: 1,
			kind: "simple",
			rounds: null,
			restSeconds: null,
			exercises: [
				{
					id: "tbe1",
					exercise: squat,
					mode: "reps",
					equipment: "barbell",
					grip: null,
					note: "Sous la parallèle",
					target: null,
					sets: [1, 2].map((round) => ({
						round,
						reps: 8,
						weightKg: 60,
						durationSeconds: null,
						distanceMeters: null,
						warmup: false,
					})),
				},
			],
		},
		{
			id: "tb2",
			position: 2,
			kind: "superset",
			rounds: 3,
			restSeconds: null,
			exercises: [
				{
					id: "tbe2",
					exercise: bench,
					mode: "reps",
					equipment: "barbell",
					grip: null,
					note: null,
					target: "10",
					sets: [],
				},
				{
					id: "tbe3",
					exercise: row,
					mode: "reps",
					equipment: "dumbbell",
					grip: null,
					note: null,
					target: "10",
					sets: [],
				},
			],
		},
	],
};

const summary: PlannedSessionSummary = {
	id: session.id,
	athleteId: marc.id,
	author: session.author,
	plannedOn: session.plannedOn,
	name: session.name,
	status: "sent",
	blockCount: 2,
	workoutCount: 0,
	updatedAt: session.updatedAt,
};

const started: Workout = {
	id: "w1",
	name: "Full body A",
	templateId: "p1",
	note: null,
	performedOn: "2026-11-11",
	durationMinutes: null,
	blocks: [
		{
			id: "b1",
			position: 1,
			kind: "simple",
			templateBlockId: "tb1",
			restSeconds: null,
			exercises: [
				{
					id: "be1",
					exercise: squat,
					mode: "reps",
					equipment: "barbell",
					grip: null,
					comments: [],
					sets: [
						{
							round: 1,
							reps: 8,
							weightKg: 62.5,
							durationSeconds: null,
							distanceMeters: null,
							warmup: false,
						},
					],
				},
			],
		},
	],
};

function renderApp(path: string, handlers: Parameters<typeof mockApi>[0]) {
	const calls = mockApi({
		"GET /v1/users/me": () => ({ status: 200, body: user }),
		"GET /v1/users/me/athletes": () => ({ status: 200, body: page([marc]) }),
		"GET /v1/users/me/athletes/m1": () => ({ status: 200, body: marc }),
		"GET /v1/planned-sessions": () => ({ status: 200, body: page([summary]) }),
		"GET /v1/planned-sessions/p1": () => ({ status: 200, body: session }),
		"GET /v1/planned-sessions/p1/workouts": () => ({
			status: 200,
			body: page([]),
		}),
		"GET /v1/workouts": () => ({ status: 200, body: page([]) }),
		...handlers,
	});
	tokenStore.set({ token: "t", expiresAt: "2099-01-01T00:00:00Z" });
	vi.stubGlobal("scrollTo", vi.fn());
	const router = createAppRouter(
		createMemoryHistory({ initialEntries: [path] }),
	);
	render(
		<QueryClientProvider client={newClient()}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
	return { router, calls };
}

describe("sessionMessage", () => {
	it("writes the session out block by block, in the athlete's unit, signed by the coach", () => {
		expect(sessionMessage(session, "kg", "Lou")).toBe(
			[
				"Full body A · Mer. 11 nov.",
				"",
				"1. Squat — 2×8 · 60 kg",
				"   « Sous la parallèle »",
				"2. Superset",
				"   A. Développé couché — 3 tours · 10",
				"   B. Rowing haltère — 10",
				"",
				"Dis-moi tes charges et ton ressenti en retour !",
				"— Lou",
			].join("\n"),
		);
	});
});

describe("athletes without an account", () => {
	it("creates a profile from the athletes tab and opens it", async () => {
		const { router, calls } = renderApp("/athletes", {
			"POST /v1/users/me/athletes": () => ({ status: 201, body: marc }),
		});
		const ui = userEvent.setup();

		await ui.click(
			await screen.findByRole("button", { name: "＋ Ajouter un athlète" }),
		);
		const sheet = await screen.findByRole("dialog", {
			name: "Ajouter un athlète",
		});
		await ui.type(within(sheet).getByLabelText("Nom"), "  Marc ");
		await ui.click(within(sheet).getByText("lb"));
		await ui.click(
			within(sheet).getByRole("button", { name: "Créer la fiche" }),
		);

		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/athletes/m1"),
		);
		expect(calls.find((c) => c.method === "POST")?.body).toEqual({
			name: "Marc",
			weightUnit: "lb",
		});
		expect(
			await screen.findByText("Sans compte · fiche gérée par toi"),
		).toBeVisible();
		expect(
			screen.getByRole("heading", { name: "Séances faites" }),
		).toBeVisible();
	});

	it("tags a profile in the list", async () => {
		renderApp("/athletes", {});

		const link = await screen.findByRole("link", { name: /Marc/ });
		expect(within(link).getByText("Sans compte")).toBeVisible();
	});

	it("renames a profile and changes its unit from its menu", async () => {
		let current = marc;
		const { calls } = renderApp("/athletes/m1", {
			"GET /v1/users/me/athletes/m1": () => ({ status: 200, body: current }),
			"PUT /v1/users/me/athletes/m1": (call) => {
				current = { ...marc, ...(call.body as object) };
				return { status: 200, body: current };
			},
		});
		const ui = userEvent.setup();

		await ui.click(
			await screen.findByRole("button", { name: "Gérer la fiche de Marc" }),
		);
		const sheet = await screen.findByRole("dialog", { name: "Fiche de Marc" });
		const name = within(sheet).getByLabelText("Nom");
		await ui.clear(name);
		await ui.type(name, "Marc D.");
		await ui.click(within(sheet).getByText("kg"));
		await ui.click(within(sheet).getByRole("button", { name: "Enregistrer" }));

		await waitFor(() =>
			expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
				name: "Marc D.",
				weightUnit: "kg",
			}),
		);
		expect(
			await screen.findByRole("heading", { level: 1, name: "Marc D." }),
		).toBeVisible();
	});

	it("starts the session with the athlete, logged in their name", async () => {
		const { router, calls } = renderApp("/athletes/m1/sessions/p1", {
			"POST /v1/workouts": () => ({ status: 201, body: started }),
			"GET /v1/workouts/w1": () => ({ status: 200, body: started }),
			"GET /v1/exercises/e1/performances": () => ({
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
					]),
				]),
			}),
		});
		const ui = userEvent.setup();

		const [start] = await screen.findAllByRole("button", {
			name: "▶ Démarrer la séance avec Marc",
		});
		expect(screen.queryByText("Brouillon")).not.toBeInTheDocument();
		await ui.click(start as HTMLElement);

		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/athletes/m1/workouts/w1"),
		);
		const created = calls.find(
			(c) => c.method === "POST" && c.path === "/v1/workouts",
		);
		expect(created?.body).toMatchObject({
			athleteId: "m1",
			templateId: "p1",
			name: "Full body A",
		});
		expect(
			await screen.findByText(
				"Séance de Marc, saisie par toi : elle va dans son historique, pas dans le tien.",
			),
		).toBeVisible();
		expect(screen.getByText("1×8 · 138 lb")).toBeVisible();
		await waitFor(() =>
			expect(
				calls.some(
					(c) =>
						c.path.startsWith("/v1/exercises/e1/performances") &&
						c.path.includes("athleteId=m1") &&
						c.path.includes("beforeWorkoutId=w1"),
				),
			).toBe(true),
		);
		expect(
			screen.queryByRole("button", { name: /Commenter/ }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByText("↺ Créer un modèle depuis cette séance"),
		).not.toBeInTheDocument();
	});

	it("sends the session as text, copied to the clipboard without a share sheet", async () => {
		renderApp("/athletes/m1/sessions/p1", {});
		const ui = userEvent.setup();

		const [send] = await screen.findAllByRole("button", {
			name: "Envoyer à Marc",
		});
		await ui.click(send as HTMLElement);
		const sheet = await screen.findByRole("dialog", { name: "Envoyer à Marc" });
		expect(within(sheet).getByText(/1\. Squat — 2×8 · 132,5 lb/)).toBeVisible();
		await ui.click(within(sheet).getByRole("button", { name: "Partager…" }));

		expect(
			await within(sheet).findByRole("button", { name: "Copié ✓" }),
		).toBeVisible();
		expect(await navigator.clipboard.readText()).toContain("— Guillaume");
	});

	it("lists every workout of the profile as done", async () => {
		renderApp("/athletes/m1", {
			"GET /v1/workouts": (call: Call) => ({
				status: 200,
				body: call.path.includes("athleteId=m1")
					? page([
							{
								id: "w1",
								name: "Full body A",
								templateId: "p1",
								performedOn: "2026-11-11",
								durationMinutes: 52,
								blockCount: 4,
							},
						])
					: page([]),
			}),
		});

		const link = await screen.findByRole("link", { name: /Full body A.*52/ });
		expect(link).toHaveAttribute("href", "/athletes/m1/workouts/w1");
		expect(within(link).queryByText("Partagée")).not.toBeInTheDocument();
	});
});

describe("merging a profile into the athlete's account", () => {
	const account: Athlete = {
		id: "a1",
		name: "Marc Dupont",
		email: "marc@example.com",
		managed: false,
		weightUnit: "kg",
		linkedAt: "2026-11-05T10:00:00Z",
	};

	it("merges once confirmed, then opens the account", async () => {
		const { router, calls } = renderApp("/athletes/m1", {
			"GET /v1/users/me/athletes": () => ({
				status: 200,
				body: page([marc, account]),
			}),
			"GET /v1/users/me/athletes/a1": () => ({ status: 200, body: account }),
			"POST /v1/users/me/athletes/m1/merges": () => ({
				status: 201,
				body: account,
			}),
		});
		const ui = userEvent.setup();

		await ui.click(
			await screen.findByRole("button", { name: "Gérer la fiche de Marc" }),
		);
		const sheet = await screen.findByRole("dialog", { name: "Fiche de Marc" });
		await ui.selectOptions(
			await within(sheet).findByLabelText("Même athlète que"),
			"Marc Dupont · marc@example.com",
		);
		await ui.click(within(sheet).getByText("Fusionner la fiche"));
		expect(
			within(sheet).getByText(
				"Les séances de Marc, faites et prévues, rejoignent le compte de Marc Dupont, et la fiche est supprimée. C'est irréversible.",
			),
		).toBeVisible();
		expect(calls.some((c) => c.method === "POST")).toBe(false);
		await ui.click(
			within(sheet).getByRole("button", { name: "Confirmer la fusion" }),
		);

		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/athletes/a1"),
		);
		expect(calls.find((c) => c.method === "POST")?.body).toEqual({
			accountId: "a1",
		});
		expect(
			await screen.findByRole("heading", { level: 1, name: "Marc Dupont" }),
		).toBeVisible();
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});

	it("is not offered without an athlete who has an account", async () => {
		const { calls } = renderApp("/athletes/m1", {});
		const ui = userEvent.setup();

		await ui.click(
			await screen.findByRole("button", { name: "Gérer la fiche de Marc" }),
		);
		const sheet = await screen.findByRole("dialog", { name: "Fiche de Marc" });
		await waitFor(() =>
			expect(
				calls.some((c) => c.path.startsWith("/v1/users/me/athletes?")),
			).toBe(true),
		);
		expect(
			within(sheet).queryByLabelText("Même athlète que"),
		).not.toBeInTheDocument();
	});
});
