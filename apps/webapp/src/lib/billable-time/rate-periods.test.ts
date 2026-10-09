import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { planRatePeriodChange, type RatePeriod } from "./rate-periods";

const day = (value: string) => Temporal.PlainDate.from(value);

function period(id: string, from: string, to: string | null, value: number): RatePeriod<number> {
	return { id, from: day(from), to: to === null ? null : day(to), value };
}

/** The plan's steps with dates as strings, for readable expectations. */
function steps(plan: ReturnType<typeof planRatePeriodChange<number>>) {
	return plan.steps.map((step) => {
		switch (step.kind) {
			case "shorten":
				return { kind: step.kind, id: step.id, to: step.to.toString() };
			case "insert":
				return {
					kind: step.kind,
					from: step.from.toString(),
					to: step.to?.toString() ?? null,
					value: step.value,
				};
			default:
				return step;
		}
	});
}

describe("setting a rate from a date", () => {
	it("starts the first rate as an open period", () => {
		const plan = planRatePeriodChange<number>([], {
			kind: "set",
			from: day("2026-01-01"),
			value: 90,
		});

		expect(steps(plan)).toEqual([{ kind: "insert", from: "2026-01-01", to: null, value: 90 }]);
		expect(plan.previous).toBeNull();
	});

	it("closes the open rate at that date", () => {
		const plan = planRatePeriodChange([period("a", "2026-01-01", null, 90)], {
			kind: "set",
			from: day("2026-07-01"),
			value: 100,
		});

		expect(steps(plan)).toEqual([
			{ kind: "shorten", id: "a", to: "2026-07-01" },
			{ kind: "insert", from: "2026-07-01", to: null, value: 100 },
		]);
		expect(plan.previous).toEqual({ id: "a", value: 90 });
	});

	it("backdated into a closed period, applies until that period's next change", () => {
		const plan = planRatePeriodChange(
			[period("a", "2026-01-01", "2026-07-01", 90), period("b", "2026-07-01", null, 100)],
			{ kind: "set", from: day("2026-03-01"), value: 95 },
		);

		expect(steps(plan)).toEqual([
			{ kind: "shorten", id: "a", to: "2026-03-01" },
			{ kind: "insert", from: "2026-03-01", to: "2026-07-01", value: 95 },
		]);
	});

	it("backdated before the first rate, applies until the first rate starts", () => {
		const plan = planRatePeriodChange([period("a", "2026-03-01", null, 90)], {
			kind: "set",
			from: day("2025-11-15"),
			value: 80,
		});

		expect(steps(plan)).toEqual([
			{ kind: "insert", from: "2025-11-15", to: "2026-03-01", value: 80 },
		]);
		expect(plan.previous).toBeNull();
	});

	it("fills a gap up to the next rate", () => {
		const plan = planRatePeriodChange(
			[period("a", "2026-01-01", "2026-02-01", 90), period("b", "2026-05-01", null, 100)],
			{ kind: "set", from: day("2026-03-01"), value: 95 },
		);

		expect(steps(plan)).toEqual([
			{ kind: "insert", from: "2026-03-01", to: "2026-05-01", value: 95 },
		]);
	});

	it("changes the value of a period that starts on that date", () => {
		const plan = planRatePeriodChange([period("a", "2026-01-01", "2026-07-01", 90)], {
			kind: "set",
			from: day("2026-01-01"),
			value: 92,
		});

		expect(steps(plan)).toEqual([{ kind: "update_value", id: "a", value: 92 }]);
		expect(plan.previous).toEqual({ id: "a", value: 90 });
	});

	it("changes nothing when that rate is already in effect", () => {
		const plan = planRatePeriodChange([period("a", "2026-01-01", null, 90)], {
			kind: "set",
			from: day("2026-04-01"),
			value: 90,
		});

		expect(plan.steps).toEqual([]);
	});
});

describe("ending a rate from a date", () => {
	it("closes the period in effect at that date", () => {
		const plan = planRatePeriodChange([period("a", "2026-01-01", null, 90)], {
			kind: "end",
			from: day("2026-06-01"),
		});

		expect(steps(plan)).toEqual([{ kind: "shorten", id: "a", to: "2026-06-01" }]);
		expect(plan.previous).toEqual({ id: "a", value: 90 });
	});

	it("removes a period ended on its own first day, keeping later changes", () => {
		const plan = planRatePeriodChange(
			[period("a", "2026-01-01", "2026-06-01", 90), period("b", "2026-06-01", null, 100)],
			{ kind: "end", from: day("2026-01-01") },
		);

		expect(steps(plan)).toEqual([{ kind: "delete", id: "a" }]);
	});

	it("changes nothing where no rate is in effect", () => {
		const plan = planRatePeriodChange([period("a", "2026-01-01", "2026-02-01", 90)], {
			kind: "end",
			from: day("2026-03-01"),
		});

		expect(plan.steps).toEqual([]);
		expect(plan.previous).toBeNull();
	});
});

it("refuses a history whose periods overlap", () => {
	expect(() =>
		planRatePeriodChange(
			[period("a", "2026-01-01", null, 90), period("b", "2026-03-01", null, 100)],
			{ kind: "end", from: day("2026-04-01") },
		),
	).toThrow(/overlap/);
});
