import { describe, expect, it } from "vitest";
import { normalizeTravelExpenseDetailEntity } from "./approval-detail-panel";

describe("normalizeTravelExpenseDetailEntity", () => {
	it("converts serialized trip dates into Date objects", () => {
		const normalized = normalizeTravelExpenseDetailEntity({
			tripStart: "2026-04-15T00:00:00.000Z",
			tripEnd: "2026-04-17T00:00:00.000Z",
			destinationCity: "Berlin",
			calculatedCurrency: "EUR",
			calculatedAmount: "120.50",
			notes: "Client visit",
		});

		expect(normalized.tripStart).toBeInstanceOf(Date);
		expect(normalized.tripEnd).toBeInstanceOf(Date);
		expect(normalized.tripStart.toISOString()).toBe("2026-04-15T00:00:00.000Z");
		expect(normalized.tripEnd.toISOString()).toBe("2026-04-17T00:00:00.000Z");
	});
});
