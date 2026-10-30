import { intlTag } from "@/i18n";
import type { WeightUnit } from "@/lib/api/schemas";

const LB_PER_KG = 2.20462262;

function roundTo(value: number, step: number): number {
	return Math.round(value / step) * step;
}

export function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

/** Converts a weight stored in kg into the user's unit, rounded for display. */
export function kgToUnit(kg: number, unit: WeightUnit): number {
	return unit === "lb" ? roundTo(kg * LB_PER_KG, 0.5) : round2(kg);
}

/** Converts a weight typed in the user's unit into kg, as sent on the wire. */
export function unitToKg(value: number, unit: WeightUnit): number {
	return unit === "lb" ? round2(value / LB_PER_KG) : round2(value);
}

const numberFormats = new Map<string, Intl.NumberFormat>();

export function formatNumber(value: number): string {
	const tag = intlTag();
	let format = numberFormats.get(tag);
	if (!format) {
		format = new Intl.NumberFormat(tag, { maximumFractionDigits: 2 });
		numberFormats.set(tag, format);
	}
	return format.format(value);
}

export function formatWeight(kg: number, unit: WeightUnit): string {
	return `${formatNumber(kgToUnit(kg, unit))} ${unit}`;
}

export function formatDuration(seconds: number): string {
	if (seconds < 60) {
		return `${seconds} s`;
	}
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return s === 0 ? `${m} min` : `${m} min ${String(s).padStart(2, "0")}`;
}

export function formatDistance(meters: number): string {
	return meters >= 1000
		? `${formatNumber(meters / 1000)} km`
		: `${formatNumber(meters)} m`;
}

/** A duration as a stopwatch reads it: "0:50", "1:15". */
export function formatClock(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.round(seconds % 60);
	return `${m}:${String(s).padStart(2, "0")}`;
}

/** Reads a duration typed as seconds ("50") or as minutes and seconds ("1:15"). */
export function parseDuration(text: string): number | null {
	const trimmed = text.trim();
	if (trimmed === "") {
		return null;
	}
	const clock = trimmed.match(/^(\d+):(\d{1,2})$/);
	if (clock) {
		const seconds = Number(clock[2]);
		return seconds < 60 ? Number(clock[1]) * 60 + seconds : null;
	}
	const value = Number(trimmed.replace(",", "."));
	return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}
