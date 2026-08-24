import { scim } from "@better-auth/scim";
import { resolveSCIMIdentity } from "./identity-resolution";
import { reconcileSCIMLifecycle } from "./lifecycle-reconciler";
import {
	reconcileSCIMRoleProjection,
	scimRoleProjection,
} from "./projection-reconciler";

export function createZ8SCIMPlugin(credentialHashSecret: string) {
	return scim({
		connections: [],
		managedConnections: { credentialHashSecret },
		identity: {
			resolveUser: resolveSCIMIdentity,
			reconcileUser: reconcileSCIMLifecycle,
		},
		projection: {
			roles: scimRoleProjection,
			reconcileUser: reconcileSCIMRoleProjection,
		},
	});
}
