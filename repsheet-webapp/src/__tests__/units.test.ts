import { describe, expect, it } from "vitest";
import { formatDuration, formatWeight, kgToUnit, unitToKg } from "@/lib/units";

describe("weight units", () => {
	it("keeps kilograms as typed", () => {
		expect(kgToUnit(62.5, "kg")).toBe(62.5);
		expect(unitToKg(62.5, "kg")).toBe(62.5);
	});

	it("rounds pounds to the nearest half pound for display", () => {
		expect(kgToUnit(20, "lb")).toBe(44);
		expect(kgToUnit(20.41, "lb")).toBe(45);
	});

	it("stores pounds as kilograms with two decimals", () => {
		expect(unitToKg(45, "lb")).toBe(20.41);
	});

	it("survives a round trip through pounds", () => {
		expect(kgToUnit(unitToKg(135, "lb"), "lb")).toBe(135);
	});

	it("formats with a French decimal comma", () => {
		expect(formatWeight(12.5, "kg")).toBe("12,5 kg");
	});

	it("formats durations", () => {
		expect(formatDuration(45)).toBe("45 s");
		expect(formatDuration(90)).toBe("1 min 30");
		expect(formatDuration(120)).toBe("2 min");
	});
});
