import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabBar } from "@/components/TabBar";
import type { Athlete, PlannedSessionSummary } from "@/lib/api/schemas";
import { tokenStore } from "@/lib/auth";
import { formatDay, toDay } from "@/lib/dates";
import { outlook } from "@/lib/planned";
import { AthletesPage } from "@/pages/AthletesPage";
import { createAppRouter } from "@/router";
import {
	type Call,
	mockApi,
	newClient,
	page,
	renderRoute,
	user,
} from "./helpers";

afterEach(() => {
	vi.unstubAllGlobals();
	tokenStore.clear();
});

const paul: Athlete = {
	id: "a1",
	name: "Paul",
	email: "paul@example.com",
	managed: false,
	weightUnit: "kg",
	linkedAt: "2026-11-03T10:00:00Z",
};

const lea: Athlete = {
	id: "a2",
	name: "Léa",
	email: "lea@example.com",
	managed: false,
	weightUnit: "kg",
	linkedAt: "2026-11-03T10:00:00Z",
};

function inDays(days: number): string {
	const date = new Date();
	date.setDate(date.getDate() + days);
	return toDay(date);
}

function summary(
	overrides: Partial<PlannedSessionSummary> = {},
): PlannedSessionSummary {
	return {
		id: "p1",
		athleteId: paul.id,
		author: { id: user.id, name: user.name },
		plannedOn: inDays(3),
		name: "Bas du corps",
		status: "sent",
		blockCount: 2,
		workoutCount: 0,
		updatedAt: "2026-11-10T10:00:00Z",
		...overrides,
	};
}

function sessionsByAthlete(byAthlete: Record<string, PlannedSessionSummary[]>) {
	return (call: Call) => {
		const athleteId = new URL(call.path, "http://localhost").searchParams.get(
			"athleteId",
		);
		return { status: 200, body: page(byAthlete[athleteId ?? ""] ?? []) };
	};
}

describe("outlook", () => {
	const day = "2026-11-10";

	it("picks the earliest session from today on that is not logged, drafts included", () => {
		const sessions = [
			summary({ id: "later", plannedOn: "2026-11-20" }),
			summary({ id: "draft", plannedOn: "2026-11-12", status: "draft" }),
			summary({ id: "done", plannedOn: "2026-11-10", workoutCount: 1 }),
			summary({ id: "past", plannedOn: "2026-11-03" }),
		];
		expect(outlook(sessions, day).next?.id).toBe("draft");
		expect(outlook(sessions, day).last?.id).toBe("done");
	});

	it("counts a session planned today as next", () => {
		expect(
			outlook([summary({ id: "today", plannedOn: day })], day).next?.id,
		).toBe("today");
	});

	it("has nothing next once every session is past or logged", () => {
		const sessions = [summary({ id: "past", plannedOn: "2026-11-03" })];
		expect(outlook(sessions, day)).toEqual({
			next: undefined,
			last: sessions[0],
		});
	});
});

describe("athletes tab", () => {
	it("shows for an account with at least one athlete", async () => {
		mockApi({
			"GET /v1/users/me/athletes": () => ({ status: 200, body: page([paul]) }),
		});
		await renderRoute(TabBar, "/tabs");

		const nav = screen.getByRole("navigation", {
			name: "Navigation principale",
		});
		expect(
			await within(nav).findByRole("link", { name: "Athlètes" }),
		).toHaveAttribute("href", "/athletes");
		expect(within(nav).getAllByRole("link")).toHaveLength(5);
	});

	it("stays hidden for an account nobody coaches with", async () => {
		const calls = mockApi({
			"GET /v1/users/me/athletes": () => ({ status: 200, body: page([]) }),
		});
		await renderRoute(TabBar, "/tabs");

		await vi.waitFor(() =>
			expect(
				calls.some((c) => c.path.startsWith("/v1/users/me/athletes")),
			).toBe(true),
		);
		const nav = screen.getByRole("navigation", {
			name: "Navigation principale",
		});
		expect(within(nav).queryByRole("link", { name: "Athlètes" })).toBeNull();
		expect(within(nav).getAllByRole("link")).toHaveLength(4);
	});
});

describe("athletes page", () => {
	it("shows each athlete's next session, or that nothing is planned", async () => {
		const next = inDays(3);
		const last = inDays(-2);
		mockApi({
			"GET /v1/users/me/athletes": () => ({
				status: 200,
				body: page([lea, paul]),
			}),
			"GET /v1/planned-sessions": sessionsByAthlete({
				a1: [
					summary({ id: "p3", plannedOn: inDays(9), name: "Haut du corps" }),
					summary({ id: "p2", plannedOn: next, name: "Bas du corps" }),
				],
				a2: [
					summary({
						id: "p1",
						athleteId: lea.id,
						plannedOn: last,
						workoutCount: 1,
					}),
				],
			}),
		});
		await renderRoute(AthletesPage, "/athletes");

		expect(
			screen.getByRole("heading", { level: 1, name: "Mes athlètes" }),
		).toBeVisible();
		const paulRow = await screen.findByRole("link", { name: /Paul/ });
		expect(paulRow).toHaveAttribute("href", "/athletes/a1");
		expect(
			await within(paulRow).findByText(
				`Prochaine : ${formatDay(next)} · Bas du corps`,
			),
		).toBeVisible();
		expect(within(paulRow).getByText("Prévue")).toBeVisible();

		const leaRow = screen.getByRole("link", { name: /Léa/ });
		expect(await within(leaRow).findByText("Rien de prévu")).toBeVisible();
		expect(
			within(leaRow).getByText(`Dernière : ${formatDay(last)} · ✓ Notée`),
		).toBeVisible();
	});

	it("counts the coach's drafts as planned", async () => {
		mockApi({
			"GET /v1/users/me/athletes": () => ({ status: 200, body: page([paul]) }),
			"GET /v1/planned-sessions": sessionsByAthlete({
				a1: [summary({ status: "draft", name: "Brouillon du jeudi" })],
			}),
		});
		await renderRoute(AthletesPage, "/athletes");

		const row = await screen.findByRole("link", { name: /Paul/ });
		expect(await within(row).findByText(/Brouillon du jeudi/)).toBeVisible();
		expect(within(row).getByText("Brouillon")).toBeVisible();
		expect(within(row).queryByText("Rien de prévu")).toBeNull();
	});

	it("says when nobody has added the account as a coach", async () => {
		mockApi({
			"GET /v1/users/me/athletes": () => ({ status: 200, body: page([]) }),
		});
		await renderRoute(AthletesPage, "/athletes");

		expect(
			await screen.findByText("Personne ne t'a encore ajouté comme coach."),
		).toBeVisible();
	});
});

describe("athletes navigation", () => {
	async function renderApp(path: string) {
		mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/users/me/athletes": () => ({ status: 200, body: page([paul]) }),
			"GET /v1/users/me/athletes/a1": () => ({ status: 200, body: paul }),
			"GET /v1/planned-sessions": sessionsByAthlete({ a1: [summary()] }),
			"GET /v1/workouts": () => ({ status: 200, body: page([]) }),
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
		return router;
	}

	it("opens an athlete from the tab, which stays on", async () => {
		const router = await renderApp("/athletes");
		const ui = userEvent.setup();

		await ui.click(await screen.findByRole("link", { name: /Paul/ }));

		expect(
			await screen.findByRole("heading", { level: 1, name: "Paul" }),
		).toBeVisible();
		expect(router.state.location.pathname).toBe("/athletes/a1");
		const tab = within(
			screen.getByRole("navigation", { name: "Navigation principale" }),
		).getByRole("link", { name: "Athlètes" });
		expect(tab).toHaveClass("on");
	});

	it("sends an old coaching link to the athlete's new address", async () => {
		const router = await renderApp("/coaching/athletes/a1");

		expect(
			await screen.findByRole("heading", { level: 1, name: "Paul" }),
		).toBeVisible();
		expect(router.state.location.pathname).toBe("/athletes/a1");
	});
});
