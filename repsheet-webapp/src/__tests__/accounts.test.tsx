import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tokenStore } from "@/lib/auth";
import { AccountsPage } from "@/pages/AccountsPage";
import { HomePage } from "@/pages/HomePage";
import { admin, mockApi, page, renderRoute, user } from "./helpers";

const bob = { ...user, id: "bob", name: "Bob", email: "bob@example.com" };

afterEach(() => {
	vi.unstubAllGlobals();
	tokenStore.clear();
});

describe("AccountsPage", () => {
	it("sends a regular user back home", async () => {
		const calls = mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
		});
		await renderRoute(AccountsPage, "/admin/accounts");

		expect(await screen.findByText("Accueil chargé")).toBeInTheDocument();
		expect(calls.some((c) => c.path.startsWith("/v1/users?"))).toBe(false);
	});

	it("lists accounts and hides actions on your own row", async () => {
		mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: admin }),
			"GET /v1/users": () => ({ status: 200, body: page([admin, bob]) }),
		});
		await renderRoute(AccountsPage, "/admin/accounts");

		const own = await screen.findByRole("listitem", { name: admin.email });
		expect(
			within(own).getByText("Super admin", { selector: ".tag" }),
		).toBeInTheDocument();
		expect(within(own).queryByRole("radio")).not.toBeInTheDocument();
		expect(
			within(own).queryByText("Supprimer le compte"),
		).not.toBeInTheDocument();

		const other = screen.getByRole("listitem", { name: bob.email });
		expect(
			within(other).getByText("Utilisateur", { selector: ".tag" }),
		).toBeInTheDocument();
		expect(within(other).getByText("Supprimer le compte")).toBeInTheDocument();
	});

	it("searches by name or email", async () => {
		const calls = mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: admin }),
			"GET /v1/users": () => ({ status: 200, body: page([bob]) }),
		});
		await renderRoute(AccountsPage, "/admin/accounts");
		const ui = userEvent.setup();

		await ui.type(
			await screen.findByRole("searchbox", { name: "Rechercher un compte" }),
			"bob",
		);
		await waitFor(() =>
			expect(calls.some((c) => c.path.includes("q=bob"))).toBe(true),
		);
	});

	it("promotes a user with the role toggle", async () => {
		const calls = mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: admin }),
			"GET /v1/users": () => ({ status: 200, body: page([admin, bob]) }),
			"PUT /v1/users/bob/role": () => ({
				status: 200,
				body: { ...bob, role: "superAdmin" },
			}),
		});
		await renderRoute(AccountsPage, "/admin/accounts");
		const ui = userEvent.setup();

		const row = await screen.findByRole("listitem", { name: bob.email });
		await ui.click(within(row).getByRole("radio", { name: "Super admin" }));

		await waitFor(() =>
			expect(calls.find((c) => c.method === "PUT")).toMatchObject({
				path: "/v1/users/bob/role",
				body: { role: "superAdmin" },
			}),
		);
	});

	it("deletes an account only after confirming", async () => {
		const calls = mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: admin }),
			"GET /v1/users": () => ({ status: 200, body: page([admin, bob]) }),
			"DELETE /v1/users/bob": () => ({ status: 204 }),
		});
		await renderRoute(AccountsPage, "/admin/accounts");
		const ui = userEvent.setup();

		const row = await screen.findByRole("listitem", { name: bob.email });
		await ui.click(within(row).getByText("Supprimer le compte"));
		expect(
			within(row).getByText(/Toutes ses séances.*supprimés définitivement/),
		).toBeVisible();
		expect(calls.some((c) => c.method === "DELETE")).toBe(false);

		await ui.click(within(row).getByRole("button", { name: "Supprimer Bob" }));
		await waitFor(() =>
			expect(calls.find((c) => c.method === "DELETE")?.path).toBe(
				"/v1/users/bob",
			),
		);
	});

	it("shows the API's refusal inline", async () => {
		mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: admin }),
			"GET /v1/users": () => ({ status: 200, body: page([admin, bob]) }),
			"PUT /v1/users/bob/role": () => ({
				status: 403,
				body: {
					type: "urn:repsheet:problem:forbidden",
					title: "Forbidden",
					status: 403,
					detail: "Seul un super admin peut changer un rôle.",
				},
			}),
		});
		await renderRoute(AccountsPage, "/admin/accounts");
		const ui = userEvent.setup();

		const row = await screen.findByRole("listitem", { name: bob.email });
		await ui.click(within(row).getByRole("radio", { name: "Super admin" }));
		// The API's English detail is for developers; the UI maps the problem type.
		expect(await within(row).findByRole("alert")).toHaveTextContent(
			"Tu n'as pas le droit de faire ça.",
		);
	});
});

describe("account menu", () => {
	function home(me: typeof user) {
		return mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: me }),
			"GET /v1/workouts": () => ({ status: 200, body: page([]) }),
		});
	}

	it("offers the accounts screen and the badge to a super admin", async () => {
		home(admin);
		await renderRoute(HomePage, "/dashboard");
		const ui = userEvent.setup();

		await ui.click(await screen.findByRole("button", { name: "Mon compte" }));
		expect(await screen.findByText("Super admin")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Comptes" })).toHaveAttribute(
			"href",
			"/admin/accounts",
		);
	});

	it("shows neither to a regular user", async () => {
		home(user);
		await renderRoute(HomePage, "/dashboard");
		const ui = userEvent.setup();

		await screen.findByText("Salut Guillaume");
		await ui.click(screen.getByRole("button", { name: "Mon compte" }));
		expect(await screen.findByText(user.email)).toBeInTheDocument();
		expect(screen.queryByText("Super admin")).not.toBeInTheDocument();
		expect(
			screen.queryByRole("link", { name: "Comptes" }),
		).not.toBeInTheDocument();
	});
});
