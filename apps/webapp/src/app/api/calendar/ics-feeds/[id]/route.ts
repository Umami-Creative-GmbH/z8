/**
 * ICS Feed Management API - Single Feed Operations
 *
 * GET /api/calendar/ics-feeds/[id] - Get feed details
 * PATCH /api/calendar/ics-feeds/[id] - Update feed settings
 * DELETE /api/calendar/ics-feeds/[id] - Revoke feed
 *
 * None of these return the feed URL; only create and regenerate do (#991).
 */

import { and, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { connection, type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { employee, icsFeed } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import { logIcsFeedAudit } from "@/lib/calendar-sync/ics-feed-audit";

// ============================================
// VALIDATION
// ============================================

const updateFeedSchema = z.object({
	includeApproved: z.boolean().optional(),
	includePending: z.boolean().optional(),
});

// ============================================
// HELPERS
// ============================================

async function verifyFeedAccess(
	feedId: string,
	userId: string,
	organizationId: string,
): Promise<{
	feed: typeof icsFeed.$inferSelect;
	employee: typeof employee.$inferSelect;
	canAccess: boolean;
} | null> {
	const feed = await db.query.icsFeed.findFirst({
		where: and(
			eq(icsFeed.id, feedId),
			eq(icsFeed.organizationId, organizationId),
			isNull(icsFeed.revokedAt),
		),
	});

	if (!feed) return null;

	const emp = await db.query.employee.findFirst({
		where: and(
			eq(employee.userId, userId),
			eq(employee.organizationId, organizationId),
		),
	});

	if (!emp) return null;

	// Get ability for CASL checks
	const ability = await getAbility();

	// Check access:
	// - User feeds: only the owner can access
	// - Team feeds: only users who can manage calendars can access
	let canAccess = false;
	if (feed.feedType === "user" && feed.employeeId === emp.id) {
		canAccess = true;
	} else if (feed.feedType === "team" && ability?.can("manage", "Calendar")) {
		canAccess = true;
	}

	return { feed, employee: emp, canAccess };
}

// ============================================
// GET - Get feed details
// ============================================

export async function GET(
	_request: NextRequest,
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

		const access = await verifyFeedAccess(id, session.user.id, activeOrgId);
		if (!access?.canAccess) {
			return NextResponse.json({ error: "Feed not found" }, { status: 404 });
		}

		const { feed } = access;

		return NextResponse.json({
			id: feed.id,
			feedType: feed.feedType,
			includeApproved: feed.includeApproved,
			includePending: feed.includePending,
			lastUsedAt: feed.lastUsedAt,
			createdAt: feed.createdAt,
		});
	} catch (error) {
		console.error("Error fetching ICS feed:", error);
		return NextResponse.json(
			{ error: "Failed to fetch feed" },
			{ status: 500 },
		);
	}
}

// ============================================
// PATCH - Update feed settings
// ============================================

export async function PATCH(
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

		const access = await verifyFeedAccess(id, session.user.id, activeOrgId);
		if (!access?.canAccess) {
			return NextResponse.json({ error: "Feed not found" }, { status: 404 });
		}

		// Parse and validate request
		const body = await request.json();
		const validationResult = updateFeedSchema.safeParse(body);

		if (!validationResult.success) {
			return NextResponse.json(
				{ error: "Invalid request", details: validationResult.error.issues },
				{ status: 400 },
			);
		}

		const updates = validationResult.data;

		// Update feed
		const [updated] = await db
			.update(icsFeed)
			.set({
				...updates,
				updatedAt: new Date(),
			})
			.where(and(eq(icsFeed.id, id), eq(icsFeed.organizationId, activeOrgId)))
			.returning();
		if (!updated) {
			return NextResponse.json({ error: "Feed not found" }, { status: 404 });
		}

		return NextResponse.json({
			id: updated.id,
			feedType: updated.feedType,
			includeApproved: updated.includeApproved,
			includePending: updated.includePending,
			lastUsedAt: updated.lastUsedAt,
			updatedAt: updated.updatedAt,
		});
	} catch (error) {
		console.error("Error updating ICS feed:", error);
		return NextResponse.json(
			{ error: "Failed to update feed" },
			{ status: 500 },
		);
	}
}

// ============================================
// DELETE - Revoke feed
// ============================================

export async function DELETE(
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

		const access = await verifyFeedAccess(id, session.user.id, activeOrgId);
		if (!access?.canAccess) {
			return NextResponse.json({ error: "Feed not found" }, { status: 404 });
		}

		// Revoke; the row stays as a record of the credential
		const now = new Date();
		const [revoked] = await db
			.update(icsFeed)
			.set({
				revokedAt: now,
				revokedBy: session.user.id,
				updatedAt: now,
			})
			.where(
				and(
					eq(icsFeed.id, id),
					eq(icsFeed.organizationId, activeOrgId),
					isNull(icsFeed.revokedAt),
				),
			)
			.returning();
		if (!revoked) {
			return NextResponse.json({ error: "Feed not found" }, { status: 404 });
		}

		await logIcsFeedAudit({
			action: AuditAction.ICS_FEED_REVOKED,
			feed: revoked,
			actor: session.user,
			request,
		});

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error("Error deleting ICS feed:", error);
		return NextResponse.json(
			{ error: "Failed to delete feed" },
			{ status: 500 },
		);
	}
}
