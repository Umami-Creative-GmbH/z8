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
import type * as Coordinator from "@/lib/approvals/server/time-correction-work-transaction";
import { getCutoverBehavior } from "@/lib/approvals/workflow/cutover";
import { sealWorkTransactionScope } from "@/lib/time-tracking/work-transaction";

export function legacyTimeCorrectionWorkTransaction(
	actual: typeof Coordinator,
): typeof Coordinator {
	return {
		...actual,
		acquireTimeCorrectionWorkScope: async (context, route) => {
			// Suites that stub the whole submission owner build no approval gate.
			const authority = context.writeGate
				? await context.writeGate.acquire({
						organizationId: route.organizationId,
						workflowType: "time_correction",
					})
				: { mode: "legacy" as const, behavior: getCutoverBehavior("legacy") };
			const scope = sealWorkTransactionScope({
				db: context.dbService.db as never,
				admission: "legacy" as const,
				assertEmployee: () => undefined,
			});
			// The harness's own compatibility writer stays observable as the suite built it.
			return {
				scope,
				authority,
				context: {
					...context,
					writeGate: actual.fixedTimeCorrectionWriteGate(route.organizationId, authority),
				},
			};
		},
		retryTimeCorrectionWorkTransaction: (run) => run(),
	};
}
