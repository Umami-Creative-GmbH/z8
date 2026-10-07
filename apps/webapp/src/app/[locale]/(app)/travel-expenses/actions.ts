"use server";

import { and, desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { travelExpenseClaim } from "@/db/schema";
import {
	decideTravelExpenseClaimEffect,
	loadTravelExpenseApprover,
} from "@/lib/approvals/server/travel-expense-approvals";
import { getAuthContext } from "@/lib/auth-helpers";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { logger } from "@/lib/logger";
import { listOwnLegacyConversions } from "@/lib/travel-expenses/legacy-draft-conversion-read";

type TravelExpenseClaimListItem = typeof travelExpenseClaim.$inferSelect & {
	/** The report a legacy draft was continued as (#616), if any. */
	convertedReportId: string | null;
};

export async function getMyTravelExpenseClaims(): Promise<
	ServerActionResult<TravelExpenseClaimListItem[]>
> {
	try {
		const authContext = await getAuthContext();
		if (!authContext?.employee) {
			return { success: false, error: "Unauthorized" };
		}

		const claims = await db.query.travelExpenseClaim.findMany({
			where: and(
				eq(
					travelExpenseClaim.organizationId,
					authContext.employee.organizationId,
				),
				eq(travelExpenseClaim.employeeId, authContext.employee.id),
			),
			orderBy: [desc(travelExpenseClaim.createdAt)],
		});
		// Drafts continued as reports (#616) link to their report.
		const converted = await listOwnLegacyConversions(
			db,
			{ organizationId: authContext.employee.organizationId, employeeId: authContext.employee.id },
			claims.filter((claim) => claim.status === "draft").map((claim) => claim.id),
		);

		return {
			success: true,
			data: claims.map((claim) => ({
				...claim,
				convertedReportId: converted.get(claim.id) ?? null,
			})),
		};
	} catch (error) {
		logger.error({ error }, "Failed to get travel expense claims");
		return { success: false, error: "Failed to get travel expense claims" };
	}
}

/**
 * Decides as the session's employee through the single expense decision owner
 * (#296): replay, frozen-submission holds and decision evidence commit with the
 * legacy mutation; the requester is notified after commit.
 */
function decideAsEmployee(
	employeeId: string,
	input: {
		claimId: string;
		action: "approve" | "reject";
		reason?: string;
		note?: string;
	},
): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const approver = yield* loadTravelExpenseApprover(dbService, employeeId);
			yield* decideTravelExpenseClaimEffect(dbService, approver, input);
		}),
	);
}

export async function approveTravelExpenseClaim(input: {
	claimId: string;
	note?: string;
}): Promise<ServerActionResult<{ status: "approved" }>> {
	try {
		const authContext = await getAuthContext();
		if (!authContext?.employee) {
			return { success: false, error: "Unauthorized" };
		}

		const result = await decideAsEmployee(authContext.employee.id, {
			claimId: input.claimId,
			action: "approve",
			...(input.note ? { note: input.note } : {}),
		});
		if (!result.success) {
			return result;
		}

		revalidatePath("/travel-expenses");
		return { success: true, data: { status: "approved" } };
	} catch (error) {
		logger.error({ error }, "Failed to approve travel expense claim");
		return { success: false, error: "Failed to approve travel expense claim" };
	}
}

export async function rejectTravelExpenseClaim(input: {
	claimId: string;
	reason: string;
}): Promise<ServerActionResult<{ status: "rejected" }>> {
	try {
		const authContext = await getAuthContext();
		if (!authContext?.employee) {
			return { success: false, error: "Unauthorized" };
		}

		const result = await decideAsEmployee(authContext.employee.id, {
			claimId: input.claimId,
			action: "reject",
			reason: input.reason,
		});
		if (!result.success) {
			return result;
		}

		revalidatePath("/travel-expenses");
		return { success: true, data: { status: "rejected" } };
	} catch (error) {
		logger.error({ error }, "Failed to reject travel expense claim");
		return { success: false, error: "Failed to reject travel expense claim" };
	}
}
