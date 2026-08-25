import type {
	SCIMProjectedUserState,
	SCIMTransactionContext,
} from "@better-auth/scim";
import { scim } from "@better-auth/scim";
import { resolveSCIMIdentity } from "./identity-resolution";
import { reconcileSCIMLifecycle } from "./lifecycle-reconciler";
import {
	reconcileSCIMRoleProjection,
	scimRoleProjection,
} from "./projection-reconciler";

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
