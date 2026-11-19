import { describe, expect, it } from "vitest";
import {
	applyClosure,
	applyReceipt,
	isFullyReceived,
	outstandingQuantity,
	receivableQuantity,
	settle,
	settlementViolation,
} from "./settlement";
import {
	lost,
	REFUSED_CASES,
	recovered,
	returned,
	SETTLED_CASES,
	SHIRTS,
	waived,
} from "./settlement.test-fixture";

const NOTHING_YET = { received: 0, lost: 0, waived: 0, recovered: 0 };

describe("applyReceipt", () => {
	it("adds a physical receipt", () => {
		expect(applyReceipt({ ...SHIRTS, ...NOTHING_YET }, 2)).toEqual({
			ok: true,
			settlement: { ...SHIRTS, ...NOTHING_YET, received: 2 },
			recovery: null,
		});
	});

	it.each([
		{
			name: "a receipt larger than the outstanding return",
			settlement: { ...SHIRTS, ...NOTHING_YET, received: 1, lost: 2 },
			quantity: 1,
		},
		{
			name: "a recovery larger than the decision has left",
			settlement: { ...SHIRTS, ...NOTHING_YET, lost: 2, recovered: 1, received: 1 },
			quantity: 2,
			decision: { quantity: 2, recovered: 1 },
		},
	])("refuses $name", ({ settlement, quantity, decision }) => {
		expect(applyReceipt(settlement, quantity, decision)).toEqual({
			ok: false,
			reason: "excess_quantity",
		});
	});

	it("receives equipment issued to keep up to what is still held", () => {
		const kept = { ...NOTHING_YET, quantity: 3, returnRequired: false };
		expect(applyReceipt({ ...kept, received: 1 }, 2)).toMatchObject({
			ok: true,
			settlement: { received: 3 },
		});
		expect(applyReceipt({ ...kept, received: 1 }, 3)).toEqual({
			ok: false,
			reason: "excess_quantity",
		});
	});

	it("records a recovery against its decision without lowering the outstanding return again", () => {
		const result = applyReceipt({ ...SHIRTS, ...NOTHING_YET, received: 1, lost: 2 }, 1, {
			quantity: 2,
			recovered: 0,
		});
		expect(result).toEqual({
			ok: true,
			settlement: { ...SHIRTS, received: 2, lost: 2, waived: 0, recovered: 1 },
			recovery: { quantity: 2, recovered: 1 },
		});
		if (result.ok) expect(outstandingQuantity(result.settlement)).toBe(0);
	});

	it("receives everything once the loss that settled a transfer is recovered", () => {
		// 3 issued, 2 lost, 1 received in a transfer: nothing outstanding, yet not received.
		const transferred = { ...SHIRTS, ...NOTHING_YET, received: 1, lost: 2 };
		expect(outstandingQuantity(transferred)).toBe(0);
		expect(isFullyReceived(transferred)).toBe(false);
		const result = applyReceipt(transferred, 2, { quantity: 2, recovered: 0 });
		if (!result.ok) throw new Error(result.reason);
		expect(isFullyReceived(result.settlement)).toBe(true);
		expect(outstandingQuantity(result.settlement)).toBe(0);
	});
});

describe("applyClosure", () => {
	it.each(["lost", "waived"] as const)("closes part of the outstanding return as %s", (outcome) => {
		const settlement = { ...SHIRTS, ...NOTHING_YET, received: 1 };
		expect(applyClosure(settlement, outcome, 1)).toEqual({
			ok: true,
			settlement: { ...settlement, [outcome]: 1 },
		});
	});

	it("refuses to close more than the outstanding return", () => {
		expect(applyClosure({ ...SHIRTS, ...NOTHING_YET, received: 1 }, "lost", 3)).toEqual({
			ok: false,
			reason: "excess_quantity",
		});
	});

	it("refuses to close equipment issued to keep", () => {
		expect(
			applyClosure({ ...NOTHING_YET, quantity: 3, returnRequired: false }, "waived", 1),
		).toEqual({ ok: false, reason: "return_not_required" });
	});
});

describe("settle", () => {
	it.each(SETTLED_CASES)("$name", ({ terms, receipts, exceptions, counts, ...derived }) => {
		const result = settle(terms, receipts, exceptions);
		if (!result.ok) throw new Error(result.reason);
		expect(result.settlement).toEqual({ ...terms, ...counts });
		expect(outstandingQuantity(result.settlement)).toBe(derived.outstanding);
		expect(receivableQuantity(result.settlement)).toBe(derived.receivable);
		expect(isFullyReceived(result.settlement)).toBe(derived.fullyReceived);
	});

	it.each(REFUSED_CASES)("refuses $name", ({ terms, receipts, exceptions, reason, counts }) => {
		expect(settle(terms, receipts, exceptions)).toEqual({
			ok: false,
			reason,
		});
		// Each refusal also breaks the stored totals the database checks.
		expect(settlementViolation({ ...terms, ...counts })).not.toBeNull();
	});

	it("checks recoveries per decision before the whole settlement", () => {
		expect(
			settle({ quantity: 1, returnRequired: true }, [returned(1), recovered(2, "loss")], [lost(1)]),
		).toEqual({ ok: false, reason: "recovery_conflict" });
	});

	it("refuses an over-recovered exception even when the assignment totals balance", () => {
		expect(settle(SHIRTS, [recovered(2, "loss")], [lost(1), waived(2)])).toEqual({
			ok: false,
			reason: "recovery_conflict",
		});
	});

	it("reports what each decision has recovered", () => {
		const result = settle(
			SHIRTS,
			[recovered(1, "loss"), recovered(1, "waiver"), recovered(0, "loss")],
			[lost(1), waived(2)],
		);
		if (!result.ok) throw new Error(result.reason);
		expect(result.recoveredByException).toEqual(
			new Map([
				["loss", 1],
				["waiver", 1],
			]),
		);
	});

	it("does not depend on record order", () => {
		const exceptions = [lost(1), waived(1)];
		const receipts = [returned(1), recovered(1, "waiver"), recovered(1, "loss")];
		const terms = { quantity: 4, returnRequired: true };
		expect(settle(terms, receipts, exceptions)).toEqual(
			settle(terms, [...receipts].reverse(), [...exceptions].reverse()),
		);
	});
});
