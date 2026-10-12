/**
 * ICS Feed Secret Regeneration
 *
 * Regenerates the secret token for an ICS feed, invalidating the old URL.
 * The new URL is returned only in this response (#991).
 *
 * POST /api/calendar/ics-feeds/[id]/regenerate
 */

import { and, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { connection, type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { employee, icsFeed } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import { ForbiddenError, toHttpError } from "@/lib/authorization";
import { logIcsFeedAudit } from "@/lib/calendar-sync/ics-feed-audit";
import { issueIcsFeedSecret } from "@/lib/calendar-sync/ics-feed-secret";

// ============================================
// POST - Regenerate secret
// ============================================

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	await connection();

	try {
		const { id } = await params;
		const headersList = await headers();
		const session = await auth.api.getSession({ headers: headersList });

		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const activeOrgId = session.session.activeOrganizationId;
		if (!activeOrgId) {
			return NextResponse.json(
				{ error: "No active organization" },
				{ status: 400 },
			);
		}

		// Get feed
		const feed = await db.query.icsFeed.findFirst({
			where: and(
				eq(icsFeed.id, id),
				eq(icsFeed.organizationId, activeOrgId),
				isNull(icsFeed.revokedAt),
			),
		});

		if (!feed) {
			return NextResponse.json({ error: "Feed not found" }, { status: 404 });
		}

		// Get employee
		const emp = await db.query.employee.findFirst({
			where: and(
				eq(employee.userId, session.user.id),
				eq(employee.organizationId, activeOrgId),
			),
		});

		if (!emp) {
			return NextResponse.json(
				{ error: "Employee not found" },
				{ status: 404 },
			);
		}

		// Check access
		if (feed.feedType === "user" && feed.employeeId !== emp.id) {
			const error = new ForbiddenError("update", "Calendar");
			const httpError = toHttpError(error);
			return NextResponse.json(httpError.body, { status: httpError.status });
		}

		if (feed.feedType === "team") {
			// Get CASL ability for permission checks
			const ability = await getAbility();

			if (!ability || ability.cannot("manage", "Calendar")) {
				const error = new ForbiddenError("manage", "Calendar");
				const httpError = toHttpError(error);
				return NextResponse.json(httpError.body, { status: httpError.status });
			}
		}

		// Replace the stored digest; the old URL stops resolving
		const { url, secretDigest, secretHashVersion } = issueIcsFeedSecret();

		const [updated] = await db
			.update(icsFeed)
			.set({
				secretDigest,
				secretHashVersion,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(icsFeed.id, id),
					eq(icsFeed.organizationId, activeOrgId),
					isNull(icsFeed.revokedAt),
				),
			)
			.returning();
		if (!updated) {
			return NextResponse.json({ error: "Feed not found" }, { status: 404 });
		}

		await logIcsFeedAudit({
			action: AuditAction.ICS_FEED_REGENERATED,
			feed: updated,
			actor: session.user,
			request,
		});

		return NextResponse.json({
			id: updated.id,
			url,
			message:
				"Feed URL has been regenerated. The old URL will no longer work.",
		});
	} catch (error) {
		console.error("Error regenerating ICS feed secret:", error);
		return NextResponse.json(
			{ error: "Failed to regenerate feed secret" },
			{ status: 500 },
		);
	}
}
