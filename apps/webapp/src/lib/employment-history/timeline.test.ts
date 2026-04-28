import { describe, expect, it } from "vitest";
import { adjustConfirmedTimeline, findEffectiveEmploymentHistory } from "./timeline";

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe("employment timeline", () => {
	it("closes the previous confirmed row at the new validFrom", () => {
		const adjusted = adjustConfirmedTimeline({
			existing: [
				{ id: "old", validFrom: d("2026-01-01"), validUntil: null, reviewState: "confirmed" },
			],
			next: { id: "new", validFrom: d("2026-04-01"), validUntil: null, reviewState: "confirmed" },
		});

		expect(adjusted.updates).toEqual([{ id: "old", validUntil: d("2026-04-01") }]);
		expect(adjusted.next.validUntil).toBeNull();
	});

	it("bounds a new row before the next future confirmed row", () => {
		const adjusted = adjustConfirmedTimeline({
			existing: [
				{ id: "future", validFrom: d("2026-07-01"), validUntil: null, reviewState: "confirmed" },
			],
			next: { id: "new", validFrom: d("2026-04-01"), validUntil: null, reviewState: "confirmed" },
		});

		expect(adjusted.updates).toEqual([]);
		expect(adjusted.next.validUntil).toEqual(d("2026-07-01"));
	});

	it("preserves a gap before the new confirmed row", () => {
		const adjusted = adjustConfirmedTimeline({
			existing: [
				{
					id: "old",
					validFrom: d("2026-01-01"),
					validUntil: d("2026-03-01"),
					reviewState: "confirmed",
				},
			],
			next: { id: "new", validFrom: d("2026-04-01"), validUntil: null, reviewState: "confirmed" },
		});

		expect(adjusted.updates).toEqual([]);
		expect(adjusted.next.validUntil).toBeNull();
	});

	it("closes same-validFrom confirmed rows so the new row replaces them", () => {
		const adjusted = adjustConfirmedTimeline({
			existing: [
				{ id: "old", validFrom: d("2026-04-01"), validUntil: null, reviewState: "confirmed" },
			],
			next: { id: "new", validFrom: d("2026-04-01"), validUntil: null, reviewState: "confirmed" },
		});

		expect(adjusted.updates).toEqual([{ id: "old", validUntil: d("2026-04-01") }]);
		expect(adjusted.next.validUntil).toBeNull();
	});

	it("ignores draft and pending rows for effective lookup", () => {
		const row = findEffectiveEmploymentHistory(
			[
				{ id: "draft", validFrom: d("2026-01-01"), validUntil: null, reviewState: "draft" },
				{ id: "pending", validFrom: d("2026-01-01"), validUntil: null, reviewState: "pending" },
				{ id: "confirmed", validFrom: d("2026-02-01"), validUntil: null, reviewState: "confirmed" },
			],
			d("2026-03-01"),
		);

		expect(row?.id).toBe("confirmed");
	});

	it("does not return a future confirmed row before it starts", () => {
		const row = findEffectiveEmploymentHistory(
			[{ id: "future", validFrom: d("2026-07-01"), validUntil: null, reviewState: "confirmed" }],
			d("2026-06-30"),
		);

		expect(row).toBeNull();
	});
});
