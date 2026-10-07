import { describe, expect, it } from "vitest";
import { decideReopen, parseReopenReason, REOPEN_REASON_MAX_LENGTH } from "../report-reopen";

const allowed = {
	status: "approved" as const,
	approvalRecorded: true,
	ownReport: false,
	authorized: true,
	reimbursed: false,
	exported: false,
};

describe("parseReopenReason (#614)", () => {
	it("requires a reason and keeps it trimmed", () => {
		expect(parseReopenReason("  ")).toEqual({ ok: false, error: "reason_required" });
		expect(parseReopenReason("  Wrong hotel invoice \n")).toEqual({
			ok: true,
			value: "Wrong hotel invoice",
		});
	});

	it("refuses an overlong reason", () => {
		expect(parseReopenReason("x".repeat(REOPEN_REASON_MAX_LENGTH))).toMatchObject({ ok: true });
		expect(parseReopenReason("x".repeat(REOPEN_REASON_MAX_LENGTH + 1))).toEqual({
			ok: false,
			error: "reason_too_long",
		});
	});
});

describe("decideReopen (#614)", () => {
	it("lets an authorized approver reopen an approved, unexported and unpaid report", () => {
		expect(decideReopen(allowed)).toEqual({ kind: "allowed" });
	});

	it("only reopens reports whose current submission is approved", () => {
		for (const status of ["draft", "submitted", "returned", "rejected"] as const) {
			expect(decideReopen({ ...allowed, status })).toEqual({ kind: "not_approved" });
		}
		expect(decideReopen({ ...allowed, approvalRecorded: false })).toEqual({
			kind: "not_approved",
		});
	});

	it("never lets employees reopen their own report or unauthorized people reopen any", () => {
		expect(decideReopen({ ...allowed, ownReport: true })).toEqual({ kind: "forbidden" });
		expect(decideReopen({ ...allowed, authorized: false })).toEqual({ kind: "forbidden" });
		// Authorization is decided before the status, export or payment facts are revealed.
		expect(decideReopen({ ...allowed, authorized: false, reimbursed: true })).toEqual({
			kind: "forbidden",
		});
		expect(decideReopen({ ...allowed, authorized: false, status: "returned" })).toEqual({
			kind: "forbidden",
		});
	});

	it("sends exported or reimbursed reports to a linked adjustment instead", () => {
		expect(decideReopen({ ...allowed, reimbursed: true })).toEqual({
			kind: "adjustment_required",
			reason: "reimbursed",
		});
		expect(decideReopen({ ...allowed, exported: true })).toEqual({
			kind: "adjustment_required",
			reason: "exported",
		});
		// Money recorded is the stronger fact.
		expect(decideReopen({ ...allowed, exported: true, reimbursed: true })).toEqual({
			kind: "adjustment_required",
			reason: "reimbursed",
		});
	});
});
