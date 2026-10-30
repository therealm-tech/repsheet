import type { fr } from "@/i18n/fr";

/** Same keys as the French catalog, any string values: a missing key fails to compile. */
export type Catalog<T = typeof fr> = {
	[K in keyof T]: T[K] extends string ? string : Catalog<T[K]>;
};
