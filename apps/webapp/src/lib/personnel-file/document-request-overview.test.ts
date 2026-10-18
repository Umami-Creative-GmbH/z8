import { describe, expect, it } from "vitest";
import { parseDocumentRequestOverviewParams } from "./document-request-overview";

describe("parseDocumentRequestOverviewParams", () => {
	it("defaults to the active requests, all of them, first page", () => {
		expect(parseDocumentRequestOverviewParams({})).toEqual({
			status: "active",
			overdue: false,
			page: 1,
			pageSize: 25,
		});
	});

	it("reads a status, the overdue flag and paging", () => {
		expect(
			parseDocumentRequestOverviewParams({
				status: "submitted",
				overdue: "1",
				page: "3",
				pageSize: "50",
			}),
		).toEqual({ status: "submitted", overdue: true, page: 3, pageSize: 50 });
		for (const status of ["open", "accepted", "cancelled", "all"] as const) {
			expect(parseDocumentRequestOverviewParams({ status }).status).toBe(status);
		}
	});

	it("falls back to the defaults for values it does not know", () => {
		expect(
			parseDocumentRequestOverviewParams({
				status: "overdue",
				overdue: "yes",
				page: "-2",
				pageSize: "1000",
			}),
		).toEqual({ status: "active", overdue: false, page: 1, pageSize: 25 });
		expect(parseDocumentRequestOverviewParams({ status: ["open", "submitted"] }).status).toBe(
			"active",
		);
	});
});
