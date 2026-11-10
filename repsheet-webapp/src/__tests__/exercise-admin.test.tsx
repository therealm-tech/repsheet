import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExercisePicker } from "@/components/ExercisePicker";
import type { Exercise, User } from "@/lib/api/schemas";
import { ExerciseDetailPage } from "@/pages/ExerciseDetailPage";
import {
	admin,
	exercise,
	mockApi,
	page,
	renderRoute,
	renderWithClient,
	user,
} from "./helpers";

afterEach(() => vi.unstubAllGlobals());

const builtIn = exercise({ id: "e1", name: "Squat" });
const custom = exercise({
	id: "e1",
	name: "Dév. Arnold",
	equipment: ["dumbbell"],
	defaultEquipment: "dumbbell",
	custom: true,
});

function detail(me: User, ex: Exercise, extra = {}) {
	const calls = mockApi({
		"GET /v1/users/me": () => ({ status: 200, body: me }),
		"GET /v1/exercises/e1": () => ({ status: 200, body: ex }),
		"GET /v1/exercises/e1/performances": () => ({
			status: 200,
			body: page([]),
		}),
		...extra,
	});
	return {
		calls,
		render: () =>
			renderRoute(
				() => <ExerciseDetailPage exerciseId="e1" />,
				"/exercises/e1",
			),
	};
}

describe("exercise detail permissions", () => {
	it("lets the owner manage a custom exercise", async () => {
		await detail(user, custom).render();
		expect(
			await screen.findByRole("button", { name: "Modifier" }),
		).toBeInTheDocument();
		expect(screen.getByText("Supprimer l'exercice")).toBeInTheDocument();
	});

	it("hides the actions on a catalog exercise for a regular user", async () => {
		await detail(user, builtIn).render();
		expect(
			await screen.findByRole("heading", { name: "Squat" }),
		).toBeInTheDocument();
		await screen.findByText(/Pas encore de série/);
		expect(
			screen.queryByRole("button", { name: "Modifier" }),
		).not.toBeInTheDocument();
		expect(screen.queryByText("Supprimer l'exercice")).not.toBeInTheDocument();
	});

	it("lets a super admin manage a catalog exercise", async () => {
		await detail(admin, builtIn).render();
		expect(
			await screen.findByRole("button", { name: "Modifier" }),
		).toBeInTheDocument();
		expect(screen.getByText("Catalogue")).toBeInTheDocument();
	});

	it("edits with the create form fields and shows a 409 inline", async () => {
		let attempts = 0;
		const { calls, render } = detail(user, custom, {
			"PUT /v1/exercises/e1": () => {
				attempts += 1;
				return attempts === 1
					? {
							status: 409,
							body: {
								type: "urn:repsheet:problem:mode-locked",
								title: "Conflict",
								status: 409,
								detail: "a mode with logged sets cannot be removed",
							},
						}
					: { status: 200, body: { ...custom, name: "Arnold press" } };
			},
		});
		await render();
		const ui = userEvent.setup();

		await ui.click(await screen.findByRole("button", { name: "Modifier" }));
		const form = screen.getByRole("form", { name: "Modifier l'exercice" });
		expect(form).toBeInTheDocument();
		expect(
			screen.queryByLabelText(/Ajouter au catalogue/),
		).not.toBeInTheDocument();
		// The names change too: the problem type, not the edit, decides the message.
		await ui.type(
			screen.getByLabelText("Nom en anglais (optionnel)"),
			"Arnold",
		);
		const modes = within(screen.getByRole("group", { name: "Se compte en" }));
		await ui.click(modes.getByRole("button", { name: "Temps" }));
		expect(
			within(screen.getByRole("group", { name: "Par défaut" })).getByRole(
				"button",
				{ name: "Reps", pressed: true },
			),
		).toBeInTheDocument();
		await ui.click(modes.getByRole("button", { name: "Reps" }));
		expect(
			screen.queryByRole("group", { name: "Par défaut" }),
		).not.toBeInTheDocument();
		await ui.click(screen.getByRole("button", { name: "Enregistrer" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Ce mode a déjà des séries enregistrées : il ne peut pas être retiré.",
		);

		await ui.click(modes.getByRole("button", { name: "Reps" }));
		await ui.clear(screen.getByLabelText("Nom en anglais (optionnel)"));
		const name = screen.getByLabelText("Nom");
		await ui.clear(name);
		await ui.type(name, "Arnold press");
		await ui.click(screen.getByRole("button", { name: "Enregistrer" }));

		await waitFor(() =>
			expect(
				screen.queryByRole("form", { name: "Modifier l'exercice" }),
			).not.toBeInTheDocument(),
		);
		expect(calls.filter((c) => c.method === "PUT").at(-1)?.body).toEqual({
			names: { fr: "Arnold press" },
			modes: ["reps", "time"],
			defaultMode: "time",
			load: "required",
			equipment: ["dumbbell"],
			defaultEquipment: "dumbbell",
			unilateral: false,
		});
	});

	it("deletes after confirming and reports an exercise still in use", async () => {
		const { calls, render } = detail(user, custom, {
			"DELETE /v1/exercises/e1": () => ({
				status: 409,
				body: {
					type: "urn:repsheet:problem:exercise-in-use",
					title: "Conflict",
					status: 409,
					detail: "exercise is referenced by a workout",
				},
			}),
		});
		await render();
		const ui = userEvent.setup();

		await ui.click(await screen.findByText("Supprimer l'exercice"));
		expect(calls.some((c) => c.method === "DELETE")).toBe(false);
		await ui.click(
			screen.getByRole("button", { name: "Confirmer la suppression" }),
		);

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Cet exercice est utilisé dans une séance ou un modèle : il ne peut pas être supprimé.",
		);
		expect(calls.find((c) => c.method === "DELETE")?.path).toBe(
			"/v1/exercises/e1",
		);
	});
});

describe("catalog toggle on creation", () => {
	function picker(me: User) {
		const calls = mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: me }),
			"GET /v1/exercises": () => ({ status: 200, body: page([]) }),
			"POST /v1/exercises": () => ({ status: 201, body: builtIn }),
		});
		renderWithClient(<ExercisePicker onSelect={vi.fn()} />);
		return calls;
	}

	it("lets a super admin add an exercise to the catalog", async () => {
		const calls = picker(admin);
		const ui = userEvent.setup();

		await ui.type(screen.getByRole("searchbox"), "Squat");
		await ui.click(
			await screen.findByRole("button", { name: "＋ Créer « Squat »" }),
		);
		await ui.click(
			await screen.findByLabelText("Ajouter au catalogue (visible par tous)"),
		);
		expect(screen.getByLabelText("Nom en français")).toHaveValue("Squat");
		await ui.click(screen.getByRole("button", { name: "Créer l'exercice" }));
		expect(screen.getByRole("alert")).toHaveTextContent(
			"Le nom en anglais est obligatoire.",
		);
		await ui.type(screen.getByLabelText("Nom en anglais"), "Back squat");
		await ui.click(screen.getByRole("button", { name: "Créer l'exercice" }));

		await waitFor(() =>
			expect(calls.find((c) => c.method === "POST")?.body).toEqual({
				names: { fr: "Squat", en: "Back squat" },
				modes: ["reps"],
				defaultMode: "reps",
				load: "required",
				equipment: ["barbell"],
				defaultEquipment: "barbell",
				unilateral: false,
				builtIn: true,
			}),
		);
	});

	it("never offers it to a regular user", async () => {
		const calls = picker(user);
		const ui = userEvent.setup();

		await ui.type(screen.getByRole("searchbox"), "Squat");
		await ui.click(
			await screen.findByRole("button", { name: "＋ Créer « Squat »" }),
		);
		await waitFor(() =>
			expect(calls.some((c) => c.path === "/v1/users/me")).toBe(true),
		);
		expect(
			screen.queryByLabelText(/Ajouter au catalogue/),
		).not.toBeInTheDocument();
		await ui.click(screen.getByRole("button", { name: "Créer l'exercice" }));

		await waitFor(() =>
			expect(calls.find((c) => c.method === "POST")?.body).toEqual({
				names: { fr: "Squat" },
				modes: ["reps"],
				defaultMode: "reps",
				load: "required",
				equipment: ["barbell"],
				defaultEquipment: "barbell",
				unilateral: false,
			}),
		);
	});
});
