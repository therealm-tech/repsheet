import "i18next";
import type { fr } from "@/i18n/fr";

declare module "i18next" {
	interface CustomTypeOptions {
		defaultNS: "translation";
		resources: { translation: typeof fr };
	}
}
