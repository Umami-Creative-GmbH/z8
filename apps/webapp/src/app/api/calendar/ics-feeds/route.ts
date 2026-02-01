/**
 * ICS Feed Management API
 *
 * Manages ICS feed tokens for users and teams.
 *
 * GET /api/calendar/ics-feeds - List user's feeds
 * POST /api/calendar/ics-feeds - Create a new feed
 */

import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { connection } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/db";
import { employee, icsFeed, team } from "@/db/schema";
import { auth } from "@/lib/auth";

// ============================================
// VALIDATION
// ============================================

const createFeedSchema = z.object({
	feedType: z.enum(["user", "team"]),
	teamId: z.string().uuid().optional(),
	includeApproved: z.boolean().default(true),
	includePending: z.boolean().default(true),
});

// ============================================
// HELPERS
// ============================================

function generateFeedSecret(): string {
	return crypto.randomBytes(32).toString("hex"); // 64-char hex string
}

function buildFeedUrl(secret: string): string {
	const baseUrl = process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
	return `${baseUrl}/api/calendar/ics/${secret}`;
}

// ============================================
// GET - List feeds
// ============================================

export async function GET(_request: NextRequest) {
	await connection();

	try {
		const headersList = await headers();
		const session = await auth.api.getSession({ headers: headersList });

		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const activeOrgId = session.session.activeOrganizationId;
		if (!activeOrgId) {
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
		}

		// Get employee record
		const emp = await db.query.employee.findFirst({
			where: and(
				eq(employee.userId, session.user.id),
				eq(employee.organizationId, activeOrgId),
			),
		});

		if (!emp) {
			return NextResponse.json({ error: "Employee not found" }, { status: 404 });
		}

		// Get user's personal feed
		const userFeed = await db.query.icsFeed.findFirst({
			where: and(
				eq(icsFeed.employeeId, emp.id),
				eq(icsFeed.feedType, "user"),
				eq(icsFeed.isActive, true),
			),
		});

		// Get team feeds (if user is admin/manager, they can see team feeds)
		const teamFeeds = await db.query.icsFeed.findMany({
			where: and(
				eq(icsFeed.organizationId, activeOrgId),
				eq(icsFeed.feedType, "team"),
				eq(icsFeed.isActive, true),
			),
			with: {
				team: true,
			},
		});

		// Build response
		const feeds = [];

		if (userFeed) {
			feeds.push({
				id: userFeed.id,
				feedType: userFeed.feedType,
				url: buildFeedUrl(userFeed.secret),
				includeApproved: userFeed.includeApproved,
				includePending: userFeed.includePending,
				lastAccessedAt: userFeed.lastAccessedAt,
				createdAt: userFeed.createdAt,
			});
		}

		// Only include team feeds the user has access to
		if (emp.role === "admin" || emp.role === "manager") {
			for (const feed of teamFeeds) {
				feeds.push({
					id: feed.id,
					feedType: feed.feedType,
					teamId: feed.teamId,
					teamName: (feed.team as { name?: string })?.name,
					url: buildFeedUrl(feed.secret),
					includeApproved: feed.includeApproved,
					includePending: feed.includePending,
					lastAccessedAt: feed.lastAccessedAt,
					createdAt: feed.createdAt,
				});
			}
		}

		return NextResponse.json({ feeds });
	} catch (error) {
		console.error("Error fetching ICS feeds:", error);
		return NextResponse.json({ error: "Failed to fetch feeds" }, { status: 500 });
	}
}

// ============================================
// POST - Create feed
// ============================================

export async function POST(request: NextRequest) {
	await connection();

	try {
		const headersList = await headers();
		const session = await auth.api.getSession({ headers: headersList });

		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const activeOrgId = session.session.activeOrganizationId;
		if (!activeOrgId) {
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
		}

		// Parse and validate request
		const body = await request.json();
		const validationResult = createFeedSchema.safeParse(body);

		if (!validationResult.success) {
			return NextResponse.json(
				{ error: "Invalid request", details: validationResult.error.issues },
				{ status: 400 },
			);
		}

		const { feedType, teamId, includeApproved, includePending } = validationResult.data;

		// Get employee record
		const emp = await db.query.employee.findFirst({
			where: and(
				eq(employee.userId, session.user.id),
				eq(employee.organizationId, activeOrgId),
			),
		});

		if (!emp) {
			return NextResponse.json({ error: "Employee not found" }, { status: 404 });
		}

		// Validate based on feed type
		if (feedType === "team") {
			if (!teamId) {
				return NextResponse.json(
					{ error: "teamId is required for team feeds" },
					{ status: 400 },
				);
			}

			// Only admins/managers can create team feeds
			if (emp.role !== "admin" && emp.role !== "manager") {
				return NextResponse.json(
					{ error: "Only admins and managers can create team feeds" },
					{ status: 403 },
				);
			}

			// Validate team exists in org
			const teamRecord = await db.query.team.findFirst({
				where: and(eq(team.id, teamId), eq(team.organizationId, activeOrgId)),
			});

			if (!teamRecord) {
				return NextResponse.json({ error: "Team not found" }, { status: 404 });
			}

			// Check if feed already exists
			const existingFeed = await db.query.icsFeed.findFirst({
				where: and(
					eq(icsFeed.teamId, teamId),
					eq(icsFeed.feedType, "team"),
					eq(icsFeed.isActive, true),
				),
			});

			if (existingFeed) {
				return NextResponse.json(
					{ error: "Team feed already exists", feedId: existingFeed.id },
					{ status: 409 },
				);
			}
		} else {
			// User feed
			// Check if feed already exists
			const existingFeed = await db.query.icsFeed.findFirst({
				where: and(
					eq(icsFeed.employeeId, emp.id),
					eq(icsFeed.feedType, "user"),
					eq(icsFeed.isActive, true),
				),
			});

			if (existingFeed) {
				return NextResponse.json(
					{ error: "User feed already exists", feedId: existingFeed.id },
					{ status: 409 },
				);
			}
		}

		// Create the feed
		const secret = generateFeedSecret();

		const [newFeed] = await db
			.insert(icsFeed)
			.values({
				organizationId: activeOrgId,
				feedType,
				employeeId: feedType === "user" ? emp.id : null,
				teamId: feedType === "team" ? teamId : null,
				secret,
				includeApproved,
				includePending,
				isActive: true,
				createdBy: session.user.id,
				updatedAt: new Date(),
			})
			.returning();

		return NextResponse.json({
			id: newFeed.id,
			feedType: newFeed.feedType,
			url: buildFeedUrl(newFeed.secret),
			includeApproved: newFeed.includeApproved,
			includePending: newFeed.includePending,
			createdAt: newFeed.createdAt,
		});
	} catch (error) {
		console.error("Error creating ICS feed:", error);
		return NextResponse.json({ error: "Failed to create feed" }, { status: 500 });
	}
}
