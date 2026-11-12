import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	controlPlane: {
		create: vi.fn(),
		getCreationState: vi.fn(),
		get: vi.fn(),
		rotate: vi.fn(),
		revoke: vi.fn(),
		listEvents: vi.fn(),
	},
	findTemplate: vi.fn(),
	decommission: vi.fn(),
	getOrCreateSetup: vi.fn(),
	updateWhere: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: {
				query: { roleTemplate: { findFirst: mocks.findTemplate } },
				update: () => ({ set: () => ({ where: mocks.updateWhere }) }),
			},
		}),
	);
});

vi.mock("./identity-setup-record", () => ({
	getOrCreateEnterpriseIdentitySetupRecord: mocks.getOrCreateSetup,
}));
vi.mock("@/lib/scim/managed-control-plane", () => ({
	createSCIMManagedControlPlane: vi.fn(() => mocks.controlPlane),
	createSCIMManagedControlPlaneStore: vi.fn(),
}));
vi.mock("@/lib/scim/decommission", () => ({
	createSCIMDecommissionStore: vi.fn(),
	decommissionSCIMConnection: mocks.decommission,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("./scim-actions");

const templateId = "11111111-1111-4111-8111-111111111111";
const orgAdmin: StubCaller = {
	userId: "actor-1",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: null,
};
const connection = {
	connectionId: "connection-1",
	provisioningDomainId: "org-1",
	createdAt: "2026-08-25T10:00:00.000Z",
};

const ok = <T>(result: { success: true; data: T } | { success: false; error: string }) => {
	if (!result.success) throw new Error(result.error);
	return result.data;
};

describe("enterprise identity SCIM actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.caller = orgAdmin;
		mocks.updateWhere.mockResolvedValue(undefined);
		mocks.findTemplate.mockResolvedValue({
			id: templateId,
			organizationId: "org-1",
			isActive: true,
			isGlobal: false,
		});
		mocks.controlPlane.create.mockResolvedValue({
			connection,
			credential: { credentialId: "credential-1", createdAt: "2026-08-25T10:00:00.000Z" },
			token: "secret-token",
		});
		mocks.controlPlane.getCreationState.mockResolvedValue({
			connectionId: null,
			status: "creation_failed",
		});
	});

	it("exports only the managed SCIM administration actions", () => {
		expect(Object.keys(actions).sort()).toEqual([
			"createEnterpriseIdentityScimConnectionAction",
			"decommissionEnterpriseIdentityScimConnectionAction",
			"getEnterpriseIdentityScimStatusAction",
			"listEnterpriseIdentityScimEventsAction",
			"reconcileEnterpriseIdentityScimCreationAction",
			"revokeEnterpriseIdentityScimCredentialAction",
			"rotateEnterpriseIdentityScimCredentialAction",
		]);
	});

	it("refuses a scoped manager before validation or dependent work for every action", async () => {
		mocks.caller = {
			...orgAdmin,
			membershipRole: "member",
			employee: { id: "employee-1", role: "manager", former: false },
		};
		const operations = [
			() => actions.createEnterpriseIdentityScimConnectionAction({} as never),
			() => actions.getEnterpriseIdentityScimStatusAction({ connectionId: "connection-1" }),
			() => actions.rotateEnterpriseIdentityScimCredentialAction({ connectionId: "connection-1" }),
			() =>
				actions.revokeEnterpriseIdentityScimCredentialAction({
					connectionId: "connection-1",
					credentialId: "credential-1",
				}),
			() => actions.listEnterpriseIdentityScimEventsAction({ connectionId: "connection-1" }),
			() => actions.reconcileEnterpriseIdentityScimCreationAction({} as never),
			() =>
				actions.decommissionEnterpriseIdentityScimConnectionAction({
					connectionId: "connection-1",
				}),
		];

		for (const operation of operations) {
			await expect(operation()).resolves.toMatchObject({
				success: false,
				code: "AuthorizationError",
			});
		}
		expect(mocks.findTemplate).not.toHaveBeenCalled();
		for (const fn of Object.values(mocks.controlPlane)) expect(fn).not.toHaveBeenCalled();
		expect(mocks.decommission).not.toHaveBeenCalled();
	});

	it("refuses an invalid connection input", async () => {
		await expect(
			actions.getEnterpriseIdentityScimStatusAction({ connectionId: "  " }),
		).resolves.toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.controlPlane.get).not.toHaveBeenCalled();
	});

	it("recovers an authorized reservation without returning a credential or token", async () => {
		const result = ok(
			await actions.reconcileEnterpriseIdentityScimCreationAction({
				defaultRoleTemplateId: templateId,
			}),
		);
		expect(mocks.controlPlane.create).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: "org-1", actorId: "actor-1" }),
		);
		expect(JSON.stringify(result)).not.toContain("secret-token");
		expect(mocks.updateWhere).toHaveBeenCalled();
	});

	it("adopts an activated connection after setup persistence fails without issuing another token", async () => {
		mocks.updateWhere.mockRejectedValueOnce(new Error("setup persistence unavailable"));

		await expect(
			actions.createEnterpriseIdentityScimConnectionAction({ defaultRoleTemplateId: templateId }),
		).resolves.toMatchObject({ success: false, error: "setup persistence unavailable" });

		mocks.controlPlane.getCreationState.mockResolvedValueOnce({
			connectionId: "connection-1",
			status: "active",
		});
		mocks.controlPlane.get.mockResolvedValueOnce({ connection, credentials: [] });

		const recovered = ok(
			await actions.reconcileEnterpriseIdentityScimCreationAction({
				defaultRoleTemplateId: templateId,
			}),
		);

		expect(recovered).toEqual({
			connection: expect.objectContaining({ connectionId: "connection-1" }),
			status: "active",
		});
		expect(JSON.stringify(recovered)).not.toContain("secret-token");
		expect(mocks.controlPlane.create).toHaveBeenCalledOnce();
		expect(mocks.controlPlane.get).toHaveBeenCalledWith({
			organizationId: "org-1",
			connectionId: "connection-1",
		});
	});

	it("creates an organization-bound connection and exposes its token only in the issue response", async () => {
		const result = ok(
			await actions.createEnterpriseIdentityScimConnectionAction({
				autoActivateUsers: true,
				deprovisionAction: "suspend",
				defaultRoleTemplateId: templateId,
			}),
		);

		expect(mocks.controlPlane.create).toHaveBeenCalledWith({
			organizationId: "org-1",
			actorId: "actor-1",
			autoActivateUsers: true,
			deprovisionAction: "suspend",
			defaultRoleTemplateId: templateId,
			creationRequestId: expect.any(String),
		});
		expect(result).toMatchObject({
			connection: { connectionId: "connection-1", provisioningDomainId: "org-1" },
			credential: { credentialId: "credential-1" },
			token: "secret-token",
		});
	});

	it("refuses inactive or foreign role templates without exposing template metadata", async () => {
		mocks.findTemplate.mockResolvedValueOnce(null).mockResolvedValueOnce({
			id: "22222222-2222-4222-8222-222222222222",
			organizationId: "foreign-org",
			isActive: true,
			isGlobal: false,
		});

		for (let attempt = 0; attempt < 2; attempt++) {
			await expect(
				actions.createEnterpriseIdentityScimConnectionAction({
					defaultRoleTemplateId: "22222222-2222-4222-8222-222222222222",
				}),
			).resolves.toMatchObject({
				success: false,
				code: "ValidationError",
				error: "Default role template is not available for this organization",
			});
		}
		expect(mocks.controlPlane.create).not.toHaveBeenCalled();
	});

	it("accepts a global role template", async () => {
		mocks.findTemplate.mockResolvedValue({
			id: templateId,
			organizationId: null,
			isActive: true,
			isGlobal: true,
		});

		ok(
			await actions.createEnterpriseIdentityScimConnectionAction({
				defaultRoleTemplateId: templateId,
			}),
		);

		expect(mocks.controlPlane.create).toHaveBeenCalledOnce();
	});

	it("returns status and events without credentials or tokens", async () => {
		mocks.controlPlane.get.mockResolvedValue({
			connection,
			credentials: [{ credentialId: "credential-1", expiresAt: "2026-09-01T10:00:00.000Z" }],
		});
		mocks.controlPlane.listEvents.mockResolvedValue([
			{ eventId: "event-1", createdAt: "2026-08-25T10:00:00.000Z" },
		]);

		const status = ok(
			await actions.getEnterpriseIdentityScimStatusAction({ connectionId: "connection-1" }),
		);
		const events = ok(
			await actions.listEnterpriseIdentityScimEventsAction({ connectionId: "connection-1" }),
		);

		expect(status.connection.createdAt).toBe("2026-08-25T10:00:00.000Z");
		expect(JSON.stringify(status)).not.toContain("token");
		expect(events[0].createdAt).toBe("2026-08-25T10:00:00.000Z");
		expect(mocks.controlPlane.listEvents).toHaveBeenCalledWith({
			organizationId: "org-1",
			connectionId: "connection-1",
		});
	});

	it("uses the session's organization and actor for credential and decommission operations", async () => {
		mocks.controlPlane.rotate.mockResolvedValue({
			connection,
			credential: { credentialId: "credential-2" },
			token: "rotated-secret-token",
		});
		mocks.controlPlane.revoke.mockResolvedValue(undefined);
		mocks.decommission.mockResolvedValue("completed");

		const rotated = ok(
			await actions.rotateEnterpriseIdentityScimCredentialAction({ connectionId: "connection-1" }),
		);
		ok(
			await actions.revokeEnterpriseIdentityScimCredentialAction({
				connectionId: "connection-1",
				credentialId: "credential-1",
			}),
		);
		ok(
			await actions.decommissionEnterpriseIdentityScimConnectionAction({
				connectionId: "connection-1",
			}),
		);

		expect(rotated).toHaveProperty("token", "rotated-secret-token");
		expect(mocks.controlPlane.rotate).toHaveBeenCalledWith({
			organizationId: "org-1",
			connectionId: "connection-1",
			actorId: "actor-1",
		});
		expect(mocks.controlPlane.revoke).toHaveBeenCalledWith({
			organizationId: "org-1",
			connectionId: "connection-1",
			credentialId: "credential-1",
			actorId: "actor-1",
		});
		expect(mocks.decommission).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				connectionId: "connection-1",
				actorId: "actor-1",
			}),
		);
	});

	it("reports unknown and cross-organization connections identically", async () => {
		mocks.controlPlane.get
			.mockRejectedValueOnce(new Error("Connection not found"))
			.mockRejectedValueOnce(new Error("Connection belongs to another organization"));

		const first = await actions.getEnterpriseIdentityScimStatusAction({ connectionId: "missing" });
		const second = await actions.getEnterpriseIdentityScimStatusAction({
			connectionId: "other-org",
		});

		expect(first).toEqual(second);
		expect(first).toMatchObject({
			success: false,
			code: "NotFoundError",
			error: "SCIM connection not found",
		});
	});
});
