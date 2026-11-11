import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	LinkedAccount,
	PlannedSession,
	PlannedSessionSummary,
	Workout,
} from "@/lib/api/schemas";
import { toDay } from "@/lib/dates";
import { plannedStatus } from "@/lib/planned";
import { AthletePage } from "@/pages/AthletePage";
import { CoachingPage } from "@/pages/CoachingPage";
import { HomePage } from "@/pages/HomePage";
import { PlannedSessionPage } from "@/pages/PlannedSessionPage";
import { WorkoutPage } from "@/pages/WorkoutPage";
import {
	exercise,
	mockApi,
	page,
	performance,
	renderRoute,
	user,
} from "./helpers";

afterEach(() => vi.unstubAllGlobals());

const marie: LinkedAccount = {
	id: "c1",
	name: "Marie",
	email: "marie@example.com",
	linkedAt: "2026-11-03T10:00:00Z",
};

const paul: LinkedAccount = {
	id: "a1",
	name: "Paul",
	email: "paul@example.com",
	linkedAt: "2026-11-03T10:00:00Z",
};

const bench = exercise({ id: "e1", name: "Développé couché" });

function summary(
	overrides: Partial<PlannedSessionSummary> = {},
): PlannedSessionSummary {
	return {
		id: "p1",
		athleteId: user.id,
		author: { id: marie.id, name: marie.name },
		plannedOn: "2026-11-12",
		name: "Upper push",
		status: "sent",
		blockCount: 1,
		workoutCount: 0,
		updatedAt: "2026-11-10T10:00:00Z",
		...overrides,
	};
}

const session: PlannedSession = {
	id: "p1",
	athleteId: paul.id,
	author: { id: marie.id, name: marie.name },
	plannedOn: "2026-11-06",
	name: "Upper push",
	note: null,
	status: "sent",
	updatedAt: "2026-11-01T10:00:00Z",
	blocks: [
		{
			id: "tb1",
			position: 1,
			kind: "simple",
			rounds: 3,
			restSeconds: null,
			exercises: [
				{
					id: "tbe1",
					exercise: bench,
					mode: "reps",
					equipment: "barbell",
					note: null,
					grip: null,
					target: "5×5",
					sets: [],
				},
			],
		},
		{
			id: "tb2",
			position: 2,
			kind: "simple",
			rounds: null,
			restSeconds: null,
			exercises: [
				{
					id: "tbe2",
					exercise: exercise({ id: "e2", name: "Dips" }),
					mode: "reps",
					equipment: "barbell",
					note: null,
					grip: null,
					target: "max",
					sets: [],
				},
			],
		},
	],
};

const logged: Workout = {
	id: "w1",
	name: "Upper push",
	templateId: "p1",
	note: "Dur",
	performedOn: "2026-11-06",
	durationMinutes: 40,
	blocks: [
		{
			id: "b1",
			position: 1,
			kind: "simple",
			templateBlockId: "tb1",
			restSeconds: null,
			exercises: [
				{
					id: "be1",
					exercise: bench,
					mode: "reps",
					equipment: "barbell",
					comments: [],
					grip: null,
					sets: [
						{
							round: 1,
							reps: 5,
							weightKg: 80,
							durationSeconds: null,
							distanceMeters: null,
							warmup: false,
						},
					],
				},
			],
		},
	],
};

describe("plannedStatus", () => {
	it("tells drafts, logged, missed and upcoming sessions apart", () => {
		const day = "2026-11-10";
		const sent = "sent" as const;
		expect(
			plannedStatus(
				{ plannedOn: "2026-11-01", workoutCount: 0, status: "draft" },
				day,
			),
		).toBe("draft");
		expect(
			plannedStatus(
				{ plannedOn: "2026-11-01", workoutCount: 1, status: sent },
				day,
			),
		).toBe("logged");
		expect(
			plannedStatus(
				{ plannedOn: "2026-11-09", workoutCount: 0, status: sent },
				day,
			),
		).toBe("missed");
		expect(
			plannedStatus({ plannedOn: day, workoutCount: 0, status: sent }, day),
		).toBe("planned");
	});
});

describe("CoachingPage", () => {
	it("adds a coach by email, with no step on their side", async () => {
		let coaches: LinkedAccount[] = [];
		const calls = mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/users/me/athletes": () => ({ status: 200, body: page([]) }),
			"GET /v1/users/me/coaches": () => ({ status: 200, body: page(coaches) }),
			"POST /v1/users/me/coaches": () => {
				coaches = [marie];
				return { status: 201, body: marie };
			},
		});
		await renderRoute(CoachingPage, "/coaching");
		const ui = userEvent.setup();

		expect(
			await screen.findByText("Tu n'as pas de coach."),
		).toBeInTheDocument();
		await ui.type(
			screen.getByLabelText("Ajouter un coach par email"),
			"marie@example.com",
		);
		await ui.click(screen.getByRole("button", { name: "Ajouter comme coach" }));

		expect(
			await screen.findByRole("listitem", { name: "Marie" }),
		).toBeVisible();
		expect(calls.find((c) => c.method === "POST")?.body).toEqual({
			email: "marie@example.com",
		});
		expect(screen.getByLabelText("Ajouter un coach par email")).toHaveValue("");
	});

	it("says when no account uses the email", async () => {
		mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/users/me/athletes": () => ({ status: 200, body: page([]) }),
			"GET /v1/users/me/coaches": () => ({ status: 200, body: page([]) }),
			"POST /v1/users/me/coaches": () => ({
				status: 422,
				body: {
					type: "urn:repsheet:problem:unknown-account",
					title: "Unknown account",
					status: 422,
					detail: "no account uses this email",
				},
			}),
		});
		await renderRoute(CoachingPage, "/coaching");
		const ui = userEvent.setup();

		await ui.type(
			await screen.findByLabelText("Ajouter un coach par email"),
			"nobody@example.com",
		);
		await ui.click(screen.getByRole("button", { name: "Ajouter comme coach" }));

		expect(
			await screen.findByText("Aucun compte n'utilise cet email."),
		).toBeInTheDocument();
	});

	it("removes a coach only after confirming", async () => {
		let coaches = [marie];
		const calls = mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/users/me/athletes": () => ({ status: 200, body: page([]) }),
			"GET /v1/users/me/coaches": () => ({ status: 200, body: page(coaches) }),
			"DELETE /v1/users/me/coaches/c1": () => {
				coaches = [];
				return { status: 204 };
			},
		});
		await renderRoute(CoachingPage, "/coaching");
		const ui = userEvent.setup();

		const row = await screen.findByRole("listitem", { name: "Marie" });
		await ui.click(within(row).getByText("Retirer"));
		expect(within(row).getByText(/restent à toi/)).toBeVisible();
		expect(calls.some((c) => c.method === "DELETE")).toBe(false);

		await ui.click(within(row).getByRole("button", { name: "Retirer Marie" }));
		await waitFor(() =>
			expect(calls.find((c) => c.method === "DELETE")?.path).toBe(
				"/v1/users/me/coaches/c1",
			),
		);
		expect(
			await screen.findByText("Tu n'as pas de coach."),
		).toBeInTheDocument();
	});

	it("keeps only the coaches, the athletes having a tab of their own", async () => {
		const calls = mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/users/me/coaches": () => ({ status: 200, body: page([marie]) }),
		});
		await renderRoute(CoachingPage, "/coaching");

		expect(
			await screen.findByRole("listitem", { name: "Marie" }),
		).toBeVisible();
		expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
			"Mes coachs",
		);
		expect(screen.queryByText("Mes athlètes")).toBeNull();
		expect(calls.some((c) => c.path.startsWith("/v1/users/me/athletes"))).toBe(
			false,
		);
	});
});

describe("logging a planned session", () => {
	it("starts a workout from it, the way a template does", async () => {
		const calls = mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/workouts": () => ({ status: 200, body: page([]) }),
			"GET /v1/planned-sessions": () => ({
				status: 200,
				body: page([
					summary(),
					summary({
						id: "p0",
						name: "Lower",
						plannedOn: "2026-11-02",
						workoutCount: 1,
					}),
				]),
			}),
			"POST /v1/workouts": () => ({
				status: 201,
				body: { ...logged, blocks: [] },
			}),
		});
		await renderRoute(HomePage, "/dashboard");
		const ui = userEvent.setup();

		const section = await screen.findByRole("region", {
			name: "Prévu pour toi",
		});
		expect(within(section).getAllByText(/par Marie/)[0]).toBeInTheDocument();
		expect(within(section).getByText("✓ Notée")).toBeInTheDocument();

		await ui.click(
			within(section).getByRole("button", { name: /Noter Upper push/ }),
		);
		const form = screen.getByRole("form", { name: "Nouvelle séance" });
		expect(within(form).getByLabelText("Nom")).toHaveValue("Upper push");
		await ui.click(
			within(form).getByRole("button", { name: "Créer la séance" }),
		);

		await waitFor(() =>
			expect(calls.find((c) => c.method === "POST")?.body).toEqual({
				name: "Upper push",
				performedOn: toDay(new Date()),
				templateId: "p1",
			}),
		);
	});

	it("hides the section when nothing is planned", async () => {
		mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/workouts": () => ({ status: 200, body: page([]) }),
			"GET /v1/planned-sessions": () => ({ status: 200, body: page([]) }),
		});
		await renderRoute(HomePage, "/dashboard");

		await screen.findByText("Dernières séances");
		expect(screen.queryByText("Prévu pour toi")).not.toBeInTheDocument();
	});

	it("shows the coach's blocks as planned on the workout", async () => {
		mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/workouts/w1": () => ({
				status: 200,
				body: { ...logged, blocks: [] },
			}),
			"GET /v1/templates/p1": () => ({ status: 200, body: session }),
			"GET /v1/users/me/coaches": () => ({ status: 200, body: page([]) }),
		});
		await renderRoute(() => <WorkoutPage workoutId="w1" />, "/workouts/w1");

		expect(
			await screen.findByRole("button", { name: "Bloc prévu 1" }),
		).toHaveTextContent("5×5");
		expect(screen.getByRole("button", { name: "Bloc prévu 2" })).toBeVisible();
	});

	it("shows a block planned set by set with its loads and the coach's note", async () => {
		const set = (round: number, weightKg: number) => ({
			round,
			reps: 12,
			weightKg,
			durationSeconds: null,
			distanceMeters: null,
			warmup: false,
		});
		const bySet: PlannedSession = {
			...session,
			note: "Échauffement 10 min de rameur avant.",
			blocks: [
				{
					id: "tb1",
					position: 1,
					kind: "simple",
					rounds: 3,
					restSeconds: null,
					exercises: [
						{
							id: "tbe1",
							exercise: bench,
							mode: "reps",
							equipment: "barbell",
							grip: null,
							target: null,
							note: "Talons surélevés",
							sets: [set(1, 14), set(2, 16), set(3, 18)],
						},
					],
				},
			],
		};
		mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/workouts/w1": () => ({
				status: 200,
				body: { ...logged, blocks: [] },
			}),
			"GET /v1/templates/p1": () => ({ status: 200, body: bySet }),
			"GET /v1/users/me/coaches": () => ({ status: 200, body: page([]) }),
		});
		await renderRoute(() => <WorkoutPage workoutId="w1" />, "/workouts/w1");

		const card = await screen.findByRole("button", { name: "Bloc prévu 1" });
		expect(card).toHaveTextContent("3×12 · 14→18 kg");
		expect(card).toHaveTextContent("« Talons surélevés »");
		expect(card).toHaveTextContent("Marie · coach");
		expect(await screen.findByText(/prévue par Marie/)).toBeVisible();
		expect(
			screen.getByText("Échauffement 10 min de rameur avant."),
		).toBeVisible();
	});
});

describe("sharing a workout", () => {
	function workoutPage(shared: string[], coaches = [marie]) {
		let shares = shared;
		const calls = mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/workouts/w1": () => ({
				status: 200,
				body: { ...logged, templateId: null },
			}),
			"GET /v1/users/me/coaches": () => ({ status: 200, body: page(coaches) }),
			"GET /v1/workouts/w1/shares": () => ({
				status: 200,
				body: page(
					shares.map((coachId) => ({
						coachId,
						sharedAt: "2026-11-06T10:00:00Z",
					})),
				),
			}),
			"PUT /v1/workouts/w1/shares/c1": () => {
				shares = ["c1"];
				return { status: 204 };
			},
			"DELETE /v1/workouts/w1/shares/c1": () => {
				shares = [];
				return { status: 204 };
			},
		});
		return calls;
	}

	it("shares with a coach, then stops", async () => {
		const calls = workoutPage([]);
		await renderRoute(() => <WorkoutPage workoutId="w1" />, "/workouts/w1");
		const ui = userEvent.setup();

		const toggle = await screen.findByRole("switch", {
			name: "Partager avec Marie",
		});
		await waitFor(() => expect(toggle).toBeEnabled());
		expect(toggle).toHaveAttribute("aria-checked", "false");
		await ui.click(toggle);
		await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
		expect(calls.find((c) => c.method === "PUT")?.path).toBe(
			"/v1/workouts/w1/shares/c1",
		);

		await waitFor(() => expect(toggle).toBeEnabled());
		await ui.click(toggle);
		await waitFor(() =>
			expect(toggle).toHaveAttribute("aria-checked", "false"),
		);
		expect(calls.find((c) => c.method === "DELETE")?.path).toBe(
			"/v1/workouts/w1/shares/c1",
		);
	});

	it("offers no sharing to an athlete without a coach", async () => {
		const calls = workoutPage([], []);
		await renderRoute(() => <WorkoutPage workoutId="w1" />, "/workouts/w1");

		await screen.findByText("Upper push");
		await waitFor(() =>
			expect(calls.some((c) => c.path.startsWith("/v1/users/me/coaches"))).toBe(
				true,
			),
		);
		expect(
			screen.queryByText("Partager avec un coach"),
		).not.toBeInTheDocument();
		expect(calls.some((c) => c.path.includes("/shares"))).toBe(false);
	});
});

describe("coaching an athlete", () => {
	it("lists the planned sessions with their status and the shared workouts", async () => {
		const calls = mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/users/me/athletes/a1": () => ({ status: 200, body: paul }),
			"GET /v1/planned-sessions": () => ({
				status: 200,
				body: page([
					summary({ id: "p3", plannedOn: "2999-01-01", name: "Future" }),
					summary({
						id: "p2",
						plannedOn: "2026-11-06",
						workoutCount: 1,
						name: "Done",
					}),
					summary({ id: "p1", plannedOn: "2026-11-01", name: "Skipped" }),
				]),
			}),
			"GET /v1/workouts": () => ({
				status: 200,
				body: page([
					{
						id: "w9",
						name: "Run club",
						templateId: null,
						performedOn: "2026-11-07",
						durationMinutes: 45,
						blockCount: 2,
					},
				]),
			}),
		});
		await renderRoute(() => <AthletePage athleteId="a1" />, "/athletes/a1");

		expect(await screen.findByRole("heading", { name: "Paul" })).toBeVisible();
		const planned = await screen.findByRole("region", {
			name: "Séances prévues",
		});
		expect(
			within(planned).getByRole("link", { name: /Future/ }),
		).toHaveTextContent("Prévue");
		expect(
			within(planned).getByRole("link", { name: /Done/ }),
		).toHaveTextContent("✓ Notée");
		expect(
			within(planned).getByRole("link", { name: /Skipped/ }),
		).toHaveTextContent("Manquée");
		const shared = screen.getByRole("region", { name: "Partagées avec toi" });
		expect(
			within(shared).getByRole("link", { name: /Run club/ }),
		).toHaveAttribute("href", "/athletes/a1/workouts/w9");
		expect(
			calls.find((c) => c.path.startsWith("/v1/planned-sessions"))?.path,
		).toContain("athleteId=a1");
	});

	it("says so once the athlete has removed the coach", async () => {
		mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/planned-sessions": () => ({
				status: 403,
				body: {
					type: "urn:repsheet:problem:not-coach",
					title: "Forbidden",
					status: 403,
				},
			}),
			"GET /v1/workouts": () => ({
				status: 403,
				body: { title: "Forbidden", status: 403 },
			}),
		});
		await renderRoute(() => <AthletePage athleteId="a1" />, "/athletes/a1");

		expect(
			await screen.findByText("Cette personne ne t'a plus comme coach."),
		).toBeInTheDocument();
	});

	it("shows what was logged from a planned session, and what was skipped", async () => {
		mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/users/me/athletes/a1": () => ({ status: 200, body: paul }),
			"GET /v1/planned-sessions/p1": () => ({ status: 200, body: session }),
			"GET /v1/planned-sessions/p1/workouts": () => ({
				status: 200,
				body: page([logged]),
			}),
		});
		await renderRoute(
			() => <PlannedSessionPage athleteId="a1" sessionId="p1" />,
			"/athletes/a1/sessions/p1",
		);

		const outcome = await screen.findByRole("region", {
			name: "Ce qui a été noté",
		});
		expect(
			within(outcome).getByRole("region", { name: "Bloc 1" }),
		).toHaveTextContent("80 kg");
		expect(
			within(outcome).getByRole("region", { name: "Bloc prévu 2" }),
		).toHaveTextContent("pas noté");
		expect(
			within(outcome)
				.getAllByRole("button")
				.map((b) => b.getAttribute("aria-label")),
		).toEqual(["Ajouter un commentaire sur Développé couché"]);
		expect(screen.getByText(/Notée le/)).toBeInTheDocument();
	});

	it("plans a session block by block from the athlete's last time, then sends it", async () => {
		const set = (
			round: number,
			reps: number,
			weightKg: number,
			warmup = false,
		) => ({
			round,
			reps,
			weightKg,
			durationSeconds: null,
			distanceMeters: null,
			warmup,
		});
		let current: PlannedSession = { ...session, status: "draft", blocks: [] };
		const planned = {
			id: "tb9",
			position: 1,
			kind: "simple" as const,
			rounds: 2,
			restSeconds: null,
			exercises: [
				{
					id: "tbe9",
					exercise: bench,
					mode: "reps" as const,
					equipment: "barbell" as const,
					grip: null,
					target: null,
					note: "Coudes serrés",
					sets: [set(1, 10, 40, true), set(2, 8, 60)],
				},
			],
		};
		const calls = mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/users/me/athletes/a1": () => ({ status: 200, body: paul }),
			"GET /v1/planned-sessions/p1": () => ({ status: 200, body: current }),
			"GET /v1/planned-sessions/p1/workouts": () => ({
				status: 200,
				body: page([]),
			}),
			"GET /v1/exercises": () => ({
				status: 200,
				body: page([
					bench,
					exercise({ id: "mine", name: "Pompes lestées", custom: true }),
				]),
			}),
			"GET /v1/exercises/e1/performances": () => ({
				status: 200,
				body: page([
					performance([set(1, 10, 40, true), set(2, 8, 57.5)], "2026-11-03"),
				]),
			}),
			"POST /v1/planned-sessions/p1/blocks": () => {
				current = { ...current, blocks: [planned] };
				return { status: 201, body: planned };
			},
			"PUT /v1/planned-sessions/p1/status": () => {
				current = { ...current, status: "sent" };
				return { status: 200, body: current };
			},
		});
		await renderRoute(
			() => <PlannedSessionPage athleteId="a1" sessionId="p1" />,
			"/athletes/a1/sessions/p1",
		);
		const ui = userEvent.setup();

		expect(await screen.findByText("Brouillon")).toBeVisible();
		expect(await screen.findByText("Paul ne la voit pas encore")).toBeVisible();
		expect(screen.getByRole("button", { name: "Envoyer" })).toBeDisabled();
		expect(screen.getByText(/pour Paul/)).toBeVisible();

		const [add] = screen.getAllByRole("button", { name: "＋ Ajouter un bloc" });
		await ui.click(add as HTMLElement);
		const sheet = await screen.findByRole("dialog", { name: "Nouveau bloc" });
		await within(sheet).findByText("Développé couché");
		expect(
			within(sheet).queryByText("Pompes lestées"),
			"the athlete cannot see the coach's exercises",
		).not.toBeInTheDocument();
		await ui.click(within(sheet).getByText("Développé couché"));

		expect(
			await within(sheet).findByText("Dernière fois de Paul"),
		).toBeVisible();
		expect(within(sheet).getByText("10 × 40 kg · Échauf.")).toBeVisible();
		expect(within(sheet).getByText("8 × 57,5 kg")).toBeVisible();
		expect(
			within(sheet).getByRole("button", {
				name: "Tour 1, A Développé couché : 8 reps 57,5 kg",
			}),
			"prefilled with Paul's last time",
		).toBeVisible();
		await ui.click(
			within(sheet).getByRole("button", { name: "＋ Tour (copie du tour 1)" }),
		);
		await ui.type(
			within(sheet).getByLabelText("Note pour Paul sur Développé couché"),
			" Coudes serrés ",
		);
		await ui.click(
			within(sheet).getByRole("button", { name: "Enregistrer le bloc" }),
		);

		await waitFor(() =>
			expect(calls.find((c) => c.method === "POST")?.body).toEqual({
				exercises: [
					{
						exerciseId: "e1",
						mode: "reps",
						equipment: "barbell",
						grip: null,
						note: "Coudes serrés",
						sets: [
							{ round: 1, warmup: false, reps: 8, weightKg: 57.5 },
							{ round: 2, warmup: false, reps: 8, weightKg: 57.5 },
						],
					},
				],
			}),
		);
		expect(
			calls.some(
				(c) =>
					c.path.startsWith("/v1/exercises/e1/performances") &&
					c.path.includes("athleteId=a1"),
			),
		).toBe(true);
		const card = await screen.findByRole("button", { name: "Bloc 1" });
		expect(card).toHaveTextContent("1×8 · 60 kg");
		expect(card).toHaveTextContent("↺ 3 nov. : 1×8 · 57,5 kg");

		await ui.click(screen.getByRole("button", { name: "Envoyer" }));
		await waitFor(() =>
			expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
				status: "sent",
			}),
		);
		await waitFor(() =>
			expect(screen.queryByText("Brouillon")).not.toBeInTheDocument(),
		);
	});

	it("starts a draft from the athlete's page", async () => {
		const calls = mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/users/me/athletes/a1": () => ({ status: 200, body: paul }),
			"GET /v1/planned-sessions": () => ({
				status: 200,
				body: page([summary({ status: "draft", name: "Brouillon du jour" })]),
			}),
			"GET /v1/workouts": () => ({ status: 200, body: page([]) }),
			"POST /v1/planned-sessions": () => ({
				status: 201,
				body: { ...session, status: "draft", blocks: [] },
			}),
		});
		const { router } = await renderRoute(
			() => <AthletePage athleteId="a1" />,
			"/athletes/a1",
		);
		const ui = userEvent.setup();

		const planned = await screen.findByRole("region", {
			name: "Séances prévues",
		});
		expect(
			await within(planned).findByRole("link", { name: /Brouillon du jour/ }),
		).toHaveTextContent("Brouillon");
		await ui.click(
			screen.getByRole("button", { name: "＋ Prévoir une séance" }),
		);
		const form = await screen.findByRole("form", { name: "Prévoir pour Paul" });
		expect(within(form).queryByLabelText(/Durée/)).not.toBeInTheDocument();
		const date = within(form).getByLabelText("Date");
		await ui.clear(date);
		await ui.type(date, "2026-11-13");
		await ui.type(within(form).getByLabelText("Nom"), "Bas du corps");
		await ui.click(
			within(form).getByRole("button", { name: "Créer le brouillon" }),
		);

		await waitFor(() =>
			expect(calls.find((c) => c.method === "POST")?.body).toEqual({
				athleteId: "a1",
				plannedOn: "2026-11-13",
				name: "Bas du corps",
				note: null,
			}),
		);
		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/athletes/a1/sessions/p1"),
		);
	});
});
