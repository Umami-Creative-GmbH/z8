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
		createdAt: new Date("2026-08-25T00:00:00.000Z"),
		creationRecoveryClaimToken: null,
		creationRecoveryClaimExpiresAt: null,
		creationAttemptCount: 0,
		creationLastError: null,
	};

	return {
		reserve: vi.fn().mockResolvedValue({ config, created: true }),
		findByOrganizationId: vi.fn().mockResolvedValue(config),
		activate: vi.fn().mockImplementation(async (input) => ({
			...config,
			connectionId: input.connectionId,
			state: "active" as const,
		})),
		failCreation: vi.fn(),
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

	it("adopts an interrupted creation by rotating then revoking the lost credential", async () => {
		const auth = createAuth();
		const store = createStore();
		store.reserve.mockResolvedValueOnce({
			config: (await store.findByOrganizationId("org-1"))!,
			created: false,
		});
		const controlPlane = createSCIMManagedControlPlane({
			auth,
			store,
			now: () => new Date("2026-08-25T00:10:00.000Z"),
		});

		const result = await controlPlane.create({
			organizationId: "org-1",
			actorId: "actor-1",
			creationRequestId: "request-1234567890",
			autoActivateUsers: false,
			deprovisionAction: "suspend",
			defaultRoleTemplateId: "role-1",
		});

		expect(auth.api.createSCIMManagedConnection).not.toHaveBeenCalled();
		expect(auth.api.rotateSCIMManagedCredential).toHaveBeenCalledWith({
			body: expect.objectContaining({
				connectionId: "connection-1",
				provisioningDomainId: "org-1",
				actorId: "actor-1",
			}),
		});
		expect(auth.api.revokeSCIMManagedCredential).toHaveBeenCalledWith({
			body: {
				connectionId: "connection-1",
				provisioningDomainId: "org-1",
				credentialId: "credential-1",
				actorId: "actor-1",
			},
		});
		expect(result.token).toBe("rotated-secret-token");
	});

	it("does not create a second active connection when a concurrent reservation is active", async () => {
		const store = createStore();
		store.reserve.mockResolvedValueOnce({
			config: {
				...(await store.findByOrganizationId("org-1"))!,
				state: "active",
				connectionId: "connection-1",
			},
			created: false,
		});
		const auth = createAuth();
		const controlPlane = createSCIMManagedControlPlane({ auth, store });

		await expect(
			controlPlane.create({
				organizationId: "org-1",
				actorId: "actor-1",
				creationRequestId: "request-1234567890",
				autoActivateUsers: false,
				deprovisionAction: "suspend",
				defaultRoleTemplateId: "role-1",
			}),
		).rejects.toThrow("already exists");
		expect(auth.api.createSCIMManagedConnection).not.toHaveBeenCalled();
	});

	it("returns creation-in-progress to concurrent creators without a second external create", async () => {
		const store = createStore();
		const auth = createAuth();
		auth.api.listSCIMManagedConnections.mockResolvedValue({ connections: [] });
		const first = createSCIMManagedControlPlane({
			auth,
			store,
			now: () => new Date("2026-08-25T00:00:01.000Z"),
		});
		const second = createSCIMManagedControlPlane({
			auth,
			store,
			now: () => new Date("2026-08-25T00:00:01.000Z"),
		});
		store.reserve.mockResolvedValueOnce({
			config: (await store.findByOrganizationId("org-1"))!,
			created: true,
		});
		store.reserve.mockResolvedValueOnce({
			config: (await store.findByOrganizationId("org-1"))!,
			created: false,
		});

		const input = {
			organizationId: "org-1",
			actorId: "actor-1",
			creationRequestId: "request-1234567890",
			autoActivateUsers: false,
			deprovisionAction: "suspend" as const,
			defaultRoleTemplateId: "role-1",
		};
		const [created, pending] = await Promise.all([
			first.create(input),
			second.create(input),
		]);
		expect(auth.api.createSCIMManagedConnection).toHaveBeenCalledTimes(1);
		expect(created).toHaveProperty("token", "secret-token");
		expect(pending).toEqual({
			status: "creating",
			creationRequestId: "request-1234567890",
		});
	});

	it("keeps raw tokens out of status, list, and event DTOs", async () => {
		const auth = createAuth();
		auth.api.listSCIMManagedConnectionEvents.mockResolvedValue({
			events: [
				{
					sequence: 1,
					type: "credential.issued",
					actorId: "actor-1",
					credentialId: "credential-1",
					createdAt: expiresAt,
				},
			],
		});
		const controlPlane = createSCIMManagedControlPlane({
			auth,
			store: createStore(),
		});

		const [connections, status, events] = await Promise.all([
			controlPlane.list("org-1"),
			controlPlane.get({
				organizationId: "org-1",
				connectionId: "connection-1",
			}),
			controlPlane.listEvents({
				organizationId: "org-1",
				connectionId: "connection-1",
			}),
		]);
		expect(JSON.stringify({ connections, status, events })).not.toContain(
			"secret-token",
		);
		expect(events[0]?.createdAt).toBe("2027-01-01T00:00:00.000Z");
	});
});
