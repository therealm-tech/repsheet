import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlockSheet } from "@/components/BlockSheet";
import { ExercisePicker } from "@/components/ExercisePicker";
import i18n from "@/i18n";
import { keys } from "@/lib/api/endpoints";
import type {
	Block,
	Exercise,
	Template,
	TemplateBlock,
	WorkoutSet,
} from "@/lib/api/schemas";
import { startingChoices, toggleOffer } from "@/lib/choices";
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
	vi.restoreAllMocks();
	await i18n.changeLanguage("fr");
});

const pulldown: Exercise = exercise({
	id: "pulldown",
	name: "Tirage vertical",
	equipment: ["cable"],
	defaultEquipment: "cable",
	grips: ["pronation", "supination", "neutral"],
	defaultGrip: "pronation",
});

const squat: Exercise = exercise({ id: "squat", name: "Squat" });

function lifted(weightKg: number, reps = 10): WorkoutSet[] {
	return [
		{
			round: 1,
			reps,
			weightKg,
			durationSeconds: null,
			distanceMeters: null,
			warmup: false,
		},
	];
}

function client() {
	const c = newClient();
	c.setQueryData(keys.me, user);
	return c;
}

const savedBlock = {
	id: "b1",
	position: 1,
	kind: "simple",
	templateBlockId: null,
	restSeconds: null,
	exercises: [],
};

describe("choices", () => {
	it("starts a block with the planned grip, the default one, or none when unplanned", () => {
		expect(startingChoices(pulldown).grip).toBe("pronation");
		expect(startingChoices(squat).grip).toBeNull();
		const planned = { mode: "reps", equipment: "cable" } as const;
		expect(
			startingChoices(pulldown, { ...planned, grip: "neutral" }).grip,
		).toBe("neutral");
		expect(startingChoices(pulldown, { ...planned, grip: null }).grip).toBe(
			null,
		);
		expect(startingChoices(pulldown, { ...planned, grip: "mixed" }).grip).toBe(
			"pronation",
		);
	});

	it("lets the grips go empty, but never the modes", () => {
		const all = ["pronation", "supination", "neutral", "mixed"] as const;
		let grips = toggleOffer(
			all,
			{ values: [], defaultValue: null },
			"mixed",
			false,
		);
		expect(grips).toEqual({ values: ["mixed"], defaultValue: "mixed" });
		grips = toggleOffer(all, grips, "pronation", false);
		expect(grips).toEqual({
			values: ["pronation", "mixed"],
			defaultValue: "mixed",
		});
		grips = toggleOffer(all, grips, "mixed", false);
		expect(grips).toEqual({
			values: ["pronation"],
			defaultValue: "pronation",
		});
		expect(toggleOffer(all, grips, "pronation", false)).toEqual({
			values: [],
			defaultValue: null,
		});
		const modes = { values: ["reps" as const], defaultValue: "reps" as const };
		expect(toggleOffer(["reps", "time"], modes, "reps", true)).toBe(modes);
	});
});

describe("exercise form", () => {
	it("creates an exercise without grips unless some are picked", async () => {
		const calls = mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/exercises": () => ({ status: 200, body: page([]) }),
			"POST /v1/exercises": () => ({ status: 201, body: pulldown }),
		});
		renderWithClient(<ExercisePicker onSelect={vi.fn()} />);
		const ui = userEvent.setup();

		await ui.type(screen.getByRole("searchbox"), "Tirage nuque");
		await ui.click(
			await screen.findByRole("button", { name: "＋ Créer « Tirage nuque »" }),
		);
		const grips = within(screen.getByRole("group", { name: "Prises" }));
		await ui.click(grips.getByRole("button", { name: "Pronation" }));
		await ui.click(grips.getByRole("button", { name: "Neutre" }));
		await ui.click(
			within(screen.getByRole("group", { name: "Prise par défaut" })).getByRole(
				"button",
				{ name: "Neutre" },
			),
		);
		await ui.click(screen.getByRole("button", { name: "Créer l'exercice" }));

		await waitFor(() =>
			expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({
				grips: ["pronation", "neutral"],
				defaultGrip: "neutral",
			}),
		);
	});

	it("leaves no default once every grip is removed", async () => {
		const calls = mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/exercises": () => ({ status: 200, body: page([]) }),
			"POST /v1/exercises": () => ({ status: 201, body: squat }),
		});
		renderWithClient(<ExercisePicker onSelect={vi.fn()} />);
		const ui = userEvent.setup();

		await ui.type(screen.getByRole("searchbox"), "Hack squat");
		await ui.click(
			await screen.findByRole("button", { name: "＋ Créer « Hack squat »" }),
		);
		const grips = within(screen.getByRole("group", { name: "Prises" }));
		await ui.click(grips.getByRole("button", { name: "Mixte" }));
		await ui.click(grips.getByRole("button", { name: /Mixte/ }));
		await ui.click(screen.getByRole("button", { name: "Créer l'exercice" }));

		await waitFor(() =>
			expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({
				grips: [],
				defaultGrip: null,
			}),
		);
	});
});

describe("BlockSheet", () => {
	it("opens with the default grip and switches grips, confirming before it replaces the loads", async () => {
		const calls = mockApi({
			"GET /v1/exercises": () => ({ status: 200, body: page([pulldown]) }),
			"GET /v1/exercises/pulldown/performances": (call) => ({
				status: 200,
				body: page(
					call.path.includes("grip=supination")
						? [
								performance(
									lifted(60, 8),
									"2026-10-08",
									"reps",
									"cable",
									"supination",
								),
							]
						: [
								performance(
									lifted(50),
									"2026-10-15",
									"reps",
									"cable",
									"pronation",
								),
							],
				),
			}),
			"POST /v1/workouts/w1/blocks": () => ({ status: 201, body: savedBlock }),
		});
		const onClose = vi.fn();
		renderWithClient(
			<BlockSheet workoutId="w1" mode={{ kind: "new" }} onClose={onClose} />,
			client(),
		);
		const ui = userEvent.setup();

		await ui.click(await screen.findByText("Tirage vertical"));
		expect(await screen.findByText(/Dernière fois/)).toHaveTextContent(
			"Dernière fois en pronation (15 oct.) : 1×10 · 50 kg",
		);
		expect(calls.some((c) => c.path.includes("grip=pronation"))).toBeTruthy();

		const grip = within(
			screen.getByRole("group", { name: "Prise de Tirage vertical" }),
		);
		expect(
			grip.getByRole("button", { name: "Pronation", pressed: true }),
		).toBeInTheDocument();
		await ui.click(grip.getByRole("button", { name: "Supination" }));
		expect(
			screen.getByText(
				"Faire Tirage vertical en supination ? Les charges déjà saisies en pronation seront effacées.",
			),
		).toBeInTheDocument();
		await ui.click(screen.getByRole("button", { name: "Changer" }));
		expect(
			await screen.findByRole("button", {
				name: "Tour 1, A Tirage vertical : 10 reps 60 kg",
			}),
		).toBeInTheDocument();

		await ui.click(screen.getByRole("button", { name: "Enregistrer le bloc" }));
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(calls.find((c) => c.method === "POST")?.body).toEqual({
			exercises: [
				{
					exerciseId: "pulldown",
					mode: "reps",
					equipment: "cable",
					grip: "supination",
					sets: [{ round: 1, warmup: false, reps: 10, weightKg: 60 }],
				},
			],
		});
	});

	it("opens a planned block with the template's grip, or none when it plans none", async () => {
		const calls = mockApi({
			"GET /v1/exercises/pulldown/performances": () => ({
				status: 200,
				body: page([]),
			}),
		});
		const templateBlock: TemplateBlock = {
			id: "tb1",
			position: 1,
			kind: "superset",
			rounds: 1,
			restSeconds: null,
			exercises: [
				{
					id: "ex1",
					exercise: pulldown,
					mode: "reps",
					equipment: "cable",
					note: null,
					grip: "neutral",
					target: "10",
					sets: [],
				},
				{
					id: "ex2",
					exercise: pulldown,
					mode: "reps",
					equipment: "cable",
					note: null,
					grip: null,
					target: "10",
					sets: [],
				},
			],
		};
		renderWithClient(
			<BlockSheet
				workoutId="w1"
				mode={{ kind: "new", templateBlock }}
				onClose={vi.fn()}
			/>,
			client(),
		);

		const [planned, unplanned] = (
			await screen.findAllByRole("group", { name: "Prise de Tirage vertical" })
		).map((group) => within(group));
		expect(
			planned?.getByRole("button", { name: "Neutre", pressed: true }),
		).toBeInTheDocument();
		expect(unplanned?.getAllByRole("button", { pressed: false })).toHaveLength(
			3,
		);
		const paths = calls.map((c) => c.path);
		expect(paths.some((p) => p.includes("grip=neutral"))).toBeTruthy();
		expect(paths.some((p) => p.includes("grip=none"))).toBeTruthy();
	});

	it("edits a block that holds the same exercise twice", async () => {
		const duplicateKey = vi.spyOn(console, "error");
		const calls = mockApi({
			"GET /v1/exercises/pulldown/performances": () => ({
				status: 200,
				body: page([]),
			}),
			"PUT /v1/workouts/w1/blocks/b1": () => ({
				status: 200,
				body: savedBlock,
			}),
		});
		const block: Block = {
			...savedBlock,
			kind: "superset",
			exercises: [
				{
					id: "ex3",
					exercise: pulldown,
					mode: "reps",
					equipment: "cable",
					comments: [],
					grip: null,
					sets: lifted(50),
				},
				{
					id: "ex4",
					exercise: pulldown,
					mode: "reps",
					equipment: "cable",
					comments: [],
					grip: "neutral",
					sets: lifted(55),
				},
			],
		};
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

		expect(
			await screen.findByRole("button", {
				name: "Tour 1, B Tirage vertical : 10 reps 55 kg",
			}),
		).toBeInTheDocument();
		await ui.click(screen.getByRole("button", { name: "Enregistrer le bloc" }));
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(calls.find((c) => c.method === "PUT")?.body).toMatchObject({
			exercises: [{ grip: null }, { grip: "neutral" }],
		});
		expect(
			duplicateKey.mock.calls.some((args) =>
				String(args[0]).includes("same key"),
			),
		).toBe(false);
	});
});

describe("exercise detail", () => {
	it("charts one grip at a time, the history with no grip as a series of its own", async () => {
		mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/exercises/pulldown": () => ({ status: 200, body: pulldown }),
			"GET /v1/exercises/pulldown/performances": () => ({
				status: 200,
				body: page([
					performance(lifted(52.5), "2026-10-22", "reps", "cable", "pronation"),
					performance(lifted(60), "2026-10-15", "reps", "cable", "supination"),
					performance(lifted(50), "2026-10-08", "reps", "cable", "pronation"),
					performance(lifted(45), "2026-10-01", "reps", "cable", null),
				]),
			}),
		});
		await renderRoute(
			() => <ExerciseDetailPage exerciseId="pulldown" />,
			"/exercises/pulldown",
		);
		const ui = userEvent.setup();

		expect(
			await screen.findByRole("radio", { name: "Pronation", checked: true }),
		).toBeInTheDocument();
		const chart = await screen.findByRole("region", { name: "Charge max" });
		expect(chart).toHaveTextContent("52,5 kg");
		expect(chart).toHaveTextContent("+2,5 kg depuis le début");
		const history = within(
			screen.getByRole("region", { name: "Historique" }),
		).getAllByRole("link");
		expect(history).toHaveLength(4);
		expect(history[1]).toHaveTextContent("Prise supination");
		expect(history[1]).toHaveClass("other-mode");
		expect(history[3]).toHaveTextContent("Prise non précisée");

		await ui.click(screen.getByRole("radio", { name: "Non précisée" }));
		expect(
			screen.getByRole("region", { name: "Charge max" }),
		).toHaveTextContent("45 kg");
		expect(history[3]).not.toHaveClass("other-mode");
		expect(history[0]).toHaveTextContent("Prise pronation");
	});

	it("offers no grip choice for an exercise without grips", async () => {
		mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/exercises/squat": () => ({ status: 200, body: squat }),
			"GET /v1/exercises/squat/performances": () => ({
				status: 200,
				body: page([performance(lifted(100), "2026-10-22")]),
			}),
		});
		await renderRoute(
			() => <ExerciseDetailPage exerciseId="squat" />,
			"/exercises/squat",
		);

		expect(
			await screen.findByRole("region", { name: "Charge max" }),
		).toHaveTextContent("100 kg");
		expect(
			screen.queryByRole("group", { name: "Prise affichée" }),
		).not.toBeInTheDocument();
	});
});

describe("template editor", () => {
	it("plans a grip with the target", async () => {
		const template: Template = {
			id: "t1",
			name: "Dos",
			note: null,
			author: null,
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
							id: "ex5",
							exercise: pulldown,
							mode: "reps",
							equipment: "cable",
							note: null,
							grip: null,
							target: "10",
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

		const grip = within(
			await screen.findByRole("group", { name: "Prise de Tirage vertical" }),
		);
		await ui.click(grip.getByRole("button", { name: "Supination" }));
		await ui.click(
			screen.getByRole("button", { name: "Enregistrer le modèle" }),
		);

		await waitFor(() =>
			expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
				name: "Dos",
				blocks: [
					{
						id: "tb1",
						exercises: [
							{
								exerciseId: "pulldown",
								mode: "reps",
								equipment: "cable",
								grip: "supination",
								target: "10",
							},
						],
					},
				],
			}),
		);
	});
});
