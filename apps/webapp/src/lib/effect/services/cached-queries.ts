import { cache } from "react";
import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db";
import {
	accessPolicy,
	scimProviderConfig,
	roleTemplate,
	roleTemplateMapping,
} from "@/db/schema";

/**
 * Cached queries for request-level deduplication.
 * These use React.cache() to ensure the same query is only executed once per request.
 *
 * @see https://react.dev/reference/react/cache
 */

/**
 * Get SCIM provider config for an organization (cached per request)
 */
export const getScimProviderConfig = cache(async (organizationId: string) => {
	return db.query.scimProviderConfig.findFirst({
		where: eq(scimProviderConfig.organizationId, organizationId),
	});
});

/**
 * Get active access policies for an organization (cached per request)
 */
export const getActiveAccessPolicies = cache(async (organizationId: string) => {
	return db.query.accessPolicy.findMany({
		where: and(
			eq(accessPolicy.organizationId, organizationId),
			eq(accessPolicy.enabled, true),
		),
		orderBy: [desc(accessPolicy.priority)],
	});
});

/**
 * Get a role template by ID (cached per request)
 */
export const getRoleTemplateById = cache(async (templateId: string) => {
	return db.query.roleTemplate.findFirst({
		where: eq(roleTemplate.id, templateId),
	});
});

/**
 * Get role template mappings for an organization (cached per request)
 */
export const getRoleTemplateMappings = cache(async (organizationId: string) => {
	return db.query.roleTemplateMapping.findMany({
		where: eq(roleTemplateMapping.organizationId, organizationId),
		with: {
			roleTemplate: true,
		},
	});
});

/**
 * Find role template mapping for a specific IdP group (cached per request)
 */
export const findRoleTemplateMappingForGroup = cache(
	async (organizationId: string, idpType: "sso" | "scim", idpGroupId: string) => {
		return db.query.roleTemplateMapping.findFirst({
			where: and(
				eq(roleTemplateMapping.organizationId, organizationId),
				eq(roleTemplateMapping.idpType, idpType),
				eq(roleTemplateMapping.idpGroupId, idpGroupId),
			),
			with: {
				roleTemplate: true,
			},
		});
	},
);
