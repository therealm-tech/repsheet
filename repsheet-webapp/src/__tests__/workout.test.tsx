import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Workout } from "@/lib/api/schemas";
import { toDay } from "@/lib/dates";
import { HomePage } from "@/pages/HomePage";
import { WorkoutPage } from "@/pages/WorkoutPage";
import { mockApi, page, performance, renderRoute, user } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

const created: Workout = {
	id: "w1",
	name: "Séance libre",
	templateId: null,
	note: null,
	performedOn: "2026-09-30",
	durationMinutes: 55,
	blocks: [],
};

describe("creating a workout", () => {
	function home() {
		return mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/workouts": () => ({ status: 200, body: page([]) }),
			"GET /v1/templates": () => ({
				status: 200,
				body: page([
					{
						id: "t1",
						name: "Push A",
						blockCount: 3,
						updatedAt: "2026-10-01T10:00:00Z",
					},
				]),
			}),
			"POST /v1/workouts": () => ({ status: 201, body: created }),
		});
	}

	it("defaults to today and accepts a past date with a duration", async () => {
		const calls = home();
		await renderRoute(HomePage, "/dashboard");
		const ui = userEvent.setup();

		await ui.click(
			await screen.findByRole("button", { name: "＋ Séance libre" }),
		);
		const form = screen.getByRole("form", { name: "Nouvelle séance" });
		expect(within(form).getByLabelText("Nom")).toHaveValue("Séance libre");
		const date = within(form).getByLabelText("Date");
		expect(date).toHaveValue(toDay(new Date()));

		await ui.clear(date);
		await ui.type(date, "2026-09-30");
		await ui.type(within(form).getByLabelText("Durée (min, optionnel)"), "55");
		await ui.click(
			within(form).getByRole("button", { name: "Créer la séance" }),
		);

		await waitFor(() =>
			expect(calls.find((c) => c.method === "POST")?.body).toEqual({
				name: "Séance libre",
				performedOn: "2026-09-30",
				durationMinutes: 55,
			}),
		);
	});

	it("starts from a template, without a duration", async () => {
		const calls = home();
		await renderRoute(HomePage, "/dashboard");
		const ui = userEvent.setup();

		await ui.click(
			await screen.findByRole("button", { name: "Depuis un modèle…" }),
		);
		await ui.click(await screen.findByText("Push A"));
		const form = screen.getByRole("form", { name: "Nouvelle séance" });
		expect(within(form).getByLabelText("Nom")).toHaveValue("Push A");
		await ui.click(
			within(form).getByRole("button", { name: "Créer la séance" }),
		);

		await waitFor(() =>
			expect(calls.find((c) => c.method === "POST")?.body).toEqual({
				name: "Push A",
				performedOn: toDay(new Date()),
				templateId: "t1",
			}),
		);
	});

	it("rejects a duration out of range", async () => {
		const calls = home();
		await renderRoute(HomePage, "/dashboard");
		const ui = userEvent.setup();

		await ui.click(
			await screen.findByRole("button", { name: "＋ Séance libre" }),
		);
		await ui.type(screen.getByLabelText("Durée (min, optionnel)"), "2000");
		await ui.click(screen.getByRole("button", { name: "Créer la séance" }));

		expect(screen.getByRole("alert")).toHaveTextContent(
			"La durée va de 1 à 1440 minutes.",
		);
		expect(calls.some((c) => c.method === "POST")).toBe(false);
	});

	it("lists recent workouts with their day and duration", async () => {
		mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/workouts": () => ({
				status: 200,
				body: page([
					{
						id: "w1",
						name: "Pull B",
						templateId: null,
						performedOn: "2026-10-21",
						durationMinutes: 58,
						blockCount: 5,
					},
					{
						id: "w2",
						name: "Jambes",
						templateId: null,
						performedOn: "2026-10-19",
						durationMinutes: null,
						blockCount: 1,
					},
				]),
			}),
		});
		await renderRoute(HomePage, "/dashboard");

		expect(
			await screen.findByText("Mer. 21 oct. · 5 blocs · 58 min"),
		).toBeInTheDocument();
		expect(screen.getByText("Lun. 19 oct. · 1 bloc")).toBeInTheDocument();
		expect(screen.queryByText(/en cours/i)).not.toBeInTheDocument();
	});
});

describe("WorkoutPage", () => {
	const workout: Workout = {
		id: "w1",
		name: "Push A",
		templateId: null,
		note: "Bonne énergie",
		performedOn: "2026-10-22",
		durationMinutes: 55,
		blocks: [
			{
				id: "b1",
				position: 1,
				kind: "simple",
				templateBlockId: null,
				restSeconds: null,
				exercises: [
					{
						exercise: {
							id: "bench",
							name: "Développé couché",
							modes: ["reps"],
							defaultMode: "reps",
							load: "required",
							equipment: ["barbell"],
							defaultEquipment: "barbell",
							grips: [],
							defaultGrip: null,
							unilateral: false,
						},
						mode: "reps",
						equipment: "barbell",
						grip: null,
						sets: [1, 2].map((round) => ({
							round,
							reps: 8,
							weightKg: 62.5,
							durationSeconds: null,
							distanceMeters: null,
							warmup: false,
						})),
					},
				],
			},
		],
	};

	function api() {
		return mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/workouts/w1": () => ({ status: 200, body: workout }),
			"GET /v1/exercises/bench/performances": () => ({
				status: 200,
				body: page([
					performance(
						[
							{
								round: 1,
								reps: 8,
								weightKg: 60,
								durationSeconds: null,
								distanceMeters: null,
								warmup: false,
							},
						],
						"2026-10-15",
					),
				]),
			}),
			"PUT /v1/workouts/w1": (call) => ({
				status: 200,
				body: { ...workout, ...(call.body as object) },
			}),
		});
	}

	it("shows the day and duration, with no live timer", async () => {
		const calls = api();
		await renderRoute(() => <WorkoutPage workoutId="w1" />, "/workouts/w1");

		const header = await screen.findByRole("button", {
			name: /Modifier la séance Push A/,
		});
		expect(header).toHaveTextContent("Jeu. 22 oct. · 55 min");
		expect(screen.getByText("Bonne énergie")).toBeInTheDocument();
		expect(screen.queryByRole("timer")).not.toBeInTheDocument();
		expect(screen.queryByText(/Terminer|Reprendre/)).not.toBeInTheDocument();

		expect(await screen.findByText("↑ +2,5 kg vs 15 oct.")).toBeInTheDocument();
		expect(calls.find((c) => c.path.includes("/performances"))?.path).toContain(
			"beforeWorkoutId=w1",
		);
	});

	it("edits name, date, duration and note from the header", async () => {
		const calls = api();
		await renderRoute(() => <WorkoutPage workoutId="w1" />, "/workouts/w1");
		const ui = userEvent.setup();

		await ui.click(
			await screen.findByRole("button", { name: /Modifier la séance Push A/ }),
		);
		const form = screen.getByRole("form", { name: "Modifier la séance" });
		const date = within(form).getByLabelText("Date");
		expect(date).toHaveValue("2026-10-22");
		await ui.clear(date);
		await ui.type(date, "2026-10-20");
		await ui.clear(within(form).getByLabelText("Durée (min, optionnel)"));
		await ui.clear(within(form).getByLabelText("Note"));
		await ui.click(within(form).getByRole("button", { name: "Enregistrer" }));

		await waitFor(() =>
			expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
				name: "Push A",
				note: null,
				performedOn: "2026-10-20",
				durationMinutes: null,
			}),
		);
		await waitFor(() =>
			expect(screen.queryByRole("form")).not.toBeInTheDocument(),
		);
	});
});
