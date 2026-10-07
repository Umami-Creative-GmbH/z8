import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	checkReceiptExceptionAcceptance,
	frozenReceiptException,
	MAX_RECEIPT_EXCEPTION_REASON_LENGTH,
	missingReceiptRequirements,
	parseReceiptExceptionDraft,
	receiptExceptionContext,
} from "../receipt-exception";
import { type ReceiptItemDraft, receiptItemMissingRequirements } from "../receipt-report";

const complete: ReceiptItemDraft = {
	expenseDate: "2026-09-14",
	category: "meals",
	description: "Team dinner",
	amount: "42.00",
	currency: "EUR",
	paidBy: "employee",
	accountingReference: null,
};

describe("parseReceiptExceptionDraft", () => {
	it("withdraws the exception when it is not requested, whatever was typed", () => {
		expect(parseReceiptExceptionDraft({ requested: false, reason: "lost it" })).toEqual({
			ok: true,
			reason: null,
		});
	});

	it("keeps a trimmed explanation of a requested exception", () => {
		expect(
			parseReceiptExceptionDraft({ requested: true, reason: "  Taxi driver had no printer " }),
		).toEqual({ ok: true, reason: "Taxi driver had no printer" });
	});

	it("refuses a requested exception without an explanation", () => {
		expect(parseReceiptExceptionDraft({ requested: true, reason: "   " })).toEqual({
			ok: false,
			error: "reason_required",
		});
		expect(parseReceiptExceptionDraft({ requested: true, reason: null })).toEqual({
			ok: false,
			error: "reason_required",
		});
	});

	it("refuses an explanation that is too long", () => {
		expect(
			parseReceiptExceptionDraft({
				requested: true,
				reason: "x".repeat(MAX_RECEIPT_EXCEPTION_REASON_LENGTH + 1),
			}),
		).toEqual({ ok: false, error: "too_long" });
	});
});

describe("missing receipt requirements", () => {
	it("still requires the receipt when no exception is requested", () => {
		expect(missingReceiptRequirements(undefined)).toEqual(["receipt"]);
		expect(missingReceiptRequirements(receiptExceptionContext(null, true))).toEqual(["receipt"]);
	});

	it("is satisfied by an explained exception only while the organization allows them", () => {
		expect(missingReceiptRequirements(receiptExceptionContext("Lost on the train", true))).toEqual(
			[],
		);
		expect(missingReceiptRequirements(receiptExceptionContext("Lost on the train", false))).toEqual(
			["receipt_exception_not_allowed"],
		);
	});

	it("asks for the explanation of a requested exception", () => {
		expect(missingReceiptRequirements({ allowed: true, requested: true, reason: null })).toEqual([
			"receipt_exception_reason",
		]);
		expect(missingReceiptRequirements({ allowed: true, requested: true, reason: " " })).toEqual([
			"receipt_exception_reason",
		]);
	});

	it("applies inside the receipt item requirements, and an attached receipt needs no exception", () => {
		const context = { reimbursementCurrency: "EUR", now: parseInstant("2026-10-07T12:00:00Z") };
		expect(receiptItemMissingRequirements(complete, { ...context, receiptCount: 0 })).toEqual([
			"receipt",
		]);
		expect(
			receiptItemMissingRequirements(complete, {
				...context,
				receiptCount: 0,
				receiptException: receiptExceptionContext("Lost on the train", true),
			}),
		).toEqual([]);
		expect(
			receiptItemMissingRequirements(complete, {
				...context,
				receiptCount: 0,
				receiptException: receiptExceptionContext("Lost on the train", false),
			}),
		).toEqual(["receipt_exception_not_allowed"]);
		expect(
			receiptItemMissingRequirements(complete, {
				...context,
				receiptCount: 1,
				receiptException: receiptExceptionContext("Lost on the train", false),
			}),
		).toEqual([]);
	});
});

describe("frozenReceiptException", () => {
	it("freezes an explained exception of an expense without receipts", () => {
		expect(frozenReceiptException("Lost on the train", 0)).toEqual({
			reason: "Lost on the train",
		});
	});

	it("freezes nothing once a receipt is attached or nothing was requested", () => {
		expect(frozenReceiptException("Lost on the train", 1)).toBeNull();
		expect(frozenReceiptException(null, 0)).toBeNull();
	});
});

describe("checkReceiptExceptionAcceptance", () => {
	const items = [
		{ itemId: "item-a", receiptException: { reason: "Lost" } },
		{ itemId: "item-b" },
		{ itemId: "item-c", receiptException: { reason: "Machine broken" } },
	];

	it("approves only with every exception accepted, recording them in a stable order", () => {
		expect(
			checkReceiptExceptionAcceptance(items, "approve", ["item-c", "item-a", "item-c"]),
		).toEqual({ ok: true, accepted: ["item-a", "item-c"] });
	});

	it("refuses an approval that leaves an exception unaccepted", () => {
		expect(checkReceiptExceptionAcceptance(items, "approve", ["item-a"])).toEqual({
			ok: false,
			reason: "not_accepted",
			itemIds: ["item-c"],
		});
		expect(checkReceiptExceptionAcceptance(items, "approve", undefined)).toEqual({
			ok: false,
			reason: "not_accepted",
			itemIds: ["item-a", "item-c"],
		});
	});

	it("refuses accepting an expense that has no exception or is not in the report", () => {
		expect(
			checkReceiptExceptionAcceptance(items, "approve", ["item-a", "item-c", "item-b"]),
		).toEqual({ ok: false, reason: "unknown_item", itemIds: ["item-b"] });
		expect(
			checkReceiptExceptionAcceptance(items, "approve", ["item-a", "item-c", "foreign"]),
		).toEqual({ ok: false, reason: "unknown_item", itemIds: ["foreign"] });
	});

	it("needs no acceptance for a report without exceptions or a decision other than approve", () => {
		expect(checkReceiptExceptionAcceptance([{ itemId: "item-b" }], "approve", [])).toEqual({
			ok: true,
			accepted: [],
		});
		expect(checkReceiptExceptionAcceptance(items, "reject", ["item-a"])).toEqual({
			ok: true,
			accepted: [],
		});
	});
});
