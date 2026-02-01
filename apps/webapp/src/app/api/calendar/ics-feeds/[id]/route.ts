/**
 * ICS Feed Management API - Single Feed Operations
 *
 * GET /api/calendar/ics-feeds/[id] - Get feed details
 * PATCH /api/calendar/ics-feeds/[id] - Update feed settings
 * DELETE /api/calendar/ics-feeds/[id] - Delete/deactivate feed
 * POST /api/calendar/ics-feeds/[id]/regenerate - Regenerate secret
 */

import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { connection } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/db";
import { employee, icsFeed } from "@/db/schema";
import { auth } from "@/lib/auth";

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

function generateFeedSecret(): string {
	return crypto.randomBytes(32).toString("hex");
}

function buildFeedUrl(secret: string): string {
	const baseUrl = process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
	return `${baseUrl}/api/calendar/ics/${secret}`;
}

async function verifyFeedAccess(
	feedId: string,
	userId: string,
	organizationId: string,
): Promise<{ feed: typeof icsFeed.$inferSelect; employee: typeof employee.$inferSelect } | null> {
	const feed = await db.query.icsFeed.findFirst({
		where: and(
			eq(icsFeed.id, feedId),
			eq(icsFeed.organizationId, organizationId),
			eq(icsFeed.isActive, true),
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

	// Check access:
	// - User feeds: only the owner can access
	// - Team feeds: only admins/managers can access
	if (feed.feedType === "user" && feed.employeeId !== emp.id) {
		return null;
	}

	if (feed.feedType === "team" && emp.role !== "admin" && emp.role !== "manager") {
		return null;
	}

	return { feed, employee: emp };
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
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
		}

		const access = await verifyFeedAccess(id, session.user.id, activeOrgId);
		if (!access) {
			return NextResponse.json({ error: "Feed not found" }, { status: 404 });
		}

		const { feed } = access;

		return NextResponse.json({
			id: feed.id,
			feedType: feed.feedType,
			url: buildFeedUrl(feed.secret),
			includeApproved: feed.includeApproved,
			includePending: feed.includePending,
			lastAccessedAt: feed.lastAccessedAt,
			createdAt: feed.createdAt,
		});
	} catch (error) {
		console.error("Error fetching ICS feed:", error);
		return NextResponse.json({ error: "Failed to fetch feed" }, { status: 500 });
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
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
		}

		const access = await verifyFeedAccess(id, session.user.id, activeOrgId);
		if (!access) {
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
			.where(eq(icsFeed.id, id))
			.returning();

		return NextResponse.json({
			id: updated.id,
			feedType: updated.feedType,
			url: buildFeedUrl(updated.secret),
			includeApproved: updated.includeApproved,
			includePending: updated.includePending,
			lastAccessedAt: updated.lastAccessedAt,
			updatedAt: updated.updatedAt,
		});
	} catch (error) {
		console.error("Error updating ICS feed:", error);
		return NextResponse.json({ error: "Failed to update feed" }, { status: 500 });
	}
}

// ============================================
// DELETE - Deactivate feed
// ============================================

export async function DELETE(
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
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
		}

		const access = await verifyFeedAccess(id, session.user.id, activeOrgId);
		if (!access) {
			return NextResponse.json({ error: "Feed not found" }, { status: 404 });
		}

		// Soft delete: set isActive to false
		await db
			.update(icsFeed)
			.set({
				isActive: false,
				updatedAt: new Date(),
			})
			.where(eq(icsFeed.id, id));

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error("Error deleting ICS feed:", error);
		return NextResponse.json({ error: "Failed to delete feed" }, { status: 500 });
	}
}
