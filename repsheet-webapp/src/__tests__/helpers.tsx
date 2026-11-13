import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import type { ReactElement } from "react";
import { vi } from "vitest";
import type { Exercise, Performance, User } from "@/lib/api/schemas";

export interface Call {
	method: string;
	path: string;
	body: unknown;
	headers: Record<string, string>;
}

type Handler = (call: Call) => { status: number; body?: unknown };

/** Stubs `fetch` with handlers keyed by "METHOD /v1/path" (query string ignored). */
export function mockApi(handlers: Record<string, Handler>): Call[] {
	const calls: Call[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string, init?: RequestInit) => {
			const url = new URL(input, "http://localhost");
			const path = url.pathname.replace(/^\/api/, "");
			const method = init?.method ?? "GET";
			const call: Call = {
				method,
				path: `${path}${url.search}`,
				body:
					typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
				headers: (init?.headers ?? {}) as Record<string, string>,
			};
			calls.push(call);
			const handler = handlers[`${method} ${path}`];
			if (!handler) {
				return new Response(
					JSON.stringify({ title: "Not Found", status: 404 }),
					{ status: 404 },
				);
			}
			const result = handler(call);
			return new Response(
				result.body === undefined ? null : JSON.stringify(result.body),
				{
					status: result.status,
					headers: { "Content-Type": "application/json" },
				},
			);
		}),
	);
	return calls;
}

export function page<T>(items: T[]) {
	return { items, page: 1, perPage: 50, total: items.length };
}

export const user: User = {
	id: "u1",
	name: "Guillaume",
	email: "g@example.com",
	weightUnit: "kg",
	role: "user",
	locale: "fr",
	createdAt: "2026-10-01T10:00:00Z",
};

export const admin: User = {
	...user,
	id: "admin",
	name: "Alex",
	email: "alex@example.com",
	role: "superAdmin",
};

export function exercise(
	overrides: Partial<Exercise> & Pick<Exercise, "id" | "name">,
): Exercise {
	return {
		modes: ["reps"],
		defaultMode: "reps",
		load: "required",
		equipment: ["barbell"],
		defaultEquipment: "barbell",
		grips: [],
		defaultGrip: null,
		unilateral: false,
		custom: false,
		labels: [],
		lastUsedOn: null,
		names: { fr: overrides.name, en: null },
		...overrides,
	};
}

export function performance(
	sets: Performance["sets"],
	performedOn = "2026-10-15",
	mode: Performance["mode"] = "reps",
	equipment: Performance["equipment"] = "barbell",
	grip: Performance["grip"] = null,
): Performance {
	return {
		blockExerciseId: `be-${performedOn}-${mode}-${equipment}-${grip}`,
		workoutId: `w-${performedOn}`,
		workoutName: "Push A",
		performedOn,
		blockKind: "simple",
		mode,
		equipment,
		comments: [],
		grip,
		sets,
	};
}

/** Opens the choices of a block sheet column from the chip under its name. */
export async function openChoices(ui: UserEvent, name: string) {
	await ui.click(
		screen.getByRole("button", { name: new RegExp(`^${name} : .*, changer$`) }),
	);
}

export function newClient(): QueryClient {
	return new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
}

export function renderWithClient(ui: ReactElement, client = newClient()) {
	return {
		client,
		...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>),
	};
}

/** Mounts `component` at `path` inside a throwaway router, with a stub home page. */
export async function renderRoute(component: () => ReactElement, path: string) {
	const root = createRootRoute({ component: Outlet });
	const target = createRoute({ getParentRoute: () => root, path, component });
	const home = createRoute({
		getParentRoute: () => root,
		path: "/",
		component: () => <p>Accueil chargé</p>,
	});
	const router = createRouter({
		routeTree: root.addChildren([target, home]),
		history: createMemoryHistory({ initialEntries: [path] }),
	});
	const client = newClient();
	const result = render(
		<QueryClientProvider client={client}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
	await router.load();
	return { router, client, ...result };
}
