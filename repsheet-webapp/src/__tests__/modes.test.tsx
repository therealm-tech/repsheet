import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExercisePicker } from "@/components/ExercisePicker";
import i18n from "@/i18n";
import type { Exercise, Template, WorkoutSet } from "@/lib/api/schemas";
import { ExerciseDetailPage } from "@/pages/ExerciseDetailPage";
import { TemplateEditorPage } from "@/pages/TemplateEditorPage";
import {
	exercise,
	mockApi,
	page,
	performance,
	renderRoute,
	renderWithClient,
	user,
} from "./helpers";

afterEach(async () => {
	vi.unstubAllGlobals();
	await i18n.changeLanguage("fr");
});

const crunch: Exercise = exercise({
	id: "crunch",
	name: "Crunch",
	modes: ["reps", "time"],
	defaultMode: "reps",
	load: "none",
	equipment: ["bodyweight"],
	defaultEquipment: "bodyweight",
	grips: [],
	defaultGrip: null,
});
const cableCrunch: Exercise = exercise({
	id: "cable-crunch",
	name: "Crunch à la poulie",
	equipment: ["cable"],
	defaultEquipment: "cable",
	grips: [],
	defaultGrip: null,
});

function sets(field: "reps" | "durationSeconds", values: number[]) {
	return values.map(
		(value, i): WorkoutSet => ({
			round: i + 1,
			reps: null,
			weightKg: null,
			durationSeconds: null,
			distanceMeters: null,
			warmup: false,
			[field]: value,
		}),
	);
}

describe("exercise form", () => {
	it("creates an exercise counted in several modes, with a default mode and a load rule", async () => {
		const calls = mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/exercises": () => ({ status: 200, body: page([]) }),
			"POST /v1/exercises": () => ({ status: 201, body: crunch }),
		});
		renderWithClient(<ExercisePicker onSelect={vi.fn()} />);
		const ui = userEvent.setup();

		await ui.type(screen.getByRole("searchbox"), "Crunch oblique");
		await ui.click(
			await screen.findByRole("button", {
				name: "＋ Créer « Crunch oblique »",
			}),
		);
		expect(
			screen.queryByRole("group", { name: "Par défaut" }),
		).not.toBeInTheDocument();
		const modes = within(screen.getByRole("group", { name: "Se compte en" }));
		expect(
			modes.getByRole("button", { name: "Reps", pressed: true }),
		).toBeInTheDocument();
		await ui.click(modes.getByRole("button", { name: "Temps" }));
		await ui.click(
			within(screen.getByRole("group", { name: "Par défaut" })).getByRole(
				"button",
				{ name: "Temps" },
			),
		);
		await ui.click(screen.getByRole("radio", { name: "Aucune" }));
		const equipment = within(screen.getByRole("group", { name: "Matériel" }));
		await ui.click(equipment.getByRole("button", { name: "Poids du corps" }));
		await ui.click(equipment.getByRole("button", { name: "Barre" }));
		await ui.click(screen.getByRole("button", { name: "Créer l'exercice" }));

		await waitFor(() =>
			expect(calls.find((c) => c.method === "POST")?.body).toEqual({
				names: { fr: "Crunch oblique" },
				modes: ["reps", "time"],
				defaultMode: "time",
				load: "none",
				equipment: ["bodyweight"],
				defaultEquipment: "bodyweight",
				grips: [],
				defaultGrip: null,
				unilateral: false,
			}),
		);
	});

	it("never leaves an exercise without a mode", async () => {
		mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/exercises": () => ({ status: 200, body: page([]) }),
		});
		renderWithClient(<ExercisePicker onSelect={vi.fn()} />);
		const ui = userEvent.setup();

		await ui.click(
			await screen.findByRole("button", { name: "＋ Créer un exercice" }),
		);
		const modes = within(screen.getByRole("group", { name: "Se compte en" }));
		await ui.click(modes.getByRole("button", { name: "Reps" }));
		expect(
			modes.getByRole("button", { name: "Reps", pressed: true }),
		).toBeInTheDocument();
	});
});

describe("exercise lists", () => {
	it("say how each exercise is counted, in the user's language", async () => {
		mockApi({
			"GET /v1/exercises": () => ({
				status: 200,
				body: page([crunch, cableCrunch]),
			}),
		});
		renderWithClient(<ExercisePicker onSelect={vi.fn()} />);
		expect(
			await screen.findByText("Poids du corps · reps ou temps"),
		).toBeInTheDocument();
		expect(screen.getByText("Poulie · reps · charge")).toBeInTheDocument();

		await i18n.changeLanguage("en");
		expect(
			await screen.findByText("Bodyweight · reps or time"),
		).toBeInTheDocument();
		expect(screen.getByText("Cable · reps · load")).toBeInTheDocument();
	});
});

describe("exercise detail", () => {
	it("charts one mode at a time and keeps every entry in the history", async () => {
		mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/exercises/crunch": () => ({ status: 200, body: crunch }),
			"GET /v1/exercises/crunch/performances": () => ({
				status: 200,
				body: page(
					[
						performance(
							sets("durationSeconds", [60, 60, 50]),
							"2026-10-22",
							"time",
						),
						performance(sets("reps", [20, 20, 18]), "2026-10-15", "reps"),
						performance(
							sets("durationSeconds", [45, 45, 45]),
							"2026-10-08",
							"time",
						),
					].map((p) => ({ ...p, equipment: "bodyweight" as const })),
				),
			}),
		});
		await renderRoute(
			() => <ExerciseDetailPage exerciseId="crunch" />,
			"/exercises/crunch",
		);
		const ui = userEvent.setup();

		expect(
			await screen.findByRole("radio", { name: "Au temps", checked: true }),
		).toBeInTheDocument();
		const chart = await screen.findByRole("region", {
			name: "Série la plus longue",
		});
		expect(chart).toHaveTextContent("1 min");
		expect(chart).toHaveTextContent("+15 s depuis le début");
		expect(screen.getByText("Record au temps").parentElement).toHaveTextContent(
			"1 min",
		);
		expect(screen.getByText("Record en reps").parentElement).toHaveTextContent(
			"20 reps",
		);
		const history = within(
			screen.getByRole("region", { name: "Historique" }),
		).getAllByRole("link");
		expect(history).toHaveLength(3);
		expect(history[0]).toHaveTextContent("1 min · 1 min · 50 s");
		expect(history[1]).toHaveTextContent("En reps");
		expect(history[1]).toHaveTextContent("20 · 20 · 18 reps");
		expect(history[1]).toHaveClass("other-mode");
		expect(history[0]).not.toHaveClass("other-mode");

		await ui.click(screen.getByRole("radio", { name: "En reps" }));
		expect(screen.getByRole("region", { name: "Reps max" })).toHaveTextContent(
			"20 reps",
		);
		expect(history[0]).toHaveClass("other-mode");
		expect(history[0]).toHaveTextContent("Au temps");
	});
});

describe("template editor", () => {
	it("keeps the mode with the target", async () => {
		const template: Template = {
			id: "t1",
			name: "Push A",
			note: null,
			author: null,
			updatedAt: "2026-10-20T10:00:00Z",
			blocks: [
				{
					id: "tb1",
					position: 1,
					kind: "simple",
					rounds: 3,
					restSeconds: null,
					exercises: [
						{
							id: "ex1",
							exercise: crunch,
							mode: "reps",
							equipment: "bodyweight",
							note: null,
							grip: null,
							target: "20",
							sets: [],
						},
					],
				},
			],
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

		const modes = within(
			await screen.findByRole("group", { name: "Mode de Crunch" }),
		);
		await ui.click(modes.getByRole("button", { name: "Temps" }));
		const target = screen.getByRole("textbox", { name: "Cible pour Crunch" });
		await ui.clear(target);
		await ui.type(target, "1 min");
		await ui.click(
			screen.getByRole("button", { name: "Enregistrer le modèle" }),
		);

		await waitFor(() =>
			expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
				name: "Push A",
				blocks: [
					{
						id: "tb1",
						rounds: 3,
						exercises: [
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
			}),
		);
	});
});
