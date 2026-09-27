/**
 * Legacy unit harness for the #301 correction work transaction. Mock-database
 * suites cannot model the advisory-lock protocol; they run the coordinator with
 * the test's own transaction in legacy scope, still acquiring the approval gate
 * through the context so gate expectations stay observable. The real protocol is
 * verified against PostgreSQL.
 *
 * vi.mock("@/lib/approvals/server/time-correction-work-transaction", async (importOriginal) =>
 *   (await import("@/test/time-correction-work-transaction")).legacyTimeCorrectionWorkTransaction(
 *     await importOriginal(),
 *   ));
 */
import { approvalWriteGateResult } from "@/lib/approvals/authority";
import type * as Coordinator from "@/lib/approvals/server/time-correction-work-transaction";
import {
	acquirePinnedApprovalContext,
	pinApprovalWriteGate,
} from "@/lib/approvals/workflow/pinned-write-gate";
import { sealWorkTransactionScope } from "@/lib/time-tracking/work-transaction";

export function legacyTimeCorrectionWorkTransaction(
	actual: typeof Coordinator,
): typeof Coordinator {
	return {
		...actual,
		acquireTimeCorrectionWorkScope: async (context, route, refuse) => {
			const scope = sealWorkTransactionScope({
				db: context.dbService.db as never,
				admission: "legacy" as const,
				assertEmployee: () => undefined,
			});
			// Suites that stub the whole submission owner build no approval gate.
			if (!context.writeGate) {
				const authority = approvalWriteGateResult("legacy");
				const writeGate = pinApprovalWriteGate({
					organizationId: route.organizationId,
					workflowType: "time_correction",
					authority,
					refuse,
				});
				return { scope, authority, context: { ...context, writeGate } };
			}
			const pinned = await acquirePinnedApprovalContext(context, {
				organizationId: route.organizationId,
				workflowType: "time_correction",
				refuse,
			});
			return { scope, ...pinned };
		},
		retryTimeCorrectionWorkTransaction: (run) => run(),
	};
}
