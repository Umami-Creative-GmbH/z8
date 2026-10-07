import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { ApprovalDbService } from "../server/types";
import { createApprovalReturnAuditLogger } from "./audit-logger";

describe("createApprovalReturnAuditLogger", () => {
	it("records the shared legacy reject mutation of a report return as a return (#603)", async () => {
		const inserted: Array<Record<string, unknown>> = [];
		const dbService = {
			db: {
				insert: () => ({
					values: async (values: Record<string, unknown>) => {
						inserted.push(values);
					},
				}),
			},
			query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
		} as unknown as ApprovalDbService;

		await Effect.runPromise(
			createApprovalReturnAuditLogger(dbService).log({
				organizationId: "org-1",
				approvalId: "req-1",
				approvalType: "travel_expense_report",
				entityId: "report-1",
				action: "reject",
				performedBy: "user-1",
				previousStatus: "pending",
				newStatus: "rejected",
				reason: "Please attach the folio",
			}),
		);

		expect(inserted).toEqual([
			expect.objectContaining({
				action: "return",
				entityId: "req-1",
				metadata: JSON.stringify({ disposition: "returned" }),
			}),
		]);
	});
});
