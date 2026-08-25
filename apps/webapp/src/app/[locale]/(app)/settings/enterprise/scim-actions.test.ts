import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const {
	requireEnterpriseOrgAdminMock,
	controlPlaneMock,
	findTemplateMock,
	decommissionMock,
	getOrCreateSetupMock,
} = vi.hoisted(() => ({
	requireEnterpriseOrgAdminMock: vi.fn(),
	controlPlaneMock: {
		create: vi.fn(),
		get: vi.fn(),
		rotate: vi.fn(),
		revoke: vi.fn(),
		listEvents: vi.fn(),
	},
		findTemplateMock: vi.fn(),
		decommissionMock: vi.fn(),
		getOrCreateSetupMock: vi.fn(),
	}));

vi.mock("./actions", () => ({
	requireEnterpriseOrgAdmin: requireEnterpriseOrgAdminMock,
	getOrCreateEnterpriseIdentitySetupRecord: getOrCreateSetupMock,
}));

vi.mock("@/db", () => ({
	db: {
		query: { roleTemplate: { findFirst: findTemplateMock } },
		update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
	},
}));

vi.mock("@/lib/scim/managed-control-plane", () => ({
	createSCIMManagedControlPlane: vi.fn(() => controlPlaneMock),
	createSCIMManagedControlPlaneStore: vi.fn(),
}));
vi.mock("@/lib/scim/decommission", () => ({
	createSCIMDecommissionStore: vi.fn(),
	decommissionSCIMConnection: decommissionMock,
}));

vi.mock("@/lib/auth", () => ({ auth: { api: {} } }));
vi.mock("@/db/schema", () => ({
	enterpriseIdentitySetup: {},
	roleTemplate: {},
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("./scim-actions");

describe("enterprise identity SCIM actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		calls.length = 0;
		requireEnterpriseOrgAdminMock.mockImplementation(async () => {
			calls.push("authorize");
			return {
				authContext: { user: { id: "actor-1" } },
				organizationId: "org-1",
			};
		});
		findTemplateMock.mockResolvedValue({
			id: "11111111-1111-4111-8111-111111111111",
			organizationId: "org-1",
			isActive: true,
			isGlobal: false,
		});
		controlPlaneMock.create.mockResolvedValue({
			connection: {
				connectionId: "connection-1",
				provisioningDomainId: "org-1",
				createdAt: "2026-08-25T10:00:00.000Z",
			},
			credential: {
				credentialId: "credential-1",
				createdAt: "2026-08-25T10:00:00.000Z",
			},
			token: "secret-token",
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

	it("authorizes before validation or dependent work for every action", async () => {
		requireEnterpriseOrgAdminMock.mockRejectedValue(new Error("Unauthorized"));

		const operations = [
			() => actions.createEnterpriseIdentityScimConnectionAction({}),
			() => actions.getEnterpriseIdentityScimStatusAction("connection-1"),
			() =>
				actions.rotateEnterpriseIdentityScimCredentialAction("connection-1"),
			() =>
				actions.revokeEnterpriseIdentityScimCredentialAction(
					"connection-1",
					"credential-1",
				),
			() => actions.listEnterpriseIdentityScimEventsAction("connection-1"),
			() => actions.reconcileEnterpriseIdentityScimCreationAction({}),
			() =>
				actions.decommissionEnterpriseIdentityScimConnectionAction(
					"connection-1",
				),
		];

		for (const operation of operations)
			await expect(operation()).rejects.toThrow("Unauthorized");

		expect(requireEnterpriseOrgAdminMock).toHaveBeenCalledTimes(
			operations.length,
		);
		expect(findTemplateMock).not.toHaveBeenCalled();
		expect(controlPlaneMock.create).not.toHaveBeenCalled();
		expect(controlPlaneMock.get).not.toHaveBeenCalled();
		expect(controlPlaneMock.rotate).not.toHaveBeenCalled();
		expect(controlPlaneMock.revoke).not.toHaveBeenCalled();
		expect(controlPlaneMock.listEvents).not.toHaveBeenCalled();
		expect(decommissionMock).not.toHaveBeenCalled();
	});

	it("recovers an authorized reservation without returning a credential or token", async () => {
		const result = await actions.reconcileEnterpriseIdentityScimCreationAction({
			defaultRoleTemplateId: "11111111-1111-4111-8111-111111111111",
		});
		expect(controlPlaneMock.create).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1", actorId: "actor-1" }));
		expect(JSON.stringify(result)).not.toContain("secret-token");
	});

	it("creates an organization-bound connection and exposes its token only in the issue response", async () => {
		const result = await actions.createEnterpriseIdentityScimConnectionAction({
			autoActivateUsers: true,
			deprovisionAction: "suspend",
			defaultRoleTemplateId: "11111111-1111-4111-8111-111111111111",
		});

		expect(findTemplateMock).toHaveBeenCalledWith(
			expect.objectContaining({ where: expect.anything() }),
		);
		expect(controlPlaneMock.create).toHaveBeenCalledWith({
			organizationId: "org-1",
			actorId: "actor-1",
			autoActivateUsers: true,
			deprovisionAction: "suspend",
			defaultRoleTemplateId: "11111111-1111-4111-8111-111111111111",
			creationRequestId: expect.any(String),
		});
		expect(result).toMatchObject({
			connection: {
				connectionId: "connection-1",
				provisioningDomainId: "org-1",
			},
			credential: { credentialId: "credential-1" },
			token: "secret-token",
		});
	});

	it("rejects inactive or foreign role templates without exposing template metadata", async () => {
		findTemplateMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
			id: "22222222-2222-4222-8222-222222222222",
			organizationId: "foreign-org",
			isActive: true,
			isGlobal: false,
		});

		await expect(
			actions.createEnterpriseIdentityScimConnectionAction({
				defaultRoleTemplateId: "22222222-2222-4222-8222-222222222222",
			}),
		).rejects.toThrow(
			"Default role template is not available for this organization",
		);
		await expect(
			actions.createEnterpriseIdentityScimConnectionAction({
				defaultRoleTemplateId: "22222222-2222-4222-8222-222222222222",
			}),
		).rejects.toThrow(
			"Default role template is not available for this organization",
		);
		expect(controlPlaneMock.create).not.toHaveBeenCalled();
	});

	it("accepts only active organization-owned or global role templates", async () => {
		findTemplateMock.mockResolvedValue({
			id: "11111111-1111-4111-8111-111111111111",
			organizationId: null,
			isActive: true,
			isGlobal: true,
		});

		await actions.createEnterpriseIdentityScimConnectionAction({
			defaultRoleTemplateId: "11111111-1111-4111-8111-111111111111",
		});

		expect(controlPlaneMock.create).toHaveBeenCalledOnce();
	});

	it("returns ISO-safe status and events without credentials or tokens", async () => {
		controlPlaneMock.get.mockResolvedValue({
			connection: {
				connectionId: "connection-1",
				provisioningDomainId: "org-1",
				createdAt: "2026-08-25T10:00:00.000Z",
			},
			credentials: [
				{ credentialId: "credential-1", expiresAt: "2026-09-01T10:00:00.000Z" },
			],
		});
		controlPlaneMock.listEvents.mockResolvedValue([
			{ eventId: "event-1", createdAt: "2026-08-25T10:00:00.000Z" },
		]);

		const status =
			await actions.getEnterpriseIdentityScimStatusAction("connection-1");
		const events =
			await actions.listEnterpriseIdentityScimEventsAction("connection-1");

		expect(status.connection.createdAt).toBe("2026-08-25T10:00:00.000Z");
		expect(JSON.stringify(status)).not.toContain("token");
		expect(events[0].createdAt).toBe("2026-08-25T10:00:00.000Z");
		expect(JSON.stringify(events)).not.toContain("token");
		expect(controlPlaneMock.listEvents).toHaveBeenCalledWith({
			organizationId: "org-1",
			connectionId: "connection-1",
		});
	});

	it("uses the authorized tenant and actor for credential and decommission operations", async () => {
		controlPlaneMock.rotate.mockResolvedValue({
			connection: {
				connectionId: "connection-1",
				provisioningDomainId: "org-1",
			},
			credential: { credentialId: "credential-2" },
			token: "rotated-secret-token",
		});
		controlPlaneMock.revoke.mockResolvedValue(undefined);
		decommissionMock.mockResolvedValue("completed");

		const rotated =
			await actions.rotateEnterpriseIdentityScimCredentialAction(
				"connection-1",
			);
		await actions.revokeEnterpriseIdentityScimCredentialAction(
			"connection-1",
			"credential-1",
		);
		await actions.decommissionEnterpriseIdentityScimConnectionAction(
			"connection-1",
		);

		expect(rotated).toHaveProperty("token", "rotated-secret-token");
		expect(controlPlaneMock.rotate).toHaveBeenCalledWith({
			organizationId: "org-1",
			connectionId: "connection-1",
			actorId: "actor-1",
		});
		expect(controlPlaneMock.revoke).toHaveBeenCalledWith({
			organizationId: "org-1",
			connectionId: "connection-1",
			credentialId: "credential-1",
			actorId: "actor-1",
		});
		expect(decommissionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				connectionId: "connection-1",
				actorId: "actor-1",
			}),
		);
	});

	it("normalizes unknown and cross-organization connection errors identically", async () => {
		const unknown = new Error("Connection not found");
		const crossOrganization = new Error(
			"Connection belongs to another organization",
		);
		controlPlaneMock.get
			.mockRejectedValueOnce(unknown)
			.mockRejectedValueOnce(crossOrganization);

		const first = await actions
			.getEnterpriseIdentityScimStatusAction("missing")
			.catch((error: Error) => error.message);
		const second = await actions
			.getEnterpriseIdentityScimStatusAction("other-org")
			.catch((error: Error) => error.message);

		expect(first).toBe(second);
		expect(first).toBe("SCIM connection not found");
		expect(controlPlaneMock.get).toHaveBeenNthCalledWith(1, {
			organizationId: "org-1",
			connectionId: "missing",
		});
		expect(controlPlaneMock.get).toHaveBeenNthCalledWith(2, {
			organizationId: "org-1",
			connectionId: "other-org",
		});
	});
});
