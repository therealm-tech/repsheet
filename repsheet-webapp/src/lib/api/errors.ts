import type { z } from "zod";
import i18n from "@/i18n";
import { fr as frCatalog } from "@/i18n/fr";
import { ApiError } from "@/lib/api/client";

export type ErrorKey = keyof typeof frCatalog.errors;

const PROBLEM = "urn:repsheet:problem:";

/** Validation failures name the offending field; these get a dedicated message. */
const FIELD_MESSAGES: Record<string, ErrorKey> = {
	email: "invalidEmail",
	password: "passwordLength",
	name: "nameRequired",
	names: "namesRequired",
	"names.fr": "nameFrRequired",
	"names.en": "nameEnRequired",
	modes: "modesRequired",
	defaultMode: "defaultModeInvalid",
	performedOn: "dateRequired",
	durationMinutes: "durationRange",
};

function byType(error: ApiError): ErrorKey | null {
	switch (error.problem?.type) {
		case `${PROBLEM}validation`: {
			const field = error.problem.errors?.[0]?.field;
			return (field && FIELD_MESSAGES[field]) || "validation";
		}
		case `${PROBLEM}malformed-request`:
			return "malformed";
		case `${PROBLEM}unauthenticated`:
			return "sessionExpired";
		case `${PROBLEM}invalid-credentials`:
			return "invalidCredentials";
		case `${PROBLEM}forbidden`:
			return "forbidden";
		case `${PROBLEM}not-found`:
			return "notFound";
		case `${PROBLEM}email-taken`:
			return "emailTaken";
		case `${PROBLEM}exercise-name-taken`:
			return "exerciseNameTaken";
		case `${PROBLEM}mode-locked`:
			return "modeLocked";
		case `${PROBLEM}exercise-in-use`:
			return "exerciseInUse";
		case `${PROBLEM}own-role`:
			return "ownRole";
		case `${PROBLEM}own-account`:
			return "ownAccount";
		case `${PROBLEM}internal`:
			return "internal";
		default:
			return null;
	}
}

function byStatus(
	status: number,
	unauthorized: ErrorKey | undefined,
): ErrorKey | null {
	if (status >= 500) {
		return "internal";
	}
	switch (status) {
		case 400:
			return "malformed";
		case 401:
			return unauthorized ?? "sessionExpired";
		case 403:
			return "forbidden";
		case 404:
			return "notFound";
		case 409:
			return "conflict";
		case 422:
			return "validation";
		default:
			return null;
	}
}

/**
 * A translated message for a failed call. The API's own `detail` is English
 * developer text and is never shown. A 409 of an unknown type gets the generic
 * conflict text.
 */
export function errorMessage(
	error: unknown,
	options: { fallback: ErrorKey; unauthorized?: ErrorKey },
): string {
	let key: ErrorKey = options.fallback;
	if (error instanceof ApiError) {
		key =
			byType(error) ??
			byStatus(error.status, options.unauthorized) ??
			options.fallback;
	} else if (error instanceof TypeError) {
		key = "network";
	}
	return i18n.t(`errors.${key}`);
}

function isErrorKey(value: string | undefined): value is ErrorKey {
	return value !== undefined && Object.hasOwn(frCatalog.errors, value);
}

/** Client-side schemas carry an `ErrorKey` as their message; this translates the first one. */
export function validationMessage(error: z.ZodError): string {
	const key = error.issues[0]?.message;
	return i18n.t(`errors.${isErrorKey(key) ? key : "formInvalid"}`);
}
