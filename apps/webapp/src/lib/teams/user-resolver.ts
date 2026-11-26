/**
 * Teams User Resolver
 *
 * Maps Teams users to Z8 users strictly through verified organization- and
 * tenant-scoped mappings. Automatic email matching is explicitly forbidden so
 * cross-organization or unverified emails can never establish member identity.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { teamsUserMapping } from "@/db/schema";
import { resolveCommandActorEmployee } from "@/lib/integrations/resolve-command-actor";
import { createLogger } from "@/lib/logger";
import type { UserResolutionResult } from "./types";

const logger = createLogger("TeamsUserResolver");

/**
 * Resolve a Teams user to a Z8 user
 *
 * Resolves strictly from verified active `teams_user_mapping` rows scoped by
 * `(teamsUserId, teamsTenantId)` (and optional `expectedOrganizationId`).
 * Email-based automatic matching is intentionally refused.
 *
 * @param teamsUserId - Microsoft AAD user object ID
 * @param _teamsEmail - Unused (email matching cannot establish Teams identity)
 * @param teamsTenantId - Microsoft tenant ID
 * @param _teamsDisplayName - User's display name in Teams
 * @param expectedOrganizationId - Optional organization ID to enforce org scope
 * @returns Resolution result with user data or status
 */
export async function resolveTeamsUser(
	teamsUserId: string,
	_teamsEmail: string | null,
	teamsTenantId: string,
	_teamsDisplayName?: string,
	expectedOrganizationId?: string,
): Promise<UserResolutionResult> {
	try {
		// 1. Check for existing verified mapping in this Teams tenant
		const existing = await db.query.teamsUserMapping.findFirst({
			where: and(
				eq(teamsUserMapping.teamsUserId, teamsUserId),
				eq(teamsUserMapping.teamsTenantId, teamsTenantId),
				eq(teamsUserMapping.isActive, true),
			),
		});

		if (existing) {
			if (expectedOrganizationId && existing.organizationId !== expectedOrganizationId) {
				logger.warn(
					{
						teamsUserId,
						teamsTenantId,
						expectedOrganizationId,
					},
					"Rejected Teams user mapping belonging to a different organization",
				);
				return { status: "not_linked", teamsUserId, teamsEmail: null };
			}

			// Get employee ID for this user in this org
			const emp = await resolveCommandActorEmployee(existing.userId, existing.organizationId);

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

		// 2. Never establish identity via email matching (cross-org or unverified email matching is blocked).
		logger.debug({ teamsUserId, teamsTenantId }, "No verified Teams user mapping found");
		return { status: "not_linked", teamsUserId, teamsEmail: null };
	} catch (error) {
		logger.error({ error, teamsUserId, teamsTenantId }, "Failed to resolve Teams user");
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
