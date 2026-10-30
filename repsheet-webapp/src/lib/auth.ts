import { useSyncExternalStore } from "react";
import { type Token, TokenSchema } from "@/lib/api/schemas";
import { logger } from "@/lib/logger";

const STORAGE_KEY = "repsheet.token";
const listeners = new Set<() => void>();

function read(): Token | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw === null) {
			return null;
		}
		const parsed = TokenSchema.safeParse(JSON.parse(raw));
		if (!parsed.success) {
			logger.warn("auth.token.invalid");
			return null;
		}
		if (Date.parse(parsed.data.expiresAt) <= Date.now()) {
			logger.info("auth.token.expired");
			return null;
		}
		return parsed.data;
	} catch (error) {
		logger.warn("auth.token.unreadable", { error: String(error) });
		return null;
	}
}

let current: Token | null = read();

function notify(): void {
	for (const listener of listeners) {
		listener();
	}
}

export const tokenStore = {
	get(): Token | null {
		return current;
	},
	set(token: Token): void {
		current = token;
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(token));
		} catch (error) {
			logger.warn("auth.token.unwritable", { error: String(error) });
		}
		notify();
	},
	clear(): void {
		if (current === null) {
			return;
		}
		current = null;
		try {
			localStorage.removeItem(STORAGE_KEY);
		} catch (error) {
			logger.warn("auth.token.unremovable", { error: String(error) });
		}
		notify();
	},
	reload(): void {
		current = read();
		notify();
	},
	subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
};

export function useToken(): Token | null {
	return useSyncExternalStore(tokenStore.subscribe, tokenStore.get);
}
