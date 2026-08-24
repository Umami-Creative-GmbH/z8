import { describe, expect, it } from "vitest";
import { createZ8SCIMPlugin } from "./auth-configuration";
import { resolveSCIMIdentity } from "./identity-resolution";
import { reconcileSCIMLifecycle } from "./lifecycle-reconciler";
import {
	reconcileSCIMRoleProjection,
	scimRoleProjection,
} from "./projection-reconciler";

describe("createZ8SCIMPlugin", () => {
	it("registers managed SCIM with the application callbacks", () => {
		const credentialHashSecret = "s".repeat(32);
		const plugin = createZ8SCIMPlugin(credentialHashSecret);

		expect(plugin.id).toBe("scim");
		expect(plugin.options).toMatchObject({
			connections: [],
			managedConnections: { credentialHashSecret },
		});
		expect(plugin.options.identity).toEqual({
			resolveUser: resolveSCIMIdentity,
			reconcileUser: reconcileSCIMLifecycle,
		});
		expect(plugin.options.projection).toEqual({
			roles: scimRoleProjection,
			reconcileUser: reconcileSCIMRoleProjection,
		});
	});

	it("installs Group support and trusted managed server endpoints", () => {
		const plugin = createZ8SCIMPlugin("s".repeat(32));

		expect(plugin.endpoints).toHaveProperty("createSCIMGroup");
		expect(plugin.endpoints).toHaveProperty("listSCIMGroups");
		expect(plugin.endpoints).toHaveProperty("createSCIMManagedConnection");
		expect(plugin.endpoints).toHaveProperty("reconcileSCIMProjection");
		expect(
			Reflect.get(
				plugin.endpoints.createSCIMManagedConnection.options.metadata,
				"SERVER_ONLY",
			),
		).toBe(true);
	});
});
