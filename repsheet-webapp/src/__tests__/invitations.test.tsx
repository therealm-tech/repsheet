import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Athlete, Invitation } from "@/lib/api/schemas";
import { tokenStore } from "@/lib/auth";
import { createAppRouter } from "@/router";
import { mockApi, newClient, page, user } from "./helpers";

afterEach(() => {
	vi.unstubAllGlobals();
	tokenStore.clear();
});

const marc: Athlete = {
	id: "m1",
	name: "Marc",
	email: null,
	managed: true,
	weightUnit: "kg",
	linkedAt: "2026-11-03T10:00:00Z",
};

const invitation: Invitation = {
	athleteName: "Marc",
	coachName: "Lou",
	workoutCount: 6,
	expiresAt: "2026-11-18T10:00:00Z",
};

const token = { token: "t", expiresAt: "2099-01-01T00:00:00Z" };

function renderApp(path: string, handlers: Parameters<typeof mockApi>[0]) {
	const calls = mockApi({
		"GET /v1/users/me": () => ({ status: 200, body: user }),
		"GET /v1/users/me/athletes": () => ({ status: 200, body: page([marc]) }),
		"GET /v1/workouts": () => ({ status: 200, body: page([]) }),
		"GET /v1/planned-sessions": () => ({ status: 200, body: page([]) }),
		"GET /v1/templates": () => ({ status: 200, body: page([]) }),
		...handlers,
	});
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

describe("inviting an athlete without an account", () => {
	it("hands out a one-time link from the profile's page", async () => {
		tokenStore.set(token);
		renderApp("/athletes/m1", {
			"GET /v1/users/me/athletes/m1": () => ({ status: 200, body: marc }),
			"POST /v1/users/me/athletes/m1/invitations": () => ({
				status: 201,
				body: { token: "inv-123", expiresAt: invitation.expiresAt },
			}),
		});
		const ui = userEvent.setup();

		expect(
			await screen.findByRole("heading", { name: "Inviter Marc sur RepSheet" }),
		).toBeVisible();
		await ui.click(
			screen.getByRole("button", { name: "Créer un lien d'invitation" }),
		);

		const sheet = await screen.findByRole("dialog", { name: "Inviter Marc" });
		const link = `${window.location.origin}/invite/inv-123`;
		expect(within(sheet).getByText(link)).toBeVisible();
		await ui.click(within(sheet).getByRole("button", { name: "Copier" }));
		expect(await navigator.clipboard.readText()).toBe(
			`Guillaume t'invite sur RepSheet pour suivre tes séances : ${link}`,
		);
	});

	it("signs up into the profile from the link", async () => {
		const { router, calls } = renderApp("/invite/inv-123", {
			"GET /v1/invitations/inv-123": () => ({ status: 200, body: invitation }),
			"POST /v1/users": () => ({ status: 201, body: user }),
			"POST /v1/tokens": () => ({ status: 201, body: token }),
		});
		const ui = userEvent.setup();

		expect(
			await screen.findByText(
				"Lou t'invite sur RepSheet. Tes 6 séances et les prochaines t'attendent déjà.",
			),
		).toBeVisible();
		expect(screen.getByLabelText("Prénom")).toHaveValue("Marc");
		await ui.type(screen.getByLabelText("Email"), "marc@example.com");
		await ui.type(screen.getByLabelText("Mot de passe"), "correct horse");
		await ui.click(screen.getByRole("button", { name: "Créer mon compte" }));

		await waitFor(() => expect(router.state.location.pathname).toBe("/"));
		expect(
			calls.find((c) => c.method === "POST" && c.path === "/v1/users")?.body,
		).toMatchObject({
			name: "Marc",
			email: "marc@example.com",
			invitation: "inv-123",
		});
	});

	it("attaches the profile to an account it logs in with", async () => {
		const { router, calls } = renderApp("/invite/inv-123", {
			"GET /v1/invitations/inv-123": () => ({ status: 200, body: invitation }),
			"POST /v1/tokens": () => ({ status: 201, body: token }),
			"POST /v1/invitations/inv-123/acceptances": () => ({
				status: 201,
				body: {
					id: "c1",
					name: "Lou",
					email: "lou@example.com",
					linkedAt: "2026-11-11T10:00:00Z",
				},
			}),
		});
		const ui = userEvent.setup();

		await ui.click(await screen.findByText("Connexion"));
		expect(
			screen.getByText("Connecte-toi : ta fiche sera rattachée à ton compte."),
		).toBeVisible();
		await ui.type(screen.getByLabelText("Email"), "marc@example.com");
		await ui.type(screen.getByLabelText("Mot de passe"), "correct horse");
		await ui.click(screen.getByRole("button", { name: "Se connecter" }));

		await waitFor(() => expect(router.state.location.pathname).toBe("/"));
		const accepted = calls.find(
			(c) => c.path === "/v1/invitations/inv-123/acceptances",
		);
		expect(accepted?.headers).toMatchObject({ Authorization: "Bearer t" });
	});

	it("attaches the profile in one tap for an account already logged in", async () => {
		tokenStore.set(token);
		const { router, calls } = renderApp("/invite/inv-123", {
			"GET /v1/invitations/inv-123": () => ({ status: 200, body: invitation }),
			"POST /v1/invitations/inv-123/acceptances": () => ({
				status: 201,
				body: {
					id: "c1",
					name: "Lou",
					email: "lou@example.com",
					linkedAt: "2026-11-11T10:00:00Z",
				},
			}),
		});
		const ui = userEvent.setup();

		await ui.click(
			await screen.findByRole("button", { name: "Rattacher à mon compte" }),
		);

		await waitFor(() => expect(router.state.location.pathname).toBe("/"));
		expect(calls.some((c) => c.method === "POST")).toBe(true);
	});

	it("says when the link is no longer valid", async () => {
		renderApp("/invite/old", {});

		expect(
			await screen.findByText(
				"Ce lien d'invitation n'est plus valable. Demande un nouveau lien à ton coach.",
			),
		).toBeVisible();
	});
});
