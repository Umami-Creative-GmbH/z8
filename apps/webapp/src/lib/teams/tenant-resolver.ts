/**
 * Teams Tenant Resolver
 *
 * Maps Microsoft 365 tenant IDs to Z8 organizations.
 * This is the core routing logic for the multi-tenant bot.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { teamsTenantConfig } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import type { ResolvedTenant, TenantResolutionResult } from "./types";

const logger = createLogger("TeamsTenantResolver");

/**
 * Resolve a Teams tenant ID to a Z8 organization configuration
 *
 * @param tenantId - Microsoft 365 tenant ID (Azure AD tenant GUID)
 * @returns Resolution result with tenant config or status
 */
export async function resolveTenant(tenantId: string): Promise<TenantResolutionResult> {
	try {
		const config = await db.query.teamsTenantConfig.findFirst({
			where: eq(teamsTenantConfig.tenantId, tenantId),
		});

		if (!config) {
			logger.debug({ tenantId }, "Tenant not found in database");
			return { status: "not_found", tenantId };
		}

		if (config.setupStatus !== "active") {
			logger.debug({ tenantId, setupStatus: config.setupStatus }, "Tenant not fully configured");
			return { status: "unconfigured", tenantId };
		}

		const tenant: ResolvedTenant = {
			tenantId: config.tenantId,
			tenantName: config.tenantName,
			organizationId: config.organizationId,
			setupStatus: config.setupStatus,
			enableApprovals: config.enableApprovals,
			enableCommands: config.enableCommands,
			enableDailyDigest: config.enableDailyDigest,
			enableEscalations: config.enableEscalations,
			digestTime: config.digestTime,
			digestTimezone: config.digestTimezone,
			escalationTimeoutHours: config.escalationTimeoutHours,
			serviceUrl: config.serviceUrl,
		};

		logger.debug(
			{ tenantId, organizationId: tenant.organizationId },
			"Tenant resolved successfully",
		);

		return { status: "configured", tenant };
	} catch (error) {
		logger.error({ error, tenantId }, "Failed to resolve tenant");
		throw error;
	}
}

/**
 * Get tenant config by organization ID
 *
 * @param organizationId - Z8 organization ID
 * @returns Tenant config or null
 */
export async function getTenantConfigByOrganization(
	organizationId: string,
): Promise<ResolvedTenant | null> {
	try {
		const config = await db.query.teamsTenantConfig.findFirst({
			where: eq(teamsTenantConfig.organizationId, organizationId),
		});

		if (!config || config.setupStatus !== "active") {
			return null;
		}

		return {
			tenantId: config.tenantId,
			tenantName: config.tenantName,
			organizationId: config.organizationId,
			setupStatus: config.setupStatus,
			enableApprovals: config.enableApprovals,
			enableCommands: config.enableCommands,
			enableDailyDigest: config.enableDailyDigest,
			enableEscalations: config.enableEscalations,
			digestTime: config.digestTime,
			digestTimezone: config.digestTimezone,
			escalationTimeoutHours: config.escalationTimeoutHours,
			serviceUrl: config.serviceUrl,
		};
	} catch (error) {
		logger.error({ error, organizationId }, "Failed to get tenant config by organization");
		return null;
	}
}

/**
 * Update the service URL for a tenant (captured from bot activity)
 *
 * @param tenantId - Microsoft 365 tenant ID
 * @param serviceUrl - Bot Framework service URL
 */
export async function updateTenantServiceUrl(tenantId: string, serviceUrl: string): Promise<void> {
	try {
		await db
			.update(teamsTenantConfig)
			.set({ serviceUrl })
			.where(eq(teamsTenantConfig.tenantId, tenantId));

		logger.debug({ tenantId, serviceUrl }, "Updated tenant service URL");
	} catch (error) {
		logger.error({ error, tenantId }, "Failed to update tenant service URL");
	}
}

/**
 * Check if a tenant has Teams integration enabled
 *
 * @param organizationId - Z8 organization ID
 * @returns Whether Teams is enabled and active for this org
 */
export async function isTeamsEnabledForOrganization(organizationId: string): Promise<boolean> {
	const config = await getTenantConfigByOrganization(organizationId);
	return config !== null && config.setupStatus === "active";
}

/**
 * Get all active tenant configurations
 * Used for daily digest and escalation cron jobs
 *
 * @returns Array of active tenant configs
 */
export async function getAllActiveTenants(): Promise<ResolvedTenant[]> {
	try {
		const configs = await db.query.teamsTenantConfig.findMany({
			where: eq(teamsTenantConfig.setupStatus, "active"),
		});

		return configs.map((config) => ({
			tenantId: config.tenantId,
			tenantName: config.tenantName,
			organizationId: config.organizationId,
			setupStatus: config.setupStatus,
			enableApprovals: config.enableApprovals,
			enableCommands: config.enableCommands,
			enableDailyDigest: config.enableDailyDigest,
			enableEscalations: config.enableEscalations,
			digestTime: config.digestTime,
			digestTimezone: config.digestTimezone,
			escalationTimeoutHours: config.escalationTimeoutHours,
			serviceUrl: config.serviceUrl,
		}));
	} catch (error) {
		logger.error({ error }, "Failed to get all active tenants");
		return [];
	}
}
