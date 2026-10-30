import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Stepper } from "@/components/Stepper";
import { Sidebar } from "@/components/TabBar";
import { Sheet } from "@/components/ui";
import { admin, mockApi, renderRoute, user } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

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
		for (const label of ["Accueil", "Historique", "Modèles", "Exercices"]) {
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
