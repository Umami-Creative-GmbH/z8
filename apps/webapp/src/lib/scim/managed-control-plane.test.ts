import { describe, expect, it, vi } from "vitest";
import {
	createSCIMManagedControlPlane,
	type SCIMManagedControlPlaneStore,
} from "./managed-control-plane";

const expiresAt = new Date("2027-01-01T00:00:00.000Z");

function createStore(): SCIMManagedControlPlaneStore {
	const config = {
		id: "config-1",
		organizationId: "org-1",
		creationRequestId: "request-1234567890",
		connectionId: null,
		state: "creating" as const,
		autoActivateUsers: false,
		deprovisionAction: "suspend" as const,
		defaultRoleTemplateId: "role-1",
		createdBy: "actor-1",
		updatedBy: null,
	};

	return {
		reserve: vi.fn().mockResolvedValue({ config, created: true }),
		findByOrganizationId: vi.fn().mockResolvedValue(config),
		activate: vi.fn().mockImplementation(async (input) => ({
			...config,
			connectionId: input.connectionId,
			state: "active" as const,
		})),
	};
}

function createAuth() {
	const connection = {
		creationRequestId: "request-1234567890",
		connectionId: "connection-1",
		provisioningDomainId: "org-1",
		status: "active" as const,
		createdAt: expiresAt,
		createdBy: "actor-1",
		decommissionStartedAt: null,
		decommissionStartedBy: null,
		decommissionedAt: null,
		decommissionedBy: null,
	};
	const credential = {
		credentialId: "credential-1",
		status: "active" as const,
		scopes: ["scim.users.read"] as const,
		expiresAt,
		createdAt: expiresAt,
		createdBy: "actor-1",
		lastUsedAt: null,
		revokedAt: null,
		revokedBy: null,
	};
	return {
		api: {
			createSCIMManagedConnection: vi.fn().mockResolvedValue({
				connection,
				credential,
				token: "secret-token",
			}),
			listSCIMManagedConnections: vi.fn().mockResolvedValue({
				connections: [connection],
			}),
			getSCIMManagedConnection: vi.fn().mockResolvedValue({
				connection,
				credentials: [credential],
			}),
			rotateSCIMManagedCredential: vi.fn().mockResolvedValue({
				connection,
				credential,
				token: "rotated-secret-token",
			}),
			revokeSCIMManagedCredential: vi.fn().mockResolvedValue({
				connection,
				credentials: [],
			}),
			listSCIMManagedConnectionEvents: vi.fn().mockResolvedValue({
				events: [],
			}),
		},
	};
}

describe("SCIM managed control plane", () => {
	it("persists a reservation before creating and exposes the raw token only from create", async () => {
		const store = createStore();
		const auth = createAuth();
		auth.api.listSCIMManagedConnections.mockResolvedValueOnce({
			connections: [],
		});
		const controlPlane = createSCIMManagedControlPlane({ auth, store });

		const result = await controlPlane.create({
			organizationId: "org-1",
			actorId: "actor-1",
			creationRequestId: "request-1234567890",
			autoActivateUsers: false,
			deprovisionAction: "suspend",
			defaultRoleTemplateId: "role-1",
		});

		expect(store.reserve.mock.invocationCallOrder[0]).toBeLessThan(
			auth.api.createSCIMManagedConnection.mock.invocationCallOrder[0] ??
				Infinity,
		);
		expect(auth.api.createSCIMManagedConnection).toHaveBeenCalledWith({
			body: expect.objectContaining({
				provisioningDomainId: "org-1",
				actorId: "actor-1",
				expiresAt: expect.any(Date),
				scopes: [
					"scim.users.read",
					"scim.users.write",
					"scim.groups.read",
					"scim.groups.write",
				],
			}),
		});
		expect(store.activate).toHaveBeenCalledWith({
			organizationId: "org-1",
			creationRequestId: "request-1234567890",
			connectionId: "connection-1",
			actorId: "actor-1",
		});
		expect(result.token).toBe("secret-token");
		expect(result.connection.createdAt).toBe("2027-01-01T00:00:00.000Z");
		expect(result.credential).not.toHaveProperty("token");
	});

	it("qualifies every connection item call with the organization provisioning domain", async () => {
		const auth = createAuth();
		const controlPlane = createSCIMManagedControlPlane({
			auth,
			store: createStore(),
		});

		await controlPlane.get({
			organizationId: "org-1",
			connectionId: "connection-1",
		});
		await controlPlane.rotate({
			organizationId: "org-1",
			connectionId: "connection-1",
			actorId: "actor-1",
		});
		await controlPlane.revoke({
			organizationId: "org-1",
			connectionId: "connection-1",
			credentialId: "credential-1",
			actorId: "actor-1",
		});
		await controlPlane.listEvents({
			organizationId: "org-1",
			connectionId: "connection-1",
		});

		for (const call of [
			auth.api.getSCIMManagedConnection,
			auth.api.rotateSCIMManagedCredential,
			auth.api.revokeSCIMManagedCredential,
			auth.api.listSCIMManagedConnectionEvents,
		]) {
			expect(call).toHaveBeenCalledWith({
				body: expect.objectContaining({
					connectionId: "connection-1",
					provisioningDomainId: "org-1",
				}),
			});
		}
	});
});
