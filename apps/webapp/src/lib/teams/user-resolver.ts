/**
 * Teams User Resolver
 *
 * Maps Teams users to Z8 users via email matching.
 * Creates automatic mappings when a Teams user's email matches a Z8 user.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employee, teamsUserMapping } from "@/db/schema";
import { user } from "@/db/auth-schema";
import { createLogger } from "@/lib/logger";
import type { ResolvedTeamsUser, UserResolutionResult } from "./types";

const logger = createLogger("TeamsUserResolver");

/**
 * Resolve a Teams user to a Z8 user
 *
 * First checks for existing mapping, then tries email matching.
 *
 * @param teamsUserId - Microsoft AAD user object ID
 * @param teamsEmail - User's email from Teams (may be UPN or email)
 * @param teamsTenantId - Microsoft tenant ID
 * @param teamsDisplayName - User's display name in Teams
 * @returns Resolution result with user data or status
 */
export async function resolveTeamsUser(
	teamsUserId: string,
	teamsEmail: string | null,
	teamsTenantId: string,
	teamsDisplayName?: string,
): Promise<UserResolutionResult> {
	try {
		// 1. Check for existing mapping
		const existing = await db.query.teamsUserMapping.findFirst({
			where: and(
				eq(teamsUserMapping.teamsUserId, teamsUserId),
				eq(teamsUserMapping.teamsTenantId, teamsTenantId),
				eq(teamsUserMapping.isActive, true),
			),
		});

		if (existing) {
			// Get employee ID for this user in this org
			const emp = await db.query.employee.findFirst({
				where: and(
					eq(employee.userId, existing.userId),
					eq(employee.organizationId, existing.organizationId),
				),
				columns: { id: true },
			});

			if (!emp) {
				logger.warn(
					{ userId: existing.userId, organizationId: existing.organizationId },
					"User mapping exists but no employee record found",
				);
				return { status: "no_employee", userId: existing.userId };
			}

			// Update last seen timestamp
			await db
				.update(teamsUserMapping)
				.set({ lastSeenAt: new Date() })
				.where(eq(teamsUserMapping.id, existing.id));

			return {
				status: "found",
				user: {
					userId: existing.userId,
					employeeId: emp.id,
					organizationId: existing.organizationId,
					teamsUserId: existing.teamsUserId,
					teamsEmail: existing.teamsEmail,
					teamsTenantId: existing.teamsTenantId,
					isNewMapping: false,
				},
			};
		}

		// 2. No existing mapping - try email matching
		if (!teamsEmail) {
			logger.debug({ teamsUserId }, "No email available for Teams user");
			return { status: "not_linked", teamsUserId, teamsEmail: null };
		}

		// Normalize email (lowercase, handle UPN format)
		const normalizedEmail = teamsEmail.toLowerCase().trim();

		// Find Z8 user by email
		const matchedUser = await db.query.user.findFirst({
			where: eq(user.email, normalizedEmail),
		});

		if (!matchedUser) {
			logger.debug({ teamsEmail: normalizedEmail }, "No Z8 user found with this email");
			return { status: "not_linked", teamsUserId, teamsEmail: normalizedEmail };
		}

		// 3. Find employee record for this user (need to determine org)
		const emp = await db.query.employee.findFirst({
			where: eq(employee.userId, matchedUser.id),
		});

		if (!emp) {
			logger.debug({ userId: matchedUser.id }, "User has no employee record");
			return { status: "no_employee", userId: matchedUser.id };
		}

		// 4. Create new mapping
		await db.insert(teamsUserMapping).values({
			userId: matchedUser.id,
			organizationId: emp.organizationId,
			teamsUserId,
			teamsEmail: normalizedEmail,
			teamsTenantId,
			teamsDisplayName: teamsDisplayName || null,
			lastSeenAt: new Date(),
		});

		logger.info(
			{
				userId: matchedUser.id,
				teamsUserId,
				teamsEmail: normalizedEmail,
				organizationId: emp.organizationId,
			},
			"Created new Teams user mapping via email match",
		);

		return {
			status: "found",
			user: {
				userId: matchedUser.id,
				employeeId: emp.id,
				organizationId: emp.organizationId,
				teamsUserId,
				teamsEmail: normalizedEmail,
				teamsTenantId,
				isNewMapping: true,
			},
		};
	} catch (error) {
		logger.error({ error, teamsUserId, teamsEmail }, "Failed to resolve Teams user");
		throw error;
	}
}

/**
 * Get Teams user mapping by Z8 user ID
 *
 * @param userId - Z8 user ID
 * @param organizationId - Z8 organization ID
 * @returns Teams user mapping or null
 */
export async function getTeamsMapping(
	userId: string,
	organizationId: string,
): Promise<{
	teamsUserId: string;
	teamsEmail: string;
	teamsTenantId: string;
} | null> {
	try {
		const mapping = await db.query.teamsUserMapping.findFirst({
			where: and(
				eq(teamsUserMapping.userId, userId),
				eq(teamsUserMapping.organizationId, organizationId),
				eq(teamsUserMapping.isActive, true),
			),
		});

		if (!mapping) {
			return null;
		}

		return {
			teamsUserId: mapping.teamsUserId,
			teamsEmail: mapping.teamsEmail,
			teamsTenantId: mapping.teamsTenantId,
		};
	} catch (error) {
		logger.error({ error, userId, organizationId }, "Failed to get Teams mapping");
		return null;
	}
}

/**
 * Deactivate a Teams user mapping
 *
 * @param userId - Z8 user ID
 * @param organizationId - Z8 organization ID
 */
export async function deactivateTeamsMapping(
	userId: string,
	organizationId: string,
): Promise<void> {
	try {
		await db
			.update(teamsUserMapping)
			.set({ isActive: false })
			.where(
				and(
					eq(teamsUserMapping.userId, userId),
					eq(teamsUserMapping.organizationId, organizationId),
				),
			);

		logger.info({ userId, organizationId }, "Deactivated Teams user mapping");
	} catch (error) {
		logger.error({ error, userId, organizationId }, "Failed to deactivate Teams mapping");
	}
}

/**
 * Get all active Teams user mappings for an organization
 *
 * @param organizationId - Z8 organization ID
 * @returns Array of user mappings
 */
export async function getOrganizationTeamsMappings(organizationId: string): Promise<
	Array<{
		userId: string;
		teamsUserId: string;
		teamsEmail: string;
		teamsDisplayName: string | null;
		lastSeenAt: Date | null;
	}>
> {
	try {
		const mappings = await db.query.teamsUserMapping.findMany({
			where: and(
				eq(teamsUserMapping.organizationId, organizationId),
				eq(teamsUserMapping.isActive, true),
			),
		});

		return mappings.map((m) => ({
			userId: m.userId,
			teamsUserId: m.teamsUserId,
			teamsEmail: m.teamsEmail,
			teamsDisplayName: m.teamsDisplayName,
			lastSeenAt: m.lastSeenAt,
		}));
	} catch (error) {
		logger.error({ error, organizationId }, "Failed to get organization Teams mappings");
		return [];
	}
}
