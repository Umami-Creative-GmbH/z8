import { describe, expect, it } from "vitest";
import { isEditableReportStatus, parseReturnReportInput } from "../report-return";

const items = ["item-a", "item-b", "item-c"] as const;

describe("isEditableReportStatus (#603)", () => {
	it("lets the employee edit drafts and returned reports only", () => {
		expect(isEditableReportStatus("draft")).toBe(true);
		expect(isEditableReportStatus("returned")).toBe(true);
		expect(isEditableReportStatus("submitted")).toBe(false);
		expect(isEditableReportStatus("approved")).toBe(false);
		// Rejected reports are terminal.
		expect(isEditableReportStatus("rejected")).toBe(false);
	});
});

describe("parseReturnReportInput (#603)", () => {
	it("requires a reviewer note", () => {
		expect(parseReturnReportInput({ note: "   ", itemComments: [] }, items)).toEqual({
			ok: false,
			error: "note_required",
		});
	});

	it("trims the note and comments, drops empty comments and orders comments like the report", () => {
		expect(
			parseReturnReportInput(
				{
					note: "  Please fix the hotel  ",
					itemComments: [
						{ itemId: "item-c", body: " Wrong date " },
						{ itemId: "item-b", body: "   " },
						{ itemId: "item-a", body: "Receipt unreadable" },
					],
				},
				items,
			),
		).toEqual({
			ok: true,
			value: {
				note: "Please fix the hotel",
				itemComments: [
					{ itemId: "item-a", body: "Receipt unreadable" },
					{ itemId: "item-c", body: "Wrong date" },
				],
			},
		});
	});

	it("refuses comments on items that are not part of the submitted revision", () => {
		expect(
			parseReturnReportInput(
				{ note: "Fix it", itemComments: [{ itemId: "other", body: "?" }] },
				items,
			),
		).toEqual({ ok: false, error: "unknown_item" });
	});

	it("refuses two comments on the same item", () => {
		expect(
			parseReturnReportInput(
				{
					note: "Fix it",
					itemComments: [
						{ itemId: "item-a", body: "One" },
						{ itemId: "item-a", body: "Two" },
					],
				},
				items,
			),
		).toEqual({ ok: false, error: "duplicate_item" });
	});

	it("bounds the note and comment length", () => {
		expect(parseReturnReportInput({ note: "x".repeat(2001), itemComments: [] }, items)).toEqual({
			ok: false,
			error: "note_too_long",
		});
		expect(
			parseReturnReportInput(
				{ note: "Fix", itemComments: [{ itemId: "item-a", body: "y".repeat(1001) }] },
				items,
			),
		).toEqual({ ok: false, error: "comment_too_long" });
	});
});
