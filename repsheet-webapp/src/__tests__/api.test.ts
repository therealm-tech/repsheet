import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, UnexpectedResponseError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { tokenStore } from "@/lib/auth";
import { exercise, mockApi, page, user } from "./helpers";

afterEach(() => {
	vi.unstubAllGlobals();
	tokenStore.clear();
});

describe("api client", () => {
	it("sends the bearer token and parses the response", async () => {
		tokenStore.set({
			token: "secret-token",
			expiresAt: "2099-01-01T00:00:00Z",
		});
		const calls = mockApi({
			"GET /v1/users/me": () => ({ status: 200, body: user }),
		});
		await expect(api.me()).resolves.toEqual(user);
		expect(calls[0]?.headers.Authorization).toBe("Bearer secret-token");
	});

	it("does not send a token to the login endpoint", async () => {
		tokenStore.set({ token: "old", expiresAt: "2099-01-01T00:00:00Z" });
		const calls = mockApi({
			"POST /v1/tokens": () => ({
				status: 201,
				body: { token: "t", expiresAt: "2099-01-01T00:00:00Z" },
			}),
		});
		await api.login({ email: "a@b.c", password: "password" });
		expect(calls[0]?.headers.Authorization).toBeUndefined();
	});

	it("encodes query parameters and skips empty ones", async () => {
		const calls = mockApi({
			"GET /v1/exercises": () => ({
				status: 200,
				body: page([exercise({ id: "e1", name: "Squat" })]),
			}),
		});
		const result = await api.exercises({ q: "squat", perPage: 50 });
		expect(result.items[0]?.name).toBe("Squat");
		expect(calls[0]?.path).toBe("/v1/exercises?q=squat&perPage=50");
	});

	it("turns a problem document into an ApiError with field errors", async () => {
		mockApi({
			"POST /v1/users": () => ({
				status: 422,
				body: {
					type: "about:blank",
					title: "Unprocessable Entity",
					status: 422,
					detail: "La requête est invalide.",
					errors: [{ field: "password", message: "8 caractères minimum." }],
				},
			}),
		});
		const error = await api
			.register({
				name: "G",
				email: "g@example.com",
				password: "short",
				weightUnit: "kg",
				locale: "fr",
			})
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ApiError);
		expect((error as ApiError).status).toBe(422);
		expect((error as ApiError).fieldError("password")).toBe(
			"8 caractères minimum.",
		);
	});

	it("logs out on a 401", async () => {
		tokenStore.set({ token: "expired", expiresAt: "2099-01-01T00:00:00Z" });
		mockApi({
			"GET /v1/users/me": () => ({
				status: 401,
				body: { title: "Unauthorized", status: 401 },
			}),
		});
		await expect(api.me()).rejects.toBeInstanceOf(ApiError);
		expect(tokenStore.get()).toBeNull();
	});

	it("rejects a body that does not match the contract", async () => {
		mockApi({ "GET /v1/users/me": () => ({ status: 200, body: { id: 1 } }) });
		await expect(api.me()).rejects.toBeInstanceOf(UnexpectedResponseError);
	});

	it("resolves empty responses", async () => {
		mockApi({ "DELETE /v1/workouts/w1": () => ({ status: 204 }) });
		await expect(api.deleteWorkout("w1")).resolves.toBeUndefined();
	});
});

describe("token storage", () => {
	it("ignores an expired or malformed stored token", () => {
		localStorage.setItem(
			"repsheet.token",
			JSON.stringify({ token: "t", expiresAt: "2000-01-01T00:00:00Z" }),
		);
		tokenStore.reload();
		expect(tokenStore.get()).toBeNull();
		localStorage.setItem("repsheet.token", "{not json");
		tokenStore.reload();
		expect(tokenStore.get()).toBeNull();
	});
});
