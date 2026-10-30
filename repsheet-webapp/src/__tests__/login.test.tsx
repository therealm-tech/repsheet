import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tokenStore } from "@/lib/auth";
import { LoginPage } from "@/pages/LoginPage";
import { mockApi, renderRoute, user } from "./helpers";

const token = { token: "fresh-token", expiresAt: "2099-01-01T00:00:00Z" };

afterEach(() => {
	vi.unstubAllGlobals();
	tokenStore.clear();
});

describe("LoginPage", () => {
	it("registers then signs in, and lands on the home page", async () => {
		const calls = mockApi({
			"POST /v1/users": () => ({
				status: 201,
				body: { ...user, weightUnit: "lb" },
			}),
			"POST /v1/tokens": () => ({ status: 201, body: token }),
		});
		await renderRoute(LoginPage, "/login");
		const ui = userEvent.setup();

		await ui.click(screen.getByRole("radio", { name: "Créer un compte" }));
		await ui.type(screen.getByLabelText("Prénom"), "Guillaume");
		await ui.type(screen.getByLabelText("Email"), "g@example.com");
		await ui.type(screen.getByLabelText("Mot de passe"), "correct horse");
		await ui.click(screen.getByRole("radio", { name: "lb" }));
		await ui.click(screen.getByRole("button", { name: "Créer mon compte" }));

		expect(await screen.findByText("Accueil chargé")).toBeInTheDocument();
		expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
			"POST /v1/users",
			"POST /v1/tokens",
		]);
		expect(calls[0]?.body).toEqual({
			name: "Guillaume",
			email: "g@example.com",
			password: "correct horse",
			weightUnit: "lb",
			locale: "fr",
		});
		expect(tokenStore.get()).toEqual(token);
	});

	it("explains a wrong password", async () => {
		mockApi({
			"POST /v1/tokens": () => ({
				status: 401,
				body: { title: "Unauthorized", status: 401 },
			}),
		});
		await renderRoute(LoginPage, "/login");
		const ui = userEvent.setup();

		await ui.type(screen.getByLabelText("Email"), "g@example.com");
		await ui.type(screen.getByLabelText("Mot de passe"), "wrong");
		await ui.click(screen.getByRole("button", { name: "Se connecter" }));

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Email ou mot de passe incorrect.",
		);
		expect(tokenStore.get()).toBeNull();
	});

	it("validates the form before calling the API", async () => {
		const calls = mockApi({});
		await renderRoute(LoginPage, "/login");
		const ui = userEvent.setup();

		await ui.click(screen.getByRole("radio", { name: "Créer un compte" }));
		await ui.type(screen.getByLabelText("Prénom"), "G");
		await ui.type(screen.getByLabelText("Email"), "g@example.com");
		await ui.type(screen.getByLabelText("Mot de passe"), "short");
		await ui.click(screen.getByRole("button", { name: "Créer mon compte" }));

		await waitFor(() =>
			expect(screen.getByRole("alert")).toHaveTextContent(
				"8 caractères minimum.",
			),
		);
		expect(calls).toHaveLength(0);
	});

	it("reports an email that is already taken", async () => {
		mockApi({
			"POST /v1/users": () => ({
				status: 409,
				body: {
					type: "urn:repsheet:problem:email-taken",
					title: "Conflict",
					status: 409,
				},
			}),
		});
		await renderRoute(LoginPage, "/login");
		const ui = userEvent.setup();

		await ui.click(screen.getByRole("radio", { name: "Créer un compte" }));
		await ui.type(screen.getByLabelText("Prénom"), "G");
		await ui.type(screen.getByLabelText("Email"), "g@example.com");
		await ui.type(screen.getByLabelText("Mot de passe"), "long enough");
		await ui.click(screen.getByRole("button", { name: "Créer mon compte" }));

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Un compte existe déjà avec cet email.",
		);
	});
});
