import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, keys } from "@/lib/api/endpoints";
import type { WeightUnit } from "@/lib/api/schemas";

export function useMe() {
	return useQuery({
		queryKey: keys.me,
		queryFn: api.me,
		staleTime: 5 * 60_000,
	});
}

/** The caller's athletes, as the tab bar and the athletes tab both read them. */
export function useAthletes() {
	return useQuery({
		queryKey: [...keys.athletes, 1],
		queryFn: () => api.athletes({ perPage: 100 }),
	});
}

export function useIsSuperAdmin(): boolean {
	return useMe().data?.role === "superAdmin";
}

export function useUnit(): WeightUnit {
	return useMe().data?.weightUnit ?? "kg";
}

export function useDebounced<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const id = setTimeout(() => setDebounced(value), delayMs);
		return () => clearTimeout(id);
	}, [value, delayMs]);
	return debounced;
}
