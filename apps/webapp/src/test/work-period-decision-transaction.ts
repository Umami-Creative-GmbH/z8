/**
 * Legacy unit harness for the #303 work-period decision transaction. Mock-database
 * suites cannot model the advisory-lock protocol; they run the coordinator with
 * the test's own transaction in legacy scope, still acquiring the approval gate
 * through the context so gate expectations stay observable. The real protocol is
 * verified against PostgreSQL.
 *
 * vi.mock("@/lib/approvals/server/work-period-decision-transaction", async (importOriginal) =>
 *   (await import("@/test/work-period-decision-transaction")).legacyWorkPeriodDecisionTransaction(
 *     await importOriginal(),
 *   ));
 */
import type * as Coordinator from "@/lib/approvals/server/work-period-decision-transaction";
import { sealWorkTransactionScope } from "@/lib/time-tracking/work-transaction";

export function legacyWorkPeriodDecisionTransaction(
	actual: typeof Coordinator,
): typeof Coordinator {
	return {
		...actual,
		acquireWorkPeriodDecisionScope: async (context, route) => {
			const authority = await context.writeGate.acquire({
				organizationId: route.organizationId,
				workflowType: route.kind,
			});
			const scope = sealWorkTransactionScope({
				db: context.dbService.db as never,
				admission: "legacy" as const,
				assertEmployee: () => undefined,
			});
			return {
				scope,
				authority,
				writeGate: {
					acquire: async (gateScope) => {
						if (
							gateScope.organizationId !== route.organizationId ||
							gateScope.workflowType !== route.kind
						) {
							throw new Error("Work period decision rollout scope mismatch");
						}
						return authority;
					},
				},
			};
		},
		retryWorkPeriodDecisionTransaction: (run) => run(),
	};
}
