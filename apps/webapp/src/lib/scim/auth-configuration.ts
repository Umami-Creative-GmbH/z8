import type {
	SCIMProjectedUserState,
	SCIMTransactionContext,
} from "@better-auth/scim";
import { scim } from "@better-auth/scim";
import type { BetterAuthPlugin } from "better-auth";
import { resolveSCIMIdentity } from "./identity-resolution";
import { reconcileSCIMLifecycle } from "./lifecycle-reconciler";
import {
	reconcileSCIMRoleProjection,
	scimRoleProjection,
} from "./projection-reconciler";
import { SCIM_MODELS } from "./transaction-store";

const optionalString = { type: "string", required: false } as const;
const optionalNumber = { type: "number", required: false } as const;
const optionalBoolean = { type: "boolean", required: false } as const;
const optionalDate = { type: "date", required: false } as const;
const optionalJson = { type: "json", required: false } as const;

// This is deliberately the minimum application-owned callback adapter surface.
// Core, organization, and SSO plugins register their own models and fields.
const scimCallbackModelSchema = {
	[SCIM_MODELS.enterpriseIdentitySetup]: {
		disableMigration: true,
		fields: {
			organizationId: optionalString,
			providerId: optionalString,
			domain: optionalString,
		},
	},
	[SCIM_MODELS.employee]: {
		disableMigration: true,
		fields: {
			id: optionalString,
			organizationId: optionalString,
			userId: optionalString,
			role: optionalString,
			isActive: optionalBoolean,
		},
	},
	[SCIM_MODELS.providerConfig]: {
		disableMigration: true,
		fields: {
			id: optionalString,
			organizationId: optionalString,
			connectionId: optionalString,
			state: optionalString,
			autoActivateUsers: optionalBoolean,
			deprovisionAction: optionalString,
			defaultRoleTemplateId: optionalString,
		},
	},
	[SCIM_MODELS.lifecycleState]: {
		disableMigration: true,
		fields: {
			id: optionalString,
			organizationId: optionalString,
			connectionId: optionalString,
			userId: optionalString,
			membershipRevision: optionalNumber,
			scimActive: optionalBoolean,
			priorMemberStatus: optionalString,
			priorEmployeeIsActive: optionalBoolean,
			deactivationOwned: optionalBoolean,
			memberDeactivationOwned: optionalBoolean,
			employeeDeactivationOwned: optionalBoolean,
		},
	},
	[SCIM_MODELS.projectionState]: {
		disableMigration: true,
		fields: {
			id: optionalString,
			organizationId: optionalString,
			userId: optionalString,
			roleTemplateId: optionalString,
			sourceGroupId: optionalString,
			appliedRoleTemplateId: optionalString,
			appliedDefaultTeamId: optionalString,
			appliedDefaultTeamMembershipOwned: optionalBoolean,
		},
	},
	[SCIM_MODELS.seatOutbox]: {
		disableMigration: true,
		fields: {
			id: optionalString,
			organizationId: optionalString,
			connectionId: optionalString,
			userId: optionalString,
			membershipRevision: optionalNumber,
			dedupeKey: optionalString,
			status: optionalString,
		},
	},
	[SCIM_MODELS.provisioningAudit]: {
		disableMigration: true,
		fields: {
			id: optionalString,
			organizationId: optionalString,
			connectionId: optionalString,
			userId: optionalString,
			eventType: optionalString,
			metadata: optionalJson,
		},
	},
	[SCIM_MODELS.lifecycleAudit]: {
		disableMigration: true,
		fields: {
			id: optionalString,
			organizationId: optionalString,
			userId: optionalString,
			employeeId: optionalString,
			eventType: optionalString,
			source: optionalString,
			actorType: optionalString,
			createdBy: optionalString,
			metadata: optionalJson,
			requiresApproval: optionalBoolean,
			approvalStatus: optionalString,
		},
	},
	[SCIM_MODELS.roleMapping]: {
		disableMigration: true,
		fields: {
			id: optionalString,
			organizationId: optionalString,
			idpType: optionalString,
			idpGroupId: optionalString,
			roleTemplateId: optionalString,
			priority: optionalNumber,
		},
	},
	[SCIM_MODELS.roleTemplate]: {
		disableMigration: true,
		fields: {
			id: optionalString,
			organizationId: optionalString,
			isGlobal: optionalBoolean,
			isActive: optionalBoolean,
			employeeRole: optionalString,
			defaultTeamId: optionalString,
			teamPermissions: optionalJson,
		},
	},
	[SCIM_MODELS.roleAssignment]: {
		disableMigration: true,
		fields: {
			id: optionalString,
			organizationId: optionalString,
			userId: optionalString,
			roleTemplateId: optionalString,
			assignmentSource: optionalString,
			idpGroupId: optionalString,
			assignedBy: optionalString,
			assignedAt: optionalDate,
		},
	},
	[SCIM_MODELS.teamPermission]: {
		disableMigration: true,
		fields: {
			id: optionalString,
			organizationId: optionalString,
			employeeId: optionalString,
			teamId: optionalString,
			canCreateTeams: optionalBoolean,
			canManageTeamMembers: optionalBoolean,
			canManageTeamSettings: optionalBoolean,
			canApproveTeamRequests: optionalBoolean,
			grantedBy: optionalString,
		},
	},
	[SCIM_MODELS.teamMembership]: {
		disableMigration: true,
		fields: {
			id: optionalString,
			organizationId: optionalString,
			employeeId: optionalString,
			teamId: optionalString,
			createdBy: optionalString,
		},
	},
} satisfies NonNullable<BetterAuthPlugin["schema"]>;

/**
 * Registers application models used from SCIM callbacks with Better Auth's
 * transaction adapter without asking Better Auth to generate app tables.
 */
export function createSCIMCallbackModelRegistration() {
	return {
		id: "z8-scim-callback-models",
		schema: scimCallbackModelSchema,
	};
}

async function reconcileSCIMProjectedUser(
	input: SCIMProjectedUserState,
	context: SCIMTransactionContext,
) {
	await reconcileSCIMLifecycle(input, context);
	await reconcileSCIMRoleProjection(input, context);
}

export function createZ8SCIMPlugin(credentialHashSecret: string) {
	return scim({
		connections: [],
		managedConnections: { credentialHashSecret },
		compatibility: {
			microsoftEntra: { acceptLegacyGroupSchema: true },
		},
		identity: {
			resolveUser: resolveSCIMIdentity,
			externalIdPolicy: {
				immutable: true,
				resolveTombstoneUser: resolveSCIMIdentity,
			},
		},
		projection: {
			roles: scimRoleProjection,
			reconcileUser: reconcileSCIMProjectedUser,
		},
	});
}
