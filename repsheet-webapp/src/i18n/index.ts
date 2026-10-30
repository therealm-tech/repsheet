import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { type Locale, LocaleSchema } from "@/lib/api/schemas";
import { logger } from "@/lib/logger";

export type { Locale };

export const LOCALES: Locale[] = ["fr", "en"];

/** fr* → fr, anything else → en. */
export function detectLocale(languages: readonly string[]): Locale {
	const first = languages[0]?.toLowerCase() ?? "";
	return first.startsWith("fr") ? "fr" : "en";
}

const STORAGE_KEY = "repsheet.locale";

/** The last account language seen on this device, so a reload does not flash the other one. */
function storedLocale(): Locale | null {
	try {
		const parsed = LocaleSchema.safeParse(localStorage.getItem(STORAGE_KEY));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

export function rememberLocale(locale: Locale): void {
	try {
		localStorage.setItem(STORAGE_KEY, locale);
	} catch (error) {
		logger.warn("i18n.locale.unwritable", { error: String(error) });
	}
}

export function currentLocale(): Locale {
	const parsed = LocaleSchema.safeParse(i18n.language);
	return parsed.success ? parsed.data : "en";
}

/** BCP 47 tag for Intl: day before month in both languages. */
export function intlTag(locale: Locale = currentLocale()): string {
	return locale === "fr" ? "fr-FR" : "en-GB";
}

export const resources = {
	fr: { translation: fr },
	en: { translation: en },
} as const;

void i18n.use(initReactI18next).init({
	resources,
	lng:
		storedLocale() ?? detectLocale(navigator.languages ?? [navigator.language]),
	fallbackLng: "en",
	interpolation: { escapeValue: false },
	returnNull: false,
});

function syncDocument(language: string): void {
	document.documentElement.lang = language;
}
syncDocument(i18n.language);
i18n.on("languageChanged", syncDocument);

export default i18n;
