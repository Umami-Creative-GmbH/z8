"use server";

import { z } from "zod";
import { db } from "@/db";
import { platformAdminAuditLog } from "@/db/schema/platform-admin";
import {
	ApprovalMaintenanceError,
	type DeletedApprovalRecords,
	deleteApprovalInTransaction,
} from "@/lib/approvals/maintenance";
import type { ServerActionResult } from "@/lib/effect/result";
import { requirePlatformAdmin } from "@/lib/effect/services/platform-admin.service";
import { createLogger } from "@/lib/logger";

const logger = createLogger("PlatformAdminApprovalMaintenance");
const inputSchema = z.object({
	organizationId: z.string().trim().min(1).max(255),
	approvalId: z.string().trim().regex(
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
	),
});

export async function forceDeleteApprovalAction(
	input: unknown,
): Promise<ServerActionResult<DeletedApprovalRecords>> {
	let admin: Awaited<ReturnType<typeof requirePlatformAdmin>>;
	try {
		admin = await requirePlatformAdmin();
	} catch {
		return {
			success: false,
			code: "UNAUTHORIZED",
			error: "Platform admin access required",
		};
	}

	const parsed = inputSchema.safeParse(input);
	if (!parsed.success) {
		return {
			success: false,
			code: "INVALID_INPUT",
			error: "Enter an organization ID and a valid approval UUID",
		};
	}
	const { organizationId, approvalId } = parsed.data;

	try {
		const deleted = await db.transaction(async (transaction) => {
			const result = await deleteApprovalInTransaction(transaction, organizationId, approvalId);
			await transaction.insert(platformAdminAuditLog).values({
				adminUserId: admin.userId,
				action: "force_delete_approval",
				targetType: "approval",
				targetId: approvalId,
				metadata: JSON.stringify({ organizationId, ...result }),
			});
			return result;
		});
		return { success: true, data: deleted };
	} catch (error) {
		if (error instanceof ApprovalMaintenanceError) {
			return { success: false, code: error.code, error: error.message };
		}
		logger.error({ error, organizationId, approvalId }, "Failed to force delete approval");
		return {
			success: false,
			code: "DELETE_FAILED",
			error: "Could not complete deletion. Check the approval ID before trying again.",
		};
	}
}
