import { describe, expect, it } from "vitest";
import { instantToCanonicalString, parseInstant } from "@/lib/datetime/temporal-core";
import { sortHistoryByInstant } from "../report-history";

describe("sortHistoryByInstant", () => {
	it("orders by instant even when trailing zero milliseconds were dropped", () => {
		// A submission at .800 serializes canonically as "…30.8Z"; a withdrawal
		// 41 ms later comes from Date.toISOString as "…30.841Z". As strings,
		// "30.8Z" sorts after "30.841Z" and the history flipped.
		const submittedAt = instantToCanonicalString(parseInstant("2026-10-06T08:15:30.800Z"));
		expect(submittedAt).toBe("2026-10-06T08:15:30.8Z");
		const withdrawnAt = new Date("2026-10-06T08:15:30.841Z").toISOString();
		const events = [
			{ id: "withdrawn", at: withdrawnAt },
			{ id: "submitted", at: submittedAt },
		];
		expect(events.toSorted((left, right) => left.at.localeCompare(right.at))[0]?.id).toBe(
			"withdrawn",
		);

		expect(sortHistoryByInstant(events).map((event) => event.id)).toEqual([
			"submitted",
			"withdrawn",
		]);
	});

	it("keeps the order of events at the same instant", () => {
		const events = [
			{ id: "submitted", at: "2026-10-06T08:15:30Z" },
			{ id: "approval_recorded", at: "2026-10-06T08:15:30.000Z" },
			{ id: "earlier", at: "2026-10-06T08:15:29.999Z" },
		];
		expect(sortHistoryByInstant(events).map((event) => event.id)).toEqual([
			"earlier",
			"submitted",
			"approval_recorded",
		]);
	});
});
