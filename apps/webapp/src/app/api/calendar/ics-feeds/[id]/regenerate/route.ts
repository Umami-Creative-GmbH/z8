/**
 * ICS Feed Secret Regeneration
 *
 * Regenerates the secret token for an ICS feed, invalidating the old URL.
 *
 * POST /api/calendar/ics-feeds/[id]/regenerate
 */

import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { connection } from "next/server";
import { headers } from "next/headers";
import { db } from "@/db";
import { employee, icsFeed } from "@/db/schema";
import { auth } from "@/lib/auth";

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

// ============================================
// POST - Regenerate secret
// ============================================

export async function POST(
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

		// Get feed
		const feed = await db.query.icsFeed.findFirst({
			where: and(
				eq(icsFeed.id, id),
				eq(icsFeed.organizationId, activeOrgId),
				eq(icsFeed.isActive, true),
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
			return NextResponse.json({ error: "Employee not found" }, { status: 404 });
		}

		// Check access
		if (feed.feedType === "user" && feed.employeeId !== emp.id) {
			return NextResponse.json({ error: "Access denied" }, { status: 403 });
		}

		if (feed.feedType === "team" && emp.role !== "admin" && emp.role !== "manager") {
			return NextResponse.json({ error: "Access denied" }, { status: 403 });
		}

		// Generate new secret
		const newSecret = generateFeedSecret();

		// Update feed
		const [updated] = await db
			.update(icsFeed)
			.set({
				secret: newSecret,
				updatedAt: new Date(),
			})
			.where(eq(icsFeed.id, id))
			.returning();

		return NextResponse.json({
			id: updated.id,
			url: buildFeedUrl(updated.secret),
			message: "Feed URL has been regenerated. The old URL will no longer work.",
		});
	} catch (error) {
		console.error("Error regenerating ICS feed secret:", error);
		return NextResponse.json(
			{ error: "Failed to regenerate feed secret" },
			{ status: 500 },
		);
	}
}
