import { describe, expect, it } from "vitest";
import {
	adjustmentDelta,
	adjustmentEligibility,
	composeAdjustmentBaseline,
	parseAdjustmentReason,
	sameAdjustmentBaseline,
} from "../adjustment";

const original = {
	originalReportId: "report-1",
	revisionId: "revision-1",
	submissionCycle: 1,
	currency: "EUR",
	approvedAmount: "500.00",
};

describe("parseAdjustmentReason (#615)", () => {
	it("requires a trimmed reason of at most 1000 characters", () => {
		expect(parseAdjustmentReason("  Hotel invoice was corrected  ")).toEqual({
			ok: true,
			reason: "Hotel invoice was corrected",
		});
		expect(parseAdjustmentReason("   ")).toEqual({ ok: false, code: "required" });
		expect(parseAdjustmentReason("x".repeat(1001))).toEqual({ ok: false, code: "too_long" });
	});
});

describe("composeAdjustmentBaseline (#615)", () => {
	it("is the approved entitlement when nothing was adjusted yet", () => {
		expect(composeAdjustmentBaseline(original, [])).toEqual({
			...original,
			adjustments: [],
			entitlement: "500.00",
		});
	});

	it("adds every approved adjustment exactly once, in a stable order", () => {
		const baseline = composeAdjustmentBaseline(original, [
			{ reportId: "adjustment-b", revisionId: "revision-b", delta: "12.30" },
			{ reportId: "adjustment-a", revisionId: "revision-a", delta: "-50.00" },
		]);
		expect(baseline.entitlement).toBe("462.30");
		expect(baseline.adjustments.map((entry) => entry.reportId)).toEqual([
			"adjustment-a",
			"adjustment-b",
		]);
		expect(() =>
			composeAdjustmentBaseline(original, [
				{ reportId: "adjustment-a", revisionId: "revision-a", delta: "-50.00" },
				{ reportId: "adjustment-a", revisionId: "revision-a", delta: "-50.00" },
			]),
		).toThrow(RangeError);
	});
});

describe("adjustmentDelta (#615)", () => {
	it("is the signed difference from the applicable approved entitlement", () => {
		// The spec's example: EUR 500 approved and paid, corrected to EUR 450.
		const baseline = composeAdjustmentBaseline(original, []);
		expect(adjustmentDelta({ amount: "450.00", currency: "EUR" }, baseline)).toEqual({
			amount: "-50.00",
			currency: "EUR",
		});
		expect(adjustmentDelta({ amount: "512.40", currency: "EUR" }, baseline)).toEqual({
			amount: "12.40",
			currency: "EUR",
		});
	});

	it("uses the then-effective baseline for a later correction", () => {
		const afterFirst = composeAdjustmentBaseline(original, [
			{ reportId: "adjustment-a", revisionId: "revision-a", delta: "-50.00" },
		]);
		// Corrected again to EUR 430: -20 against EUR 450, never -70 against EUR 500.
		expect(adjustmentDelta({ amount: "430.00", currency: "EUR" }, afterFirst)).toEqual({
			amount: "-20.00",
			currency: "EUR",
		});
	});

	it("never mixes currencies", () => {
		const baseline = composeAdjustmentBaseline(original, []);
		expect(() => adjustmentDelta({ amount: "450.00", currency: "USD" }, baseline)).toThrow(
			RangeError,
		);
	});
});

describe("sameAdjustmentBaseline (#615)", () => {
	it("detects a baseline that another approved adjustment changed", () => {
		const before = composeAdjustmentBaseline(original, []);
		const after = composeAdjustmentBaseline(original, [
			{ reportId: "adjustment-a", revisionId: "revision-a", delta: "0.00" },
		]);
		expect(sameAdjustmentBaseline(before, composeAdjustmentBaseline(original, []))).toBe(true);
		// Even a zero delta is another applied adjustment: the baseline is stale.
		expect(sameAdjustmentBaseline(before, after)).toBe(false);
		expect(
			sameAdjustmentBaseline(
				before,
				composeAdjustmentBaseline({ ...original, revisionId: "r2" }, []),
			),
		).toBe(false);
	});
});

describe("adjustmentEligibility (#615)", () => {
	it("admits only approved originals that were exported or reimbursed", () => {
		const base = { approved: true, isAdjustment: false, exported: false, reimbursed: false };
		expect(adjustmentEligibility({ ...base, exported: true })).toEqual({ ok: true });
		expect(adjustmentEligibility({ ...base, reimbursed: true })).toEqual({ ok: true });
		// Before export or reimbursement the report is reopened instead (#614).
		expect(adjustmentEligibility(base)).toEqual({
			ok: false,
			reason: "not_exported_or_reimbursed",
		});
		expect(adjustmentEligibility({ ...base, approved: false, exported: true })).toEqual({
			ok: false,
			reason: "not_approved",
		});
		// Adjustments always correct the original report's account.
		expect(adjustmentEligibility({ ...base, isAdjustment: true, exported: true })).toEqual({
			ok: false,
			reason: "is_adjustment",
		});
	});
});
