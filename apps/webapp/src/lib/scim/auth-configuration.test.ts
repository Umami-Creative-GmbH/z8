import type {
	SCIMIdentityState,
	SCIMProjectedUserState,
} from "@better-auth/scim";
import { describe, expect, it } from "vitest";
import { createZ8SCIMPlugin } from "./auth-configuration";
import { resolveSCIMIdentity } from "./identity-resolution";
import { scimRoleProjection } from "./projection-reconciler";
import { SCIM_MODELS } from "./transaction-store";
import { createTransactionFixture } from "./transaction-store.test-fixture";

const organizationId = "org_target";
const userId = "user_opaque";
const connectionId = "connection_opaque";

function projectedState(active: boolean): SCIMProjectedUserState {
	return {
		provisioningDomainId: organizationId,
		userId,
		active,
		sources: [
			{
				id: "source_opaque",
				connectionId,
				provisioningDomainId: organizationId,
				active,
			},
		],
		grants: [],
	};
}

function applicationRows(
	extra: Record<string, Record<string, unknown>[]> = {},
) {
	return {
		[SCIM_MODELS.providerConfig]: [
			{
				id: "config_opaque",
				organizationId,
				connectionId,
				state: "active",
				autoActivateUsers: true,
				deprovisionAction: "suspend",
				defaultRoleTemplateId: "template_default",
			},
		],
		[SCIM_MODELS.roleTemplate]: [
			{
				id: "template_default",
				organizationId,
				isGlobal: false,
				isActive: true,
				employeeRole: "employee",
				teamPermissions: {},
				defaultTeamId: null,
			},
		],
		...extra,
	};
}

describe("createZ8SCIMPlugin", () => {
	it("registers managed SCIM with the application callbacks", () => {
		const credentialHashSecret = "s".repeat(32);
		const plugin = createZ8SCIMPlugin(credentialHashSecret);

		expect(plugin.id).toBe("scim");
		expect(plugin.options).toMatchObject({
			connections: [],
			managedConnections: { credentialHashSecret },
			compatibility: {
				microsoftEntra: { acceptLegacyGroupSchema: true },
			},
		});
		expect(plugin.options.identity).toEqual({
			resolveUser: resolveSCIMIdentity,
		});
		expect(plugin.options.identity?.reconcileUser).toBeUndefined();
		expect(plugin.options.projection).toEqual({
			roles: scimRoleProjection,
			reconcileUser: expect.any(Function),
		});

		const identityState = {
			userId,
			active: true,
			sources: [],
		} satisfies SCIMIdentityState;
		expect(identityState).not.toHaveProperty("provisioningDomainId");
	});

	it("creates lifecycle records before applying the projected role state", async () => {
		const target = createTransactionFixture(applicationRows());
		const reconcileUser = createZ8SCIMPlugin("s".repeat(32)).options.projection
			?.reconcileUser;

		expect(reconcileUser).toBeTypeOf("function");
		await reconcileUser?.(projectedState(true), { database: target.database });

		expect(target.rows(SCIM_MODELS.member)).toHaveLength(1);
		expect(target.rows(SCIM_MODELS.employee)).toHaveLength(1);
		expect(target.rows(SCIM_MODELS.lifecycleState)).toHaveLength(1);
		expect(target.rows(SCIM_MODELS.projectionState)).toHaveLength(1);
		const createdModels = target.operations.create.mock.calls.map(
			([input]) => input.model,
		);
		expect(createdModels.indexOf(SCIM_MODELS.lifecycleState)).toBeLessThan(
			createdModels.indexOf(SCIM_MODELS.projectionState),
		);
	});

	it("deactivates lifecycle state and reconciles projection with zero grants", async () => {
		const target = createTransactionFixture(
			applicationRows({
				[SCIM_MODELS.member]: [
					{
						id: "member_opaque",
						organizationId,
						userId,
						role: "member",
						status: "approved",
					},
				],
				[SCIM_MODELS.employee]: [
					{
						id: "employee_opaque",
						organizationId,
						userId,
						role: "employee",
						isActive: true,
					},
				],
			}),
		);
		const reconcileUser = createZ8SCIMPlugin("s".repeat(32)).options.projection
			?.reconcileUser;

		await reconcileUser?.(projectedState(false), { database: target.database });

		expect(target.rows(SCIM_MODELS.member)[0]?.status).toBe("suspended");
		expect(target.rows(SCIM_MODELS.employee)[0]?.isActive).toBe(false);
		expect(target.rows(SCIM_MODELS.projectionState)).toHaveLength(1);
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
