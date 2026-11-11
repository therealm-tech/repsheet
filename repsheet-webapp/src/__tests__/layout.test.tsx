import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Stepper } from "@/components/Stepper";
import { Sidebar } from "@/components/TabBar";
import { Sheet } from "@/components/ui";
import { tokenStore } from "@/lib/auth";
import { APP_SCROLLER } from "@/lib/scroll";
import { createAppRouter } from "@/router";
import { admin, mockApi, newClient, page, renderRoute, user } from "./helpers";

afterEach(() => {
	vi.unstubAllGlobals();
	tokenStore.clear();
});

describe("Sheet", () => {
	it("takes focus, closes on Escape and gives focus back", async () => {
		const onClose = vi.fn();
		const ui = userEvent.setup();
		const { rerender } = render(
			<>
				<button type="button">Ouvrir</button>
				<Sheet title="Nouveau bloc" onClose={onClose}>
					<p>Contenu</p>
				</Sheet>
			</>,
		);
		expect(screen.getByRole("dialog", { name: "Nouveau bloc" })).toHaveFocus();

		await ui.keyboard("{Escape}");
		expect(onClose).toHaveBeenCalledTimes(1);

		const opener = screen.getByRole("button", { name: "Ouvrir" });
		opener.focus();
		rerender(
			<>
				<button type="button">Ouvrir</button>
				<Sheet title="Autre" onClose={onClose}>
					<p>Contenu</p>
				</Sheet>
			</>,
		);
		rerender(<button type="button">Ouvrir</button>);
		expect(screen.getByRole("button", { name: "Ouvrir" })).toHaveFocus();
	});
});

describe("Stepper", () => {
	it("shows the short field label but keeps the full accessible name", () => {
		render(
			<Stepper
				label="A · Développé couché — Charge"
				visibleLabel="Charge"
				value={60}
				unit="kg"
				hint="± 1 kg"
				onStep={vi.fn()}
				onChange={vi.fn()}
			/>,
		);
		expect(
			screen.getByRole("textbox", { name: "A · Développé couché — Charge" }),
		).toHaveValue("60");
		expect(screen.getByText("Charge")).toBeInTheDocument();
		expect(screen.queryByText("A · Développé couché — Charge")).toBeNull();
		expect(
			screen.getByRole("button", {
				name: "A · Développé couché — Charge plus",
			}),
		).toBeInTheDocument();
	});
});

describe("Sidebar", () => {
	it("holds the navigation and the account panel with the admin entry", async () => {
		mockApi({ "GET /v1/users/me": () => ({ status: 200, body: admin }) });
		await renderRoute(Sidebar, "/side");

		const nav = screen.getByRole("navigation", { name: "Navigation latérale" });
		for (const label of [
			"Accueil",
			"Historique",
			"Modèles",
			"Exercices",
			"Athlètes",
		]) {
			expect(nav).toHaveTextContent(label);
		}
		expect(
			await screen.findByRole("link", { name: "Comptes" }),
		).toBeInTheDocument();
		expect(screen.getByText("Super admin")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Se déconnecter" }),
		).toBeInTheDocument();
	});

	it("has no admin entry for a regular user", async () => {
		mockApi({ "GET /v1/users/me": () => ({ status: 200, body: user }) });
		await renderRoute(Sidebar, "/side");

		expect(await screen.findByText(user.email)).toBeInTheDocument();
		expect(screen.queryByRole("link", { name: "Comptes" })).toBeNull();
	});
});

describe("AppLayout", () => {
	const elementScrollTo = Element.prototype.scrollTo;

	afterEach(() => {
		Element.prototype.scrollTo = elementScrollTo;
	});

	async function renderApp() {
		mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/workouts": () => ({ status: 200, body: page([]) }),
			"GET /v1/templates": () => ({ status: 200, body: page([]) }),
		});
		tokenStore.set({ token: "t", expiresAt: "2099-01-01T00:00:00Z" });
		vi.stubGlobal("scrollTo", vi.fn());
		// jsdom has no Element.scrollTo, which the router calls to reset the scroller.
		Element.prototype.scrollTo = function (this: Element) {
			this.scrollTop = 0;
		};
		const router = createAppRouter(
			createMemoryHistory({ initialEntries: ["/"] }),
		);
		const { container } = render(
			<QueryClientProvider client={newClient()}>
				<RouterProvider router={router} />
			</QueryClientProvider>,
		);
		await screen.findByRole("heading", { name: /Guillaume/ });
		const scroller = document.querySelector<HTMLElement>(APP_SCROLLER);
		if (!scroller) {
			throw new Error("no app scroller");
		}
		return { container, router, scroller };
	}

	it("mounts the shell straight under the root, so it can take the root's full height", async () => {
		const { container, scroller } = await renderApp();

		expect(container.children).toHaveLength(1);
		expect(container.firstElementChild).toBe(scroller.parentElement);
		expect(container.firstElementChild).toHaveClass("app");
	});

	it("lays the tab bar out after the scrolling content, not over it", async () => {
		const { scroller } = await renderApp();

		const tabbar = screen.getByRole("navigation", {
			name: "Navigation principale",
		});
		expect(scroller).toContainElement(
			screen.getByRole("heading", { name: /Guillaume/ }),
		);
		expect(scroller).not.toContainElement(tabbar);
		expect(tabbar.parentElement).toBe(scroller.parentElement);
		expect(scroller.nextElementSibling).toBe(tabbar);
	});

	it("opens a tab at the top and restores the position on back", async () => {
		const { router, scroller } = await renderApp();
		const ui = userEvent.setup();

		scroller.scrollTop = 400;
		fireEvent.scroll(scroller);
		await ui.click(
			within(
				screen.getByRole("navigation", { name: "Navigation principale" }),
			).getByRole("link", { name: "Historique" }),
		);
		await screen.findByRole("heading", { name: "Historique" });
		expect(scroller.scrollTop).toBe(0);

		router.history.back();
		await screen.findByRole("heading", { name: /Guillaume/ });
		await waitFor(() => expect(scroller.scrollTop).toBe(400));
	});
});
