import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	formatDay,
	formatMinutes,
	formatShortDay,
	parseDay,
	toDay,
	weekDays,
} from "@/lib/dates";

describe("calendar days west of UTC", () => {
	beforeEach(() => {
		vi.stubEnv("TZ", "America/Los_Angeles");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("formats a day without shifting it to the previous one", () => {
		// The naive parse lands on the 21st here, which is the bug being guarded.
		expect(new Date("2026-10-22").getDate()).toBe(21);
		expect(parseDay("2026-10-22").getDate()).toBe(22);
		expect(formatDay("2026-10-22")).toBe("Jeu. 22 oct.");
		expect(formatShortDay("2026-10-01")).toBe("1 oct.");
	});

	it("takes today from the local calendar, not UTC", () => {
		// 03:00 UTC on the 23rd is still the evening of the 22nd in California.
		expect(toDay(new Date("2026-10-23T03:00:00Z"))).toBe("2026-10-22");
	});

	it("highlights the week days that have a workout", () => {
		const week = weekDays(new Date(2026, 9, 22, 21, 30), [
			"2026-10-19",
			"2026-10-22",
			"2026-10-26",
		]);
		expect(week.map((d) => d.day)).toEqual([
			"2026-10-19",
			"2026-10-20",
			"2026-10-21",
			"2026-10-22",
			"2026-10-23",
			"2026-10-24",
			"2026-10-25",
		]);
		expect(week.filter((d) => d.hasWorkout).map((d) => d.label)).toEqual([
			"L",
			"J",
		]);
		expect(week.find((d) => d.isToday)?.day).toBe("2026-10-22");
	});
});

describe("formatMinutes", () => {
	it("formats durations", () => {
		expect(formatMinutes(55)).toBe("55 min");
		expect(formatMinutes(60)).toBe("1 h");
		expect(formatMinutes(95)).toBe("1 h 35");
	});
});
