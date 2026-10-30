import { describe, expect, it } from "vitest";
import { cellText } from "@/components/BlockSheet";

const empty = { reps: null, weight: null, duration: null, distance: null };

describe("cellText", () => {
	it("names each value with its unit", () => {
		expect(
			cellText("reps", "required", { ...empty, reps: 8, weight: 60 }, "kg"),
		).toEqual({
			main: "8 reps",
			sub: "60 kg",
			empty: false,
		});
	});

	it("flags the value still to enter", () => {
		expect(
			cellText("reps", "required", { ...empty, reps: 8 }, "kg"),
		).toMatchObject({
			main: "8 reps",
			sub: "kg ?",
			empty: false,
		});
		expect(cellText("time", "none", { ...empty, reps: 8 }, "kg").main).toBe(
			"durée ?",
		);
	});

	it("marks a cell with nothing entered as empty", () => {
		expect(cellText("time", "none", empty, "kg").empty).toBe(true);
	});

	it("shows durations and distances in the column's mode", () => {
		expect(cellText("time", "none", { ...empty, duration: 60 }, "kg")).toEqual({
			main: "1 min",
			sub: "",
			empty: false,
		});
		expect(
			cellText("time", "none", { ...empty, duration: 50 }, "kg").main,
		).toBe("50 s");
		expect(
			cellText("distance", "none", { ...empty, distance: 500 }, "kg").main,
		).toBe("500 m");
	});

	it("spells out bodyweight, extra load and assistance", () => {
		expect(cellText("reps", "optional", { ...empty, reps: 10 }, "kg").sub).toBe(
			"poids du corps",
		);
		expect(
			cellText("reps", "optional", { ...empty, reps: 6, weight: 10 }, "kg").sub,
		).toBe("+10 kg lest");
		expect(
			cellText("reps", "optional", { ...empty, reps: 6, weight: -20 }, "kg")
				.sub,
		).toBe("20 kg d'aide");
		expect(cellText("reps", "none", { ...empty, reps: 20 }, "kg").sub).toBe("");
	});
});
