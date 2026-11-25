import "server-only";

import { getApprovalInboxCounts } from "@/lib/approvals/inbox/read-service";
import { resolveApprovalInboxViewerScope } from "@/lib/approvals/inbox/viewer-scope";
import type { AuthContext } from "@/lib/auth-helpers";
import { getAbility } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import type { ApprovalInboxSummary } from "./statistics-types";

// The inbox reads need the approval handlers registered.
import "@/lib/approvals/init";

const logger = createLogger("StatisticsApprovalInbox");

/**
 * What waits in the viewer's own approvals inbox (#1938), counted exactly as the
 * inbox badge counts it (`/api/approvals/inbox/counts`), from the same viewer scope:
 * approvals they may decide and the compliance exceptions they see (#1977). Null when
 * the viewer has no inbox, such as an org admin who is not an employee.
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
		const scope = ability
			? await resolveApprovalInboxViewerScope({ ability, employee: viewer })
			: null;
		if (!scope) {
			return { status: "ok", value: null };
		}
		const counts = await getApprovalInboxCounts({ ...scope, status: "pending", limit: 1 });
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
