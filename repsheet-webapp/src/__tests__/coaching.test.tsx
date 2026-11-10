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
import { PlannedSessionEditorPage } from "@/pages/PlannedSessionEditorPage";
import { PlannedSessionPage } from "@/pages/PlannedSessionPage";
import { WorkoutPage } from "@/pages/WorkoutPage";
import { exercise, mockApi, page, renderRoute, user } from "./helpers";

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
					grip: null,
					target: "5×5",
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
					grip: null,
					target: "max",
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
	it("tells logged, missed and upcoming sessions apart", () => {
		const day = "2026-11-10";
		expect(
			plannedStatus({ plannedOn: "2026-11-01", workoutCount: 1 }, day),
		).toBe("logged");
		expect(
			plannedStatus({ plannedOn: "2026-11-09", workoutCount: 0 }, day),
		).toBe("missed");
		expect(plannedStatus({ plannedOn: day, workoutCount: 0 }, day)).toBe(
			"planned",
		);
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

	it("lists the athletes first for a coach", async () => {
		mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/users/me/athletes": () => ({ status: 200, body: page([paul]) }),
			"GET /v1/users/me/coaches": () => ({ status: 200, body: page([]) }),
		});
		await renderRoute(CoachingPage, "/coaching");

		const link = await screen.findByRole("link", { name: /Paul/ });
		expect(link).toHaveAttribute("href", "/coaching/athletes/a1");
		const titles = screen
			.getAllByRole("heading", { level: 2 })
			.map((h) => h.textContent);
		expect(titles).toEqual(["Mes athlètes", "Mes coachs"]);
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
		await renderRoute(
			() => <AthletePage athleteId="a1" />,
			"/coaching/athletes/a1",
		);

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
		).toHaveAttribute("href", "/coaching/athletes/a1/workouts/w9");
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
		await renderRoute(
			() => <AthletePage athleteId="a1" />,
			"/coaching/athletes/a1",
		);

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
			"/coaching/athletes/a1/sessions/p1",
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
		expect(within(outcome).queryByRole("button")).not.toBeInTheDocument();
		expect(screen.getByText(/Notée le/)).toBeInTheDocument();
	});

	it("plans a session with targets and grips, without rest, from the catalog only", async () => {
		const pullUp = exercise({
			id: "e3",
			name: "Tractions",
			load: "optional",
			equipment: ["bodyweight"],
			defaultEquipment: "bodyweight",
			grips: ["pronation", "supination"],
			defaultGrip: "pronation",
		});
		const calls = mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
			"GET /v1/users/me/athletes/a1": () => ({ status: 200, body: paul }),
			"GET /v1/exercises": () => ({
				status: 200,
				body: page([
					bench,
					pullUp,
					exercise({ id: "mine", name: "Pompes lestées", custom: true }),
				]),
			}),
			"POST /v1/planned-sessions": () => ({ status: 201, body: session }),
		});
		await renderRoute(
			() => <PlannedSessionEditorPage athleteId="a1" />,
			"/coaching/athletes/a1/sessions/new",
		);
		const ui = userEvent.setup();

		expect(
			await screen.findByRole("heading", { name: "Prévoir pour Paul" }),
		).toBeVisible();
		const date = screen.getByLabelText("Date");
		await ui.clear(date);
		await ui.type(date, "2026-11-12");
		await ui.type(screen.getByLabelText("Nom"), "Upper push");
		await ui.click(screen.getByRole("button", { name: "＋ Bloc" }));
		const picker = await screen.findByRole("dialog", {
			name: "Ajouter un exercice",
		});
		await within(picker).findByText("Développé couché");
		expect(
			within(picker).queryByText("Pompes lestées"),
		).not.toBeInTheDocument();
		expect(within(picker).queryByText(/Créer/)).not.toBeInTheDocument();
		await ui.click(within(picker).getByText("Développé couché"));

		expect(screen.queryByLabelText("Repos (s)")).not.toBeInTheDocument();
		await ui.type(screen.getByLabelText("Cible pour Développé couché"), "5×5");
		await ui.type(screen.getByLabelText("Tours"), "3");

		await ui.click(screen.getByRole("button", { name: "＋ Exercice" }));
		const second = await screen.findByRole("dialog", {
			name: "Ajouter un exercice",
		});
		await ui.click(await within(second).findByText("Tractions"));
		const grip = screen.getByRole("group", { name: "Prise de Tractions" });
		await ui.click(within(grip).getByRole("button", { name: "Supination" }));
		await ui.type(screen.getByLabelText("Cible pour Tractions"), "max");

		await ui.click(
			screen.getByRole("button", { name: "Enregistrer la séance" }),
		);

		await waitFor(() =>
			expect(calls.find((c) => c.method === "POST")?.body).toEqual({
				athleteId: "a1",
				plannedOn: "2026-11-12",
				name: "Upper push",
				blocks: [
					{
						rounds: 3,
						exercises: [
							{
								exerciseId: "e1",
								mode: "reps",
								equipment: "barbell",
								grip: null,
								target: "5×5",
							},
							{
								exerciseId: "e3",
								mode: "reps",
								equipment: "bodyweight",
								grip: "supination",
								target: "max",
							},
						],
					},
				],
			}),
		);
	});
});
