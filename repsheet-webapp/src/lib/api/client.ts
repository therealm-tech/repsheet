import type { z } from "zod";
import { config } from "@/config";
import { type Problem, ProblemSchema } from "@/lib/api/schemas";
import { tokenStore } from "@/lib/auth";
import { logger } from "@/lib/logger";

/** The server answered with a body that does not match the contract. */
export class UnexpectedResponseError extends Error {
	constructor(method: string, path: string) {
		super(`Unexpected response body for ${method} ${path}`);
		this.name = "UnexpectedResponseError";
	}
}

export class ApiError extends Error {
	readonly status: number;
	readonly problem: Problem | null;

	constructor(status: number, problem: Problem | null) {
		super(problem?.detail ?? problem?.title ?? `HTTP ${status}`);
		this.name = "ApiError";
		this.status = status;
		this.problem = problem;
	}

	fieldError(field: string): string | undefined {
		return this.problem?.errors?.find((e) => e.field === field)?.message;
	}
}

type Method = "GET" | "POST" | "PUT" | "DELETE";

interface Options {
	body?: unknown;
	auth?: boolean;
	query?: Record<string, string | number | undefined>;
}

function buildUrl(path: string, query: Options["query"]): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query ?? {})) {
		if (value !== undefined && value !== "") {
			params.set(key, String(value));
		}
	}
	const qs = params.toString();
	return `${config.apiBase}${path}${qs ? `?${qs}` : ""}`;
}

async function send(
	method: Method,
	path: string,
	options: Options,
): Promise<Response> {
	const headers: Record<string, string> = { Accept: "application/json" };
	const auth = options.auth ?? true;
	const token = tokenStore.get();
	if (auth && token) {
		headers.Authorization = `Bearer ${token.token}`;
	}
	const init: RequestInit = { method, headers };
	if (options.body !== undefined) {
		headers["Content-Type"] = "application/json";
		init.body = JSON.stringify(options.body);
	}
	const url = buildUrl(path, options.query);
	logger.debug("api.request", { method, url });
	const response = await fetch(url, init);
	logger.debug("api.response", { method, url, status: response.status });
	if (!response.ok) {
		let problem: Problem | null = null;
		try {
			const parsed = ProblemSchema.safeParse(await response.json());
			problem = parsed.success ? parsed.data : null;
		} catch {
			problem = null;
		}
		if (response.status === 401 && auth) {
			logger.info("api.unauthorized", { url });
			tokenStore.clear();
		}
		if (response.status >= 500) {
			logger.error("api.failure", { method, url, status: response.status });
		}
		throw new ApiError(response.status, problem);
	}
	return response;
}

export async function request<S extends z.ZodType>(
	method: Method,
	path: string,
	schema: S,
	options: Options = {},
): Promise<z.infer<S>> {
	const response = await send(method, path, options);
	const json: unknown = await response.json();
	const parsed = schema.safeParse(json);
	if (!parsed.success) {
		logger.error("api.unexpected_body", {
			method,
			path,
			issues: parsed.error.issues,
		});
		throw new UnexpectedResponseError(method, path);
	}
	return parsed.data;
}

export async function requestVoid(
	method: Method,
	path: string,
	options: Options = {},
): Promise<void> {
	await send(method, path, options);
}
