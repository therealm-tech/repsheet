import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExercisePicker } from "@/components/ExercisePicker";
import { exercise, mockApi, page, renderWithClient } from "./helpers";

const bench = exercise({ id: "bench", name: "Développé couché" });
const incline = exercise({
	id: "incline",
	name: "Développé incliné haltères",
	equipment: ["dumbbell"],
	defaultEquipment: "dumbbell",
	grips: [],
	defaultGrip: null,
});
const dips = exercise({
	id: "dips",
	name: "Dips",
	modes: ["reps"],
	defaultMode: "reps",
	load: "optional",
	equipment: ["bodyweight"],
	defaultEquipment: "bodyweight",
	grips: [],
	defaultGrip: null,
});

afterEach(() => vi.unstubAllGlobals());

describe("ExercisePicker", () => {
	it("toggles the filter on the user's own exercises", async () => {
		const mineOnly = exercise({ id: "mine", name: "Mon curl", custom: true });
		const calls = mockApi({
			"GET /v1/exercises": (call) => ({
				status: 200,
				body: page(
					call.path.includes("mine=true") ? [mineOnly] : [bench, dips],
				),
			}),
		});
		renderWithClient(<ExercisePicker onSelect={vi.fn()} />);
		const ui = userEvent.setup();

		expect(await screen.findByText("Dips")).toBeInTheDocument();
		expect(calls.at(-1)?.path).not.toContain("mine");
		const chip = screen.getByRole("button", { name: "Mes exercices" });
		expect(chip).toHaveAttribute("aria-pressed", "false");

		await ui.click(chip);
		await waitFor(() =>
			expect(screen.queryByText("Dips")).not.toBeInTheDocument(),
		);
		expect(await screen.findByText("Mon curl")).toBeInTheDocument();
		expect(chip).toHaveAttribute("aria-pressed", "true");
		expect(calls.at(-1)?.path).toContain("mine=true");

		await ui.click(chip);
		expect(await screen.findByText("Dips")).toBeInTheDocument();
		expect(calls.at(-1)?.path).not.toContain("mine");
	});

	it("searches the catalog and selects an exercise", async () => {
		const calls = mockApi({
			"GET /v1/exercises": (call) => ({
				status: 200,
				body: page(
					call.path.includes("q=dév") || call.path.includes("q=d%C3%A9v")
						? [bench, incline]
						: [bench, incline, dips],
				),
			}),
		});
		const onSelect = vi.fn();
		renderWithClient(<ExercisePicker onSelect={onSelect} />);
		const ui = userEvent.setup();

		expect(await screen.findByText("Dips")).toBeInTheDocument();
		expect(calls[0]?.path).toContain("sort=-lastUsedOn");

		await ui.type(
			screen.getByRole("searchbox", { name: "Rechercher un exercice" }),
			"dév",
		);
		await waitFor(() =>
			expect(screen.queryByText("Dips")).not.toBeInTheDocument(),
		);

		await ui.click(await screen.findByText("Développé incliné haltères"));
		expect(onSelect).toHaveBeenCalledWith(
			expect.objectContaining({ id: "incline" }),
		);
	});

	it("filters by equipment and hides excluded exercises", async () => {
		mockApi({
			"GET /v1/exercises": () => ({
				status: 200,
				body: page([bench, incline, dips]),
			}),
		});
		renderWithClient(
			<ExercisePicker onSelect={vi.fn()} excludeIds={["bench"]} />,
		);
		const ui = userEvent.setup();

		expect(await screen.findByText("Dips")).toBeInTheDocument();
		expect(screen.queryByText("Développé couché")).not.toBeInTheDocument();

		await ui.click(screen.getByRole("button", { name: "Haltères" }));
		expect(screen.queryByText("Dips")).not.toBeInTheDocument();
		expect(screen.getByText("Développé incliné haltères")).toBeInTheDocument();
	});

	it("creates a missing exercise from the search text", async () => {
		const created = exercise({
			id: "arnold",
			name: "Dév. Arnold",
			equipment: ["dumbbell"],
			defaultEquipment: "dumbbell",
			grips: [],
			defaultGrip: null,
			custom: true,
		});
		const calls = mockApi({
			"GET /v1/exercises": () => ({ status: 200, body: page([]) }),
			"POST /v1/exercises": () => ({ status: 201, body: created }),
		});
		const onSelect = vi.fn();
		renderWithClient(<ExercisePicker onSelect={onSelect} />);
		const ui = userEvent.setup();

		await ui.type(screen.getByRole("searchbox"), "Dév. Arnold");
		await ui.click(
			await screen.findByRole("button", { name: "＋ Créer « Dév. Arnold »" }),
		);
		expect(screen.getByLabelText("Nom")).toHaveValue("Dév. Arnold");
		const equipment = within(screen.getByRole("group", { name: "Matériel" }));
		await ui.click(equipment.getByRole("button", { name: "Haltères" }));
		await ui.click(equipment.getByRole("button", { name: "Barre" }));
		await ui.click(screen.getByRole("checkbox"));
		await ui.click(screen.getByRole("button", { name: "Créer l'exercice" }));

		await waitFor(() => expect(onSelect).toHaveBeenCalledWith(created));
		expect(calls.find((c) => c.method === "POST")?.body).toEqual({
			names: { fr: "Dév. Arnold" },
			modes: ["reps"],
			defaultMode: "reps",
			load: "required",
			equipment: ["dumbbell"],
			defaultEquipment: "dumbbell",
			grips: [],
			defaultGrip: null,
			unilateral: true,
		});
	});

	it("explains a duplicate name", async () => {
		mockApi({
			"GET /v1/exercises": () => ({ status: 200, body: page([]) }),
			"POST /v1/exercises": () => ({
				status: 409,
				body: {
					type: "urn:repsheet:problem:exercise-name-taken",
					title: "Conflict",
					status: 409,
				},
			}),
		});
		renderWithClient(<ExercisePicker onSelect={vi.fn()} />);
		const ui = userEvent.setup();

		await ui.type(screen.getByRole("searchbox"), "Squat");
		await ui.click(
			await screen.findByRole("button", { name: "＋ Créer « Squat »" }),
		);
		await ui.click(screen.getByRole("button", { name: "Créer l'exercice" }));

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Un exercice porte déjà ce nom.",
		);
	});
});
