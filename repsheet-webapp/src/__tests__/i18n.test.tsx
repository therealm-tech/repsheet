import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountPanel } from "@/components/AccountPanel";
import { ExercisePicker } from "@/components/ExercisePicker";
import i18n, { detectLocale } from "@/i18n";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { ApiError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { formatDay, formatMinutes } from "@/lib/dates";
import { formatNumber } from "@/lib/units";
import { HomePage } from "@/pages/HomePage";
import { LoginPage } from "@/pages/LoginPage";
import { mockApi, page, renderRoute, renderWithClient, user } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

function keysOf(value: object, prefix = ""): string[] {
	return Object.entries(value).flatMap(([key, child]) =>
		typeof child === "string"
			? [`${prefix}${key}`]
			: keysOf(child as object, `${prefix}${key}.`),
	);
}

describe("catalogs", () => {
	it("have exactly the same keys in French and English", () => {
		expect(keysOf(en).sort()).toEqual(keysOf(fr).sort());
	});

	it("leave no empty translation", () => {
		const blank = [fr, en].flatMap((catalog) =>
			keysOf(catalog).filter((key) => {
				const value = key
					.split(".")
					.reduce<unknown>(
						(node, part) => (node as Record<string, unknown>)[part],
						catalog,
					);
				return typeof value !== "string" || value.trim() === "";
			}),
		);
		expect(blank).toEqual([]);
	});
});

describe("language detection", () => {
	it("picks French for any French variant and English otherwise", () => {
		expect(detectLocale(["fr-CA", "en"])).toBe("fr");
		expect(detectLocale(["FR"])).toBe("fr");
		expect(detectLocale(["de-DE", "fr"])).toBe("en");
		expect(detectLocale([])).toBe("en");
	});
});

describe("formatting follows the language", () => {
	it("formats days, numbers and durations in English", async () => {
		await i18n.changeLanguage("en");
		expect(formatDay("2026-10-22")).toBe("Thu 22 Oct");
		expect(formatNumber(12.5)).toBe("12.5");
		expect(formatMinutes(95)).toBe("1 h 35 min");
		expect(i18n.t("common.blocks", { count: 1 })).toBe("1 block");
		expect(i18n.t("common.blocks", { count: 3 })).toBe("3 blocks");
	});

	it("uses French plural rules, where zero is singular", () => {
		expect(i18n.t("common.workouts", { count: 0 })).toBe("0 séance");
		expect(formatNumber(12.5)).toBe("12,5");
	});
});

describe("problem mapping", () => {
	const problem = (status: number, type: string, extra = {}) =>
		new ApiError(status, {
			type: `urn:repsheet:problem:${type}`,
			title: "Problem",
			status,
			detail: "English developer detail",
			...extra,
		});

	it("gives each conflict type its own text, never the API's detail", () => {
		const opts = { fallback: "saveFailed" } as const;
		const cases = {
			"email-taken": fr.errors.emailTaken,
			"exercise-name-taken": fr.errors.exerciseNameTaken,
			"mode-locked": fr.errors.modeLocked,
			"equipment-locked": fr.errors.equipmentLocked,
			"grip-locked": fr.errors.gripLocked,
			"exercise-in-use": fr.errors.exerciseInUse,
			"own-role": fr.errors.ownRole,
			"own-account": fr.errors.ownAccount,
		};
		for (const [type, text] of Object.entries(cases)) {
			expect(errorMessage(problem(409, type), opts)).toBe(text);
		}
	});

	it("falls back to the generic conflict text for an unknown 409", () => {
		const opts = { fallback: "saveFailed" } as const;
		expect(errorMessage(problem(409, "conflict"), opts)).toBe(
			fr.errors.conflict,
		);
		expect(errorMessage(problem(409, "something-new"), opts)).toBe(
			fr.errors.conflict,
		);
		expect(errorMessage(new ApiError(409, null), opts)).toBe(
			fr.errors.conflict,
		);
	});

	it("maps types, fields, statuses and network failures", () => {
		const opts = { fallback: "saveFailed" } as const;
		expect(errorMessage(problem(401, "invalid-credentials"), opts)).toBe(
			fr.errors.invalidCredentials,
		);
		expect(errorMessage(problem(403, "forbidden"), opts)).toBe(
			fr.errors.forbidden,
		);
		expect(
			errorMessage(
				problem(422, "validation", {
					errors: [{ field: "names.en", message: "x" }],
				}),
				opts,
			),
		).toBe(fr.errors.nameEnRequired);
		expect(
			errorMessage(
				problem(422, "validation", {
					errors: [{ field: "body", message: "x" }],
				}),
				opts,
			),
		).toBe(fr.errors.validation);
		expect(errorMessage(new ApiError(503, null), opts)).toBe(
			fr.errors.internal,
		);
		expect(errorMessage(new TypeError("Failed to fetch"), opts)).toBe(
			fr.errors.network,
		);
		expect(errorMessage(new Error("boom"), opts)).toBe(fr.errors.saveFailed);
	});

	it("shows the translated 'name taken' text on a duplicate exercise", async () => {
		mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/exercises": () => ({ status: 200, body: page([]) }),
			"POST /v1/exercises": () => ({
				status: 409,
				body: {
					type: "urn:repsheet:problem:exercise-name-taken",
					title: "Conflict",
					status: 409,
					detail: 'an exercise named "Squat" already exists',
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

		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent("Un exercice porte déjà ce nom.");
		expect(alert).not.toHaveTextContent("already exists");
	});
});

describe("switching language", () => {
	it("re-renders the screen with English strings", async () => {
		mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/workouts": () => ({ status: 200, body: page([]) }),
		});
		await renderRoute(HomePage, "/dashboard");
		expect(await screen.findByText("Noter une séance")).toBeInTheDocument();

		await act(() => i18n.changeLanguage("en"));

		expect(screen.getByText("Log a session")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "＋ Free session" }),
		).toBeInTheDocument();
		expect(document.documentElement.lang).toBe("en");
	});

	it("names a free session after its date in English, following date changes", async () => {
		mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/workouts": () => ({ status: 200, body: page([]) }),
		});
		await renderRoute(HomePage, "/dashboard");
		await act(() => i18n.changeLanguage("en"));
		const ui = userEvent.setup();

		await ui.click(screen.getByRole("button", { name: "＋ Free session" }));
		const form = screen.getByRole("form", { name: "New session" });
		const date = within(form).getByLabelText("Date");
		await ui.clear(date);
		await ui.type(date, "2026-09-30");

		expect(within(form).getByLabelText("Name")).toHaveValue(
			"Session on 30 September 2026",
		);
	});

	it("saves language and unit through the preferences endpoint", async () => {
		const calls = mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"PUT /v1/users/me/preferences": (call) => ({
				status: 200,
				body: { ...user, ...(call.body as object) },
			}),
		});
		await renderRoute(AccountPanel, "/account");
		const ui = userEvent.setup();

		const language = await screen.findByRole("group", { name: "Langue" });
		await ui.click(within(language).getByRole("radio", { name: "English" }));

		await waitFor(() =>
			expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
				locale: "en",
				weightUnit: "kg",
			}),
		);
		expect(
			await screen.findByRole("button", { name: "Sign out" }),
		).toBeInTheDocument();
		expect(i18n.language).toBe("en");

		const unit = screen.getByRole("group", { name: "Unit" });
		await ui.click(within(unit).getByRole("radio", { name: "lb" }));
		await waitFor(() =>
			expect(calls.filter((c) => c.method === "PUT").at(-1)?.body).toEqual({
				locale: "en",
				weightUnit: "lb",
			}),
		);
	});

	it("registers with the language chosen on the sign-in screen", async () => {
		const calls = mockApi({
			"POST /v1/users": () => ({
				status: 201,
				body: { ...user, locale: "en" },
			}),
			"POST /v1/tokens": () => ({
				status: 201,
				body: { token: "t", expiresAt: "2099-01-01T00:00:00Z" },
			}),
		});
		await renderRoute(LoginPage, "/login");
		const ui = userEvent.setup();

		await ui.click(screen.getByRole("radio", { name: "EN" }));
		await ui.click(screen.getByRole("radio", { name: "Create an account" }));
		await ui.type(screen.getByLabelText("First name"), "Sam");
		await ui.type(screen.getByLabelText("Email"), "sam@example.com");
		await ui.type(screen.getByLabelText("Password"), "long enough");
		await ui.click(screen.getByRole("button", { name: "Create my account" }));

		await waitFor(() =>
			expect(calls[0]?.body).toMatchObject({
				email: "sam@example.com",
				locale: "en",
			}),
		);
	});
});
