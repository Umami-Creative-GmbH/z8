import "server-only";

import { db } from "@/db";
import { loadInboxCovers } from "@/lib/approvals/deputy/deputy-decision-store";
import { getApprovalInboxCounts } from "@/lib/approvals/inbox/read-service";
import { getEligibleApprovalScopesForManager } from "@/lib/approvals/policies/manager-eligibility-db";
import type { AuthContext } from "@/lib/auth-helpers";
import { getAbility } from "@/lib/auth-helpers";
import { canAccessApprovalInbox } from "@/lib/authorization";
import { systemClock } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import type { ApprovalInboxSummary } from "./statistics-types";

// The inbox reads need the approval handlers registered.
import "@/lib/approvals/init";

const logger = createLogger("StatisticsApprovalInbox");

/**
 * What waits in the viewer's own approvals inbox (#1938), counted exactly as the
 * inbox badge counts it (`/api/approvals/inbox/counts`): an approver with
 * `manage Approval` sees every approval, a manager their assignments, eligible
 * scopes and the approvals they cover. Null when the viewer has no inbox, such
 * as an org admin who is not an employee.
 */
export async function loadApprovalInboxSummary(
	authContext: AuthContext,
	organizationId: string,
): Promise<ApprovalInboxSummary> {
	const viewer = authContext.employee;
	if (!viewer || viewer.organizationId !== organizationId) {
		return { status: "ok", value: null };
	}
	try {
		const ability = await getAbility();
		if (!ability || !canAccessApprovalInbox(ability, viewer)) {
			return { status: "ok", value: null };
		}
		const canManageApprovals = ability.can("manage", "Approval");
		const counts = await getApprovalInboxCounts({
			approverId: viewer.id,
			includeAllApprovers: canManageApprovals || undefined,
			organizationId,
			status: "pending",
			limit: 1,
			eligibleApprovalScopes: canManageApprovals
				? []
				: await getEligibleApprovalScopesForManager({
						db,
						managerEmployeeId: viewer.id,
						organizationId,
					}),
			covering: await loadInboxCovers(db, {
				organizationId,
				deputyEmployeeId: viewer.id,
				at: systemClock.nowInstant(),
			}),
		});
		const pending = Object.values(counts).reduce<number>((total, value) => total + (value ?? 0), 0);
		return {
			status: "ok",
			value: { pending, absenceRequests: counts.absence_entry ?? 0 },
		};
	} catch (error) {
		logger.error({ error, organizationId }, "Failed to count the statistics approvals inbox");
		return { status: "failed" };
	}
}
