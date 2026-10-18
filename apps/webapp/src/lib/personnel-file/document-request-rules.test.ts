import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
	dueDocumentRequestReminder,
	isDocumentRequestOverdue,
	nextDocumentRequestStatus,
	validateDocumentRequestInput,
	validateDocumentRequestReason,
} from "./document-request-rules";

const today = Temporal.PlainDate.from("2026-10-18");

describe("validateDocumentRequestInput", () => {
	const valid = {
		category: "certificate",
		title: "  First aid refresher ",
		note: "  Please bring the new card. ",
		deadline: "2026-10-31",
	};

	it("accepts a certificate or other request and trims its text", () => {
		expect(validateDocumentRequestInput(valid, today)).toEqual({
			ok: true,
			value: {
				category: "certificate",
				title: "First aid refresher",
				note: "Please bring the new card.",
				deadline: "2026-10-31",
			},
		});
		expect(
			validateDocumentRequestInput({ ...valid, category: "other", note: "  " }, today),
		).toEqual({
			ok: true,
			value: {
				category: "other",
				title: "First aid refresher",
				note: null,
				deadline: "2026-10-31",
			},
		});
	});

	it("refuses contract, payslip and sick note requests", () => {
		for (const category of ["contract", "payslip", "sick_note", "nonsense", undefined]) {
			expect(validateDocumentRequestInput({ ...valid, category }, today)).toEqual({
				ok: false,
				reason: "category_not_requestable",
			});
		}
	});

	it("requires a title of at most 200 characters", () => {
		expect(validateDocumentRequestInput({ ...valid, title: "   " }, today)).toEqual({
			ok: false,
			reason: "invalid_title",
		});
		expect(validateDocumentRequestInput({ ...valid, title: "x".repeat(201) }, today)).toEqual({
			ok: false,
			reason: "invalid_title",
		});
	});

	it("limits the note to 2000 characters", () => {
		expect(validateDocumentRequestInput({ ...valid, note: "x".repeat(2001) }, today)).toEqual({
			ok: false,
			reason: "invalid_note",
		});
		expect(validateDocumentRequestInput({ ...valid, note: 5 }, today)).toEqual({
			ok: false,
			reason: "invalid_note",
		});
	});

	it("requires a real calendar day as the deadline, today or later", () => {
		for (const deadline of ["2026-02-30", "31.10.2026", "", null]) {
			expect(validateDocumentRequestInput({ ...valid, deadline }, today)).toEqual({
				ok: false,
				reason: "invalid_deadline",
			});
		}
		expect(validateDocumentRequestInput({ ...valid, deadline: "2026-10-17" }, today)).toEqual({
			ok: false,
			reason: "deadline_in_past",
		});
		expect(validateDocumentRequestInput({ ...valid, deadline: "2026-10-18" }, today).ok).toBe(true);
	});
});

describe("nextDocumentRequestStatus", () => {
	it("follows open → submitted → accepted, with returns and cancels", () => {
		expect(nextDocumentRequestStatus("open", "submitted")).toBe("submitted");
		expect(nextDocumentRequestStatus("submitted", "returned")).toBe("open");
		expect(nextDocumentRequestStatus("submitted", "accepted")).toBe("accepted");
		expect(nextDocumentRequestStatus("open", "cancelled")).toBe("cancelled");
		expect(nextDocumentRequestStatus("submitted", "cancelled")).toBe("cancelled");
		expect(nextDocumentRequestStatus("open", "edited")).toBe("open");
		expect(nextDocumentRequestStatus("submitted", "edited")).toBe("submitted");
	});

	it("refuses every other step, so a stale decision conflicts", () => {
		expect(nextDocumentRequestStatus("open", "accepted")).toBeNull();
		expect(nextDocumentRequestStatus("open", "returned")).toBeNull();
		expect(nextDocumentRequestStatus("submitted", "submitted")).toBeNull();
		for (const kind of ["submitted", "returned", "accepted", "cancelled", "edited"] as const) {
			expect(nextDocumentRequestStatus("accepted", kind)).toBeNull();
			expect(nextDocumentRequestStatus("cancelled", kind)).toBeNull();
		}
	});
});

describe("isDocumentRequestOverdue", () => {
	it("is overdue only while open and after the deadline day", () => {
		expect(isDocumentRequestOverdue({ status: "open", deadline: "2026-10-17" }, today)).toBe(true);
		expect(isDocumentRequestOverdue({ status: "open", deadline: "2026-10-18" }, today)).toBe(false);
		expect(isDocumentRequestOverdue({ status: "submitted", deadline: "2026-10-01" }, today)).toBe(
			false,
		);
		expect(isDocumentRequestOverdue({ status: "cancelled", deadline: "2026-10-01" }, today)).toBe(
			false,
		);
	});
});

describe("dueDocumentRequestReminder", () => {
	// Opened (created or last returned) well before the reminder days.
	const due = (
		deadline: string,
		options: { status?: "open" | "submitted"; openedOn?: string } = {},
	) =>
		dueDocumentRequestReminder({
			status: options.status ?? "open",
			deadline,
			openedOn: Temporal.PlainDate.from(options.openedOn ?? "2026-10-01"),
			today,
		});

	it("reminds 3 days before the deadline and on the deadline day, nothing in between", () => {
		expect(due("2026-10-22")).toBeNull();
		expect(due("2026-10-21")).toBe("three_days_before");
		expect(due("2026-10-20")).toBeNull();
		expect(due("2026-10-19")).toBeNull();
		expect(due("2026-10-18")).toBe("deadline_day");
	});

	it("is overdue from the first day after the deadline", () => {
		expect(due("2026-10-17")).toBe("overdue");
		// A later day still finds an overdue reminder that was never sent (the ledger keeps it once).
		expect(due("2026-10-01")).toBe("overdue");
	});

	it("never reminds a submitted, accepted or cancelled request", () => {
		for (const status of ["submitted", "accepted", "cancelled"] as const) {
			for (const deadline of ["2026-10-21", "2026-10-18", "2026-10-17"]) {
				expect(
					dueDocumentRequestReminder({
						status,
						deadline,
						openedOn: Temporal.PlainDate.from("2026-10-01"),
						today,
					}),
				).toBeNull();
			}
		}
	});

	it("sends no day reminder on the day the request was created or returned", () => {
		// The creation or return notification already names the deadline.
		expect(due("2026-10-21", { openedOn: "2026-10-18" })).toBeNull();
		expect(due("2026-10-18", { openedOn: "2026-10-18" })).toBeNull();
		expect(due("2026-10-21", { openedOn: "2026-10-17" })).toBe("three_days_before");
		// A request returned after its deadline is overdue at once.
		expect(due("2026-10-10", { openedOn: "2026-10-18" })).toBe("overdue");
	});
});

describe("validateDocumentRequestReason", () => {
	it("requires a trimmed reason of at most 2000 characters", () => {
		expect(validateDocumentRequestReason("  No longer needed ")).toEqual({
			ok: true,
			value: "No longer needed",
		});
		expect(validateDocumentRequestReason("  ")).toEqual({ ok: false, reason: "reason_required" });
		expect(validateDocumentRequestReason(undefined)).toEqual({
			ok: false,
			reason: "reason_required",
		});
		expect(validateDocumentRequestReason("x".repeat(2001))).toEqual({
			ok: false,
			reason: "invalid_reason",
		});
	});
});
