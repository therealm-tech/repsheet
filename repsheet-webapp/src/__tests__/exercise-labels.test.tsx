import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExercisePicker } from "@/components/ExercisePicker";
import { ExerciseDetailPage } from "@/pages/ExerciseDetailPage";
import {
	exercise,
	mockApi,
	page,
	renderRoute,
	renderWithClient,
	user,
} from "./helpers";

afterEach(() => vi.unstubAllGlobals());

const bench = exercise({
	id: "bench",
	name: "Développé couché",
	labels: ["Programme A", "Push"],
});
const squat = exercise({ id: "squat", name: "Squat", labels: ["Jambes"] });
const dips = exercise({ id: "dips", name: "Dips" });
const known = page([
	{ name: "Jambes", exerciseCount: 1 },
	{ name: "Programme A", exerciseCount: 1 },
	{ name: "Push", exerciseCount: 1 },
]);

describe("exercise labels in the picker", () => {
	it("shows each exercise's labels as badges", async () => {
		mockApi({
			"GET /v1/exercises": () => ({
				status: 200,
				body: page([bench, squat, dips]),
			}),
			"GET /v1/exercise-labels": () => ({ status: 200, body: known }),
		});
		renderWithClient(<ExercisePicker onSelect={vi.fn()} />);

		const item = (await screen.findByText("Développé couché")).closest("li");
		expect(item).not.toBeNull();
		const badges = within(item as HTMLElement);
		expect(badges.getByText("Programme A")).toBeInTheDocument();
		expect(badges.getByText("Push")).toBeInTheDocument();
		expect(
			within(screen.getByText("Dips").closest("li") as HTMLElement).queryByText(
				"Push",
			),
		).not.toBeInTheDocument();
	});

	it("filters by a label, and stops filtering when it is pressed again", async () => {
		const calls = mockApi({
			"GET /v1/exercises": (call) => ({
				status: 200,
				body: page(
					call.path.includes("label=Jambes") ? [squat] : [bench, squat, dips],
				),
			}),
			"GET /v1/exercise-labels": () => ({ status: 200, body: known }),
		});
		const onSelect = vi.fn();
		renderWithClient(<ExercisePicker onSelect={onSelect} />);
		const ui = userEvent.setup();

		const filter = within(
			await screen.findByRole("group", { name: "Étiquettes" }),
		);
		await ui.click(filter.getByRole("button", { name: "Jambes" }));
		await waitFor(() =>
			expect(screen.queryByText("Dips")).not.toBeInTheDocument(),
		);
		expect(filter.getByRole("button", { name: "Jambes" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(calls.at(-1)?.path).toContain("label=Jambes");

		await ui.click(screen.getByText("Squat"));
		expect(onSelect).toHaveBeenCalledWith(
			expect.objectContaining({ id: "squat" }),
		);

		await ui.click(filter.getByRole("button", { name: "Jambes" }));
		expect(await screen.findByText("Dips")).toBeInTheDocument();
	});

	it("offers no label filter to a user without labels", async () => {
		mockApi({
			"GET /v1/exercises": () => ({ status: 200, body: page([dips]) }),
			"GET /v1/exercise-labels": () => ({ status: 200, body: page([]) }),
		});
		renderWithClient(<ExercisePicker onSelect={vi.fn()} />);

		expect(await screen.findByText("Dips")).toBeInTheDocument();
		expect(
			screen.queryByRole("group", { name: "Étiquettes" }),
		).not.toBeInTheDocument();
	});
});

describe("exercise labels on the exercise page", () => {
	function detail() {
		let current = bench;
		const calls = mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/exercises/bench": () => ({ status: 200, body: current }),
			"GET /v1/exercises/bench/performances": () => ({
				status: 200,
				body: page([]),
			}),
			"GET /v1/exercise-labels": () => ({ status: 200, body: known }),
			"PUT /v1/exercises/bench/labels": (call) => {
				const { labels } = call.body as { labels: string[] };
				current = { ...current, labels };
				return { status: 200, body: { labels } };
			},
		});
		return calls;
	}

	it("adds a label", async () => {
		const calls = detail();
		await renderRoute(
			() => <ExerciseDetailPage exerciseId="bench" />,
			"/exercises/bench",
		);
		const ui = userEvent.setup();

		await ui.type(
			await screen.findByRole("combobox", { name: "Nouvelle étiquette" }),
			" Pecs ",
		);
		await ui.click(screen.getByRole("button", { name: "Ajouter" }));

		const labels = within(
			screen.getByRole("region", { name: "Mes étiquettes" }),
		);
		expect(await labels.findByText("Pecs")).toBeInTheDocument();
		expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
			labels: ["Programme A", "Push", "Pecs"],
		});
		expect(
			screen.getByRole("combobox", { name: "Nouvelle étiquette" }),
		).toHaveValue("");
	});

	it("removes a label", async () => {
		const calls = detail();
		await renderRoute(
			() => <ExerciseDetailPage exerciseId="bench" />,
			"/exercises/bench",
		);
		const ui = userEvent.setup();

		await ui.click(
			await screen.findByRole("button", { name: "Retirer « Push »" }),
		);

		await waitFor(() =>
			expect(
				screen.queryByRole("button", { name: "Retirer « Push »" }),
			).not.toBeInTheDocument(),
		);
		expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
			labels: ["Programme A"],
		});
	});
});
