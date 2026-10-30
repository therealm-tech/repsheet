/*
 * Workout days travel as "YYYY-MM-DD" calendar dates. They are built and read
 * from local date parts only: `new Date("2026-10-22")` would parse as UTC
 * midnight and show the previous day west of Greenwich.
 */

import i18n, { intlTag } from "@/i18n";

const formats = new Map<string, Intl.DateTimeFormat>();

/** One cached formatter per locale and style, built for the active language. */
function format(
	style: Intl.DateTimeFormatOptions,
	name: string,
): Intl.DateTimeFormat {
	const tag = intlTag();
	const key = `${tag}:${name}`;
	let found = formats.get(key);
	if (!found) {
		found = new Intl.DateTimeFormat(tag, style);
		formats.set(key, found);
	}
	return found;
}

const DAY: Intl.DateTimeFormatOptions = {
	weekday: "short",
	day: "numeric",
	month: "short",
};
const LONG_DAY: Intl.DateTimeFormatOptions = {
	weekday: "long",
	day: "numeric",
	month: "long",
};
const SHORT: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
const MONTH: Intl.DateTimeFormatOptions = { month: "short" };
const WEEKDAY_LETTER: Intl.DateTimeFormatOptions = { weekday: "narrow" };

function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Reads "YYYY-MM-DD" as that calendar day at local midnight. */
export function parseDay(day: string): Date {
	const [y, m, d] = day.split("-").map(Number);
	return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** The local calendar day of `date` as "YYYY-MM-DD". */
export function toDay(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

export function today(): string {
	return toDay(new Date());
}

/** "Jeu. 22 oct." */
export function formatDay(day: string): string {
	return capitalize(format(DAY, "day").format(parseDay(day)));
}

/** "22 oct." */
export function formatShortDay(day: string): string {
	return format(SHORT, "short").format(parseDay(day));
}

export function formatMonthOfDay(day: string): string {
	return format(MONTH, "month").format(parseDay(day));
}

export function formatLongDay(date: Date): string {
	return capitalize(format(LONG_DAY, "longDay").format(date));
}

/** A timestamp (creation, update) shown as its local day: "22 oct.". */
export function formatShortInstant(iso: string): string {
	return format(SHORT, "short").format(new Date(iso));
}

export function formatMinutes(minutes: number): string {
	if (minutes < 60) {
		return i18n.t("duration.minutes", { minutes });
	}
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest === 0
		? i18n.t("duration.hours", { hours })
		: i18n.t("duration.hoursMinutes", {
				hours,
				minutes: String(rest).padStart(2, "0"),
			});
}

export interface WeekDay {
	day: string;
	date: Date;
	label: string;
	isToday: boolean;
	hasWorkout: boolean;
}

/** The Monday-to-Sunday week containing `now`, flagging days with a workout. */
export function weekDays(now: Date, workoutDays: string[]): WeekDay[] {
	const mondayOffset = (now.getDay() + 6) % 7;
	const worked = new Set(workoutDays);
	const current = toDay(now);
	return Array.from({ length: 7 }, (_, i) => {
		const date = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate() - mondayOffset + i,
		);
		const day = toDay(date);
		const label = format(WEEKDAY_LETTER, "weekdayLetter").format(date);
		return {
			day,
			date,
			label,
			isToday: day === current,
			hasWorkout: worked.has(day),
		};
	});
}
