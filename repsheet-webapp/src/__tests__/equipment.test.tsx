import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlockSheet } from "@/components/BlockSheet";
import { ExercisePicker } from "@/components/ExercisePicker";
import i18n from "@/i18n";
import { keys } from "@/lib/api/endpoints";
import type { Exercise, Template, WorkoutSet } from "@/lib/api/schemas";
import { ExerciseDetailPage } from "@/pages/ExerciseDetailPage";
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

afterEach(async () => {
	vi.unstubAllGlobals();
	await i18n.changeLanguage("fr");
});

const press: Exercise = exercise({
	id: "press",
	name: "Développé militaire",
	equipment: ["barbell", "dumbbell"],
	defaultEquipment: "barbell",
});

function lifted(weightKg: number): WorkoutSet[] {
	return [
		{
			round: 1,
			reps: 8,
			weightKg,
			durationSeconds: null,
			distanceMeters: null,
			warmup: false,
		},
	];
}

describe("exercise form", () => {
	it("creates an exercise done with several kinds of equipment, with a default one", async () => {
		const calls = mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/exercises": () => ({ status: 200, body: page([]) }),
			"POST /v1/exercises": () => ({ status: 201, body: press }),
		});
		renderWithClient(<ExercisePicker onSelect={vi.fn()} />);
		const ui = userEvent.setup();

		await ui.type(screen.getByRole("searchbox"), "Développé Arnold");
		await ui.click(
			await screen.findByRole("button", {
				name: "＋ Créer « Développé Arnold »",
			}),
		);
		expect(
			screen.queryByRole("group", { name: "Matériel par défaut" }),
		).not.toBeInTheDocument();
		const equipment = within(screen.getByRole("group", { name: "Matériel" }));
		await ui.click(equipment.getByRole("button", { name: "Haltères" }));
		await ui.click(
			within(
				screen.getByRole("group", { name: "Matériel par défaut" }),
			).getByRole("button", { name: "Haltères" }),
		);
		await ui.click(screen.getByRole("button", { name: "Créer l'exercice" }));

		await waitFor(() =>
			expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({
				equipment: ["barbell", "dumbbell"],
				defaultEquipment: "dumbbell",
			}),
		);
	});

	it("never leaves an exercise without equipment", async () => {
		mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/exercises": () => ({ status: 200, body: page([]) }),
		});
		renderWithClient(<ExercisePicker onSelect={vi.fn()} />);
		const ui = userEvent.setup();

		await ui.click(
			await screen.findByRole("button", { name: "＋ Créer un exercice" }),
		);
		const equipment = within(screen.getByRole("group", { name: "Matériel" }));
		await ui.click(equipment.getByRole("button", { name: "Barre" }));
		expect(
			equipment.getByRole("button", { name: "Barre", pressed: true }),
		).toBeInTheDocument();
	});
});

describe("exercise picker", () => {
	it("lists every equipment of an exercise and finds it under each", async () => {
		mockApi({
			"GET /v1/exercises": () => ({ status: 200, body: page([press]) }),
		});
		renderWithClient(<ExercisePicker onSelect={vi.fn()} />);
		const ui = userEvent.setup();

		expect(
			await screen.findByText("Barre ou haltères · reps · charge"),
		).toBeInTheDocument();
		await ui.click(screen.getByRole("button", { name: "Haltères" }));
		expect(screen.getByText("Développé militaire")).toBeInTheDocument();
		await ui.click(screen.getByRole("button", { name: "Poulie" }));
		expect(screen.queryByText("Développé militaire")).not.toBeInTheDocument();

		await i18n.changeLanguage("en");
		await ui.click(screen.getByRole("button", { name: "All" }));
		expect(
			await screen.findByText("Barbell or dumbbells · reps · load"),
		).toBeInTheDocument();
	});
});

describe("BlockSheet", () => {
	it("switches a column to other equipment, confirming before it replaces the loads", async () => {
		const calls = mockApi({
			"GET /v1/exercises": () => ({ status: 200, body: page([press]) }),
			"GET /v1/exercises/press/performances": (call) => ({
				status: 200,
				body: page(
					call.path.includes("equipment=dumbbell")
						? [performance(lifted(22), "2026-10-08", "reps", "dumbbell")]
						: [performance(lifted(60), "2026-10-15")],
				),
			}),
			"POST /v1/workouts/w1/blocks": () => ({
				status: 201,
				body: {
					id: "b1",
					position: 1,
					kind: "simple",
					templateBlockId: null,
					restSeconds: null,
					exercises: [],
				},
			}),
		});
		const client = newClient();
		client.setQueryData(keys.me, user);
		const onClose = vi.fn();
		renderWithClient(
			<BlockSheet workoutId="w1" mode={{ kind: "new" }} onClose={onClose} />,
			client,
		);
		const ui = userEvent.setup();

		await ui.click(await screen.findByText("Développé militaire"));
		expect(
			await screen.findByRole("button", {
				name: "Tour 1, A Développé militaire : 8 reps 60 kg",
			}),
		).toBeInTheDocument();
		expect(await screen.findByText(/Dernière fois/)).toHaveTextContent(
			"Dernière fois à la barre (15 oct.) : 1×8 · 60 kg",
		);

		const equipment = within(
			screen.getByRole("group", { name: "Matériel de Développé militaire" }),
		);
		await ui.click(equipment.getByRole("button", { name: "Haltères" }));
		expect(
			screen.getByText(
				"Faire Développé militaire aux haltères ? Les charges déjà saisies à la barre seront effacées.",
			),
		).toBeInTheDocument();
		await ui.click(screen.getByRole("button", { name: "Changer" }));
		expect(
			await screen.findByRole("button", {
				name: "Tour 1, A Développé militaire : 8 reps 22 kg",
			}),
		).toBeInTheDocument();
		expect(await screen.findByText(/Dernière fois/)).toHaveTextContent(
			"Dernière fois aux haltères (8 oct.) : 1×8 · 22 kg",
		);

		await ui.click(screen.getByRole("button", { name: "Enregistrer le bloc" }));
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(calls.find((c) => c.method === "POST")?.body).toEqual({
			exercises: [
				{
					exerciseId: "press",
					mode: "reps",
					equipment: "dumbbell",
					sets: [{ round: 1, warmup: false, reps: 8, weightKg: 22 }],
				},
			],
		});
	});
});

describe("exercise detail", () => {
	it("charts one equipment at a time and keeps every entry in the history", async () => {
		mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/exercises/press": () => ({ status: 200, body: press }),
			"GET /v1/exercises/press/performances": () => ({
				status: 200,
				body: page([
					performance(lifted(62.5), "2026-10-22"),
					performance(lifted(22), "2026-10-15", "reps", "dumbbell"),
					performance(lifted(60), "2026-10-08"),
				]),
			}),
		});
		await renderRoute(
			() => <ExerciseDetailPage exerciseId="press" />,
			"/exercises/press",
		);
		const ui = userEvent.setup();

		expect(
			await screen.findByRole("radio", { name: "Barre", checked: true }),
		).toBeInTheDocument();
		const chart = await screen.findByRole("region", { name: "Charge max" });
		expect(chart).toHaveTextContent("62,5 kg");
		expect(chart).toHaveTextContent("+2,5 kg depuis le début");
		expect(screen.getByText("Record").parentElement).toHaveTextContent(
			"62,5×8",
		);
		const history = within(
			screen.getByRole("region", { name: "Historique" }),
		).getAllByRole("link");
		expect(history).toHaveLength(3);
		expect(history[1]).toHaveTextContent("Haltères");
		expect(history[1]).toHaveClass("other-mode");
		expect(history[0]).not.toHaveClass("other-mode");

		await ui.click(screen.getByRole("radio", { name: "Haltères" }));
		const dumbbells = screen.getByRole("region", { name: "Charge max" });
		expect(dumbbells).toHaveTextContent("22 kg");
		expect(dumbbells).not.toHaveTextContent("depuis le début");
		expect(screen.getByText("Record").parentElement).toHaveTextContent("22×8");
		expect(history[0]).toHaveClass("other-mode");
		expect(history[0]).toHaveTextContent("Barre");
	});
});

describe("template editor", () => {
	it("keeps the equipment with the target", async () => {
		const template: Template = {
			id: "t1",
			name: "Épaules",
			note: null,
			updatedAt: "2026-10-20T10:00:00Z",
			blocks: [
				{
					id: "tb1",
					position: 1,
					kind: "simple",
					rounds: null,
					restSeconds: null,
					exercises: [
						{
							exercise: press,
							mode: "reps",
							equipment: "barbell",
							target: "8",
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

		const equipment = within(
			await screen.findByRole("group", {
				name: "Matériel de Développé militaire",
			}),
		);
		await ui.click(equipment.getByRole("button", { name: "Haltères" }));
		await ui.click(
			screen.getByRole("button", { name: "Enregistrer le modèle" }),
		);

		await waitFor(() =>
			expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
				name: "Épaules",
				blocks: [
					{
						id: "tb1",
						exercises: [
							{
								exerciseId: "press",
								mode: "reps",
								equipment: "dumbbell",
								target: "8",
							},
						],
					},
				],
			}),
		);
	});
});
