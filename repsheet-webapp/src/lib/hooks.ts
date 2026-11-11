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

/** The caller's athletes, as the athletes tab lists them. */
export function useAthletes() {
	return useQuery({
		queryKey: [...keys.athletes, 1],
		queryFn: () => api.athletes({ perPage: 100 }),
	});
}

export function useIsSuperAdmin(): boolean {
	return useMe().data?.role === "superAdmin";
}

/** The caller's unit, unless the weights shown are those of an athlete with a unit of their own. */
export function useUnit(athleteUnit?: WeightUnit): WeightUnit {
	const mine = useMe().data?.weightUnit ?? "kg";
	return athleteUnit ?? mine;
}

export function useDebounced<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const id = setTimeout(() => setDebounced(value), delayMs);
		return () => clearTimeout(id);
	}, [value, delayMs]);
	return debounced;
}
