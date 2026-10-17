import { describe, expect, it } from "vitest";
import {
	canCancelEmploymentHistoryRow,
	shouldConfirmEmploymentHistoryRow,
	shouldUpdateCurrentEmployeeFields,
} from "@/lib/employment-history/write-terms";

const day = (value: string) => new Date(`${value}T00:00:00Z`);
describe("employment terms command eligibility", () => {
	it("projects only confirmed terms in force today", () => {
		const row = {
			validFrom: day("2026-01-01"),
			validUntil: null,
			reviewState: "confirmed" as const,
		};
		expect(shouldUpdateCurrentEmployeeFields(row, day("2026-04-01"))).toBe(true);
		expect(shouldUpdateCurrentEmployeeFields(row, day("2025-12-31"))).toBe(false);
		expect(
			shouldUpdateCurrentEmployeeFields(
				{ ...row, validUntil: day("2026-04-01") },
				day("2026-04-01"),
			),
		).toBe(false);
	});
	it("allows confirmation only for proposals", () => {
		expect(shouldConfirmEmploymentHistoryRow({ reviewState: "draft" })).toBe(true);
		expect(shouldConfirmEmploymentHistoryRow({ reviewState: "pending" })).toBe(true);
		expect(shouldConfirmEmploymentHistoryRow({ reviewState: "confirmed" })).toBe(false);
	});
	it("allows cancelling proposals and strictly future confirmed terms", () => {
		const now = day("2026-04-01");
		expect(
			canCancelEmploymentHistoryRow({ reviewState: "draft", validFrom: day("2026-01-01") }, now),
		).toBe(true);
		expect(
			canCancelEmploymentHistoryRow({ reviewState: "pending", validFrom: day("2026-01-01") }, now),
		).toBe(true);
		expect(
			canCancelEmploymentHistoryRow(
				{ reviewState: "confirmed", validFrom: day("2026-05-01") },
				now,
			),
		).toBe(true);
		expect(canCancelEmploymentHistoryRow({ reviewState: "confirmed", validFrom: now }, now)).toBe(
			false,
		);
	});
});
