import { describe, expect, it } from "vitest";
import {
	getSupportedInboxSources,
	isSupportedInboxType,
} from "@/lib/approvals/inbox/source-adapters";

describe("approval inbox source adapters", () => {
	it("returns only registered live inbox sources", () => {
		const handlers = [
			{
				type: "absence_entry",
				displayName: "Absence Request",
				supportsBulkApprove: true,
			},
			{
				type: "time_entry",
				displayName: "Time Correction",
				supportsBulkApprove: true,
			},
			{
				type: "travel_expense_claim",
				displayName: "Travel Expense",
				supportsBulkApprove: true,
			},
			{
				type: "shift_request",
				displayName: "Shift Request",
				supportsBulkApprove: true,
			},
		];

		expect(
			getSupportedInboxSources(() => handlers as never).map(
				(source) => source.type,
			),
		).toEqual(["absence_entry", "time_entry", "travel_expense_claim"]);
	});

	it("guards supported source types", () => {
		expect(isSupportedInboxType("absence_entry")).toBe(true);
		expect(isSupportedInboxType("shift_request")).toBe(false);
		expect(isSupportedInboxType("unknown")).toBe(false);
	});

	it("keeps ordinary work-period approvals on the existing time-entry source", () => {
		const sources = getSupportedInboxSources(
			() =>
				[
					{
						type: "time_entry",
						displayName: "Time Correction",
						supportsBulkApprove: true,
					},
				] as never,
		);

		expect(sources.map(({ type }) => type)).toEqual(["time_entry"]);
		expect(isSupportedInboxType("manual_time_submission")).toBe(false);
		expect(isSupportedInboxType("policy_clock_out")).toBe(false);
	});
});
