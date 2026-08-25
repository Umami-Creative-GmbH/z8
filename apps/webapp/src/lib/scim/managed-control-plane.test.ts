import { describe, expect, it, vi } from "vitest";
import {
	createSCIMManagedControlPlane,
	createSCIMManagedControlPlaneStore,
	SCIMCreationRecoveryConflictError,
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
		failCreation: vi.fn().mockResolvedValue(true),
		claimRecovery: vi.fn().mockResolvedValue(true),
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
		const controlPlane = createSCIMManagedControlPlane({
			auth,
			store,
			now: () => new Date("2026-08-25T00:00:00.000Z"),
		});

		const result = await controlPlane.create(
			Object.assign(
				{
					organizationId: "org-1",
					actorId: "actor-1",
					creationRequestId: "request-1234567890",
					autoActivateUsers: false,
					deprovisionAction: "suspend" as const,
					defaultRoleTemplateId: "role-1",
				},
				{
					createdAt: new Date("2099-01-01T00:00:00.000Z"),
					creationRecoveryClaimToken: "nonexpiring-claim",
					creationRecoveryClaimExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
					creationAttemptCount: 99,
					creationLastError: "injected-error",
				},
			),
		);

		expect(store.reserve.mock.invocationCallOrder[0]).toBeLessThan(
			auth.api.createSCIMManagedConnection.mock.invocationCallOrder[0] ??
				Infinity,
		);
		expect(store.reserve).toHaveBeenCalledWith({
			organizationId: "org-1",
			creationRequestId: "request-1234567890",
			autoActivateUsers: false,
			deprovisionAction: "suspend",
			defaultRoleTemplateId: "role-1",
			createdBy: "actor-1",
		});
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
			claimToken: null,
		});
		expect(result.token).toBe("secret-token");
		expect(result.connection.createdAt).toBe("2027-01-01T00:00:00.000Z");
		expect(result.credential).not.toHaveProperty("token");
	});

	it("fences a slow original creator after recovery adopts its connection", async () => {
		const store = createStore();
		const config = await store.findByOrganizationId("org-1");
		if (!config) throw new Error("Missing test config");
		const originalConnectionCreated = Promise.withResolvers<void>();
		const recoveryCompleted = Promise.withResolvers<void>();
		const auth = createAuth();
		const originalCreate = {
			connection: {
				creationRequestId: config.creationRequestId,
				connectionId: "connection-1",
				provisioningDomainId: config.organizationId,
				status: "active" as const,
				createdAt: expiresAt,
				createdBy: "actor-1",
				decommissionStartedAt: null,
				decommissionStartedBy: null,
				decommissionedAt: null,
				decommissionedBy: null,
			},
			credential: {
				credentialId: "credential-1",
				status: "active" as const,
				scopes: ["scim.users.read"] as const,
				expiresAt,
				createdAt: expiresAt,
				createdBy: "actor-1",
				lastUsedAt: null,
				revokedAt: null,
				revokedBy: null,
			},
			token: "original-secret-token",
		};
		auth.api.createSCIMManagedConnection.mockImplementation(async () => {
			originalConnectionCreated.resolve();
			await recoveryCompleted.promise;
			return originalCreate;
		});
		auth.api.listSCIMManagedConnections
			.mockResolvedValueOnce({ connections: [] })
			.mockResolvedValueOnce({ connections: [originalCreate.connection] });
		store.reserve
			.mockResolvedValueOnce({ config, created: true })
			.mockResolvedValueOnce({
				config: {
					...config,
					createdAt: new Date("2026-08-25T00:00:00.000Z"),
				},
				created: false,
			});
		store.claimRecovery.mockResolvedValue(true);
		store.activate.mockImplementation(async (input) => {
			if (input.claimToken) {
				recoveryCompleted.resolve();
				return {
					...config,
					connectionId: input.connectionId,
					state: "active" as const,
				};
			}
			return null;
		});

		const request = {
			organizationId: "org-1",
			actorId: "actor-1",
			creationRequestId: config.creationRequestId,
			autoActivateUsers: false,
			deprovisionAction: "suspend" as const,
			defaultRoleTemplateId: "role-1",
		};
		const original = createSCIMManagedControlPlane({
			auth,
			store,
			now: () => new Date("2026-08-25T00:00:01.000Z"),
		}).create(request);
		await originalConnectionCreated.promise;
		const recovered = await createSCIMManagedControlPlane({
			auth,
			store,
			now: () => new Date("2026-08-25T00:10:00.000Z"),
		}).create(request);

		await expect(original).rejects.toBeInstanceOf(
			SCIMCreationRecoveryConflictError,
		);
		expect(recovered).toHaveProperty("token", "rotated-secret-token");
		expect(store.activate).toHaveBeenCalledWith(
			expect.objectContaining({ claimToken: null }),
		);
		expect(auth.api.revokeSCIMManagedCredential).toHaveBeenCalledWith({
			body: expect.objectContaining({ credentialId: "credential-1" }),
		});
	});

	it("treats a retried creation as fresh at the recovery boundary", async () => {
		const store = createStore();
		const retriedAt = new Date("2026-08-25T00:10:00.000Z");
		const config = await store.findByOrganizationId("org-1");
		if (!config) throw new Error("Missing test config");
		store.reserve.mockResolvedValue({
			config: {
				...config,
				creationRequestId: "request-0987654321",
				createdAt: retriedAt,
				creationRecoveryClaimToken: null,
				creationRecoveryClaimExpiresAt: null,
			},
			created: false,
		});
		const auth = createAuth();
		const controlPlane = createSCIMManagedControlPlane({
			auth,
			store,
			now: () => new Date("2026-08-25T00:14:59.999Z"),
		});

		await expect(
			controlPlane.create({
				organizationId: "org-1",
				actorId: "actor-1",
				creationRequestId: "request-0987654321",
				autoActivateUsers: false,
				deprovisionAction: "suspend",
				defaultRoleTemplateId: "role-1",
			}),
		).resolves.toEqual({
			status: "creating",
			creationRequestId: "request-0987654321",
		});
		expect(store.claimRecovery).not.toHaveBeenCalled();
	});

	it("resets the server-owned reservation time when retrying a failed creation", async () => {
		const config = await createStore().findByOrganizationId("org-1");
		if (!config) throw new Error("Missing test config");
		const failedConfig = {
			...config,
			state: "creation_failed" as const,
			creationLastError: "remote_connection_not_found",
			creationRecoveryClaimToken: "11111111-1111-4111-8111-111111111111",
			creationRecoveryClaimExpiresAt: new Date("2026-08-25T00:00:00.000Z"),
		};
		const retriedConfig = {
			...failedConfig,
			creationRequestId: "request-0987654321",
			state: "creating" as const,
			createdAt: new Date("2026-08-25T00:10:00.000Z"),
			creationLastError: null,
			creationRecoveryClaimToken: null,
			creationRecoveryClaimExpiresAt: null,
		};
		const set = vi.fn(() => ({
			where: () => ({
				returning: vi.fn().mockResolvedValueOnce([retriedConfig]),
			}),
		}));
		const database = {
			insert: () => ({
				values: () => ({
					onConflictDoNothing: () => ({
						returning: vi.fn().mockResolvedValue([]),
					}),
				}),
			}),
			query: {
				scimProviderConfig: {
					findFirst: vi.fn().mockResolvedValue(failedConfig),
				},
			},
			update: () => ({ set }),
		};
		const store = createSCIMManagedControlPlaneStore(database as never);

		const result = await store.reserve({
			organizationId: "org-1",
			creationRequestId: "request-0987654321",
			autoActivateUsers: false,
			deprovisionAction: "suspend",
			defaultRoleTemplateId: "role-1",
			createdBy: "actor-1",
		});

		expect(result).toEqual({ config: retriedConfig, created: true });
		expect(set).toHaveBeenCalledWith(
			expect.objectContaining({
				createdAt: expect.any(Object),
				creationRecoveryClaimToken: null,
				creationRecoveryClaimExpiresAt: null,
			}),
		);
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

	it("allows only the recovery claimant to adopt a stale creation", async () => {
		const store = createStore() as SCIMManagedControlPlaneStore & {
			claimRecovery: ReturnType<typeof vi.fn>;
		};
		store.reserve.mockResolvedValue({
			config: (await store.findByOrganizationId("org-1"))!,
			created: false,
		});
		store.claimRecovery = vi
			.fn()
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);
		const auth = createAuth();
		const input = {
			organizationId: "org-1",
			actorId: "actor-1",
			creationRequestId: "request-1234567890",
			autoActivateUsers: false,
			deprovisionAction: "suspend" as const,
			defaultRoleTemplateId: "role-1",
		};

		const [owner, observer] = await Promise.all([
			createSCIMManagedControlPlane({
				auth,
				store,
				now: () => new Date("2026-08-25T00:10:00.000Z"),
			}).create(input),
			createSCIMManagedControlPlane({
				auth,
				store,
				now: () => new Date("2026-08-25T00:10:00.000Z"),
			}).create(input),
		]);

		expect(store.claimRecovery).toHaveBeenCalledTimes(2);
		expect(auth.api.rotateSCIMManagedCredential).toHaveBeenCalledTimes(1);
		expect(auth.api.revokeSCIMManagedCredential).toHaveBeenCalledTimes(1);
		expect(owner).toHaveProperty("token", "rotated-secret-token");
		expect(observer).toEqual({
			status: "creating",
			creationRequestId: "request-1234567890",
		});
	});

	it("treats a stale recovery completion that loses its lease as a conflict", async () => {
		const store = createStore();
		store.reserve.mockResolvedValue({
			config: (await store.findByOrganizationId("org-1"))!,
			created: false,
		});
		store.activate.mockResolvedValue(null);
		const auth = createAuth();

		await expect(
			createSCIMManagedControlPlane({
				auth,
				store,
				now: () => new Date("2026-08-25T00:10:00.000Z"),
			}).create({
				organizationId: "org-1",
				actorId: "actor-1",
				creationRequestId: "request-1234567890",
				autoActivateUsers: false,
				deprovisionAction: "suspend",
				defaultRoleTemplateId: "role-1",
			}),
		).rejects.toBeInstanceOf(SCIMCreationRecoveryConflictError);
		expect(store.activate).toHaveBeenCalledWith(
			expect.objectContaining({ claimToken: expect.any(String) }),
		);
	});

	it("releases an absent recovered request so a later explicit create uses a fresh request", async () => {
		const store = createStore();
		const staleConfig = (await store.findByOrganizationId("org-1"))!;
		store.reserve
			.mockResolvedValueOnce({ config: staleConfig, created: false })
			.mockResolvedValueOnce({
				config: {
					...staleConfig,
					creationRequestId: "request-0987654321",
				},
				created: true,
			});
		const auth = createAuth();
		auth.api.listSCIMManagedConnections.mockResolvedValue({ connections: [] });
		const controlPlane = createSCIMManagedControlPlane({
			auth,
			store,
			now: () => new Date("2026-08-25T00:10:00.000Z"),
		});

		await expect(
			controlPlane.create({
				organizationId: "org-1",
				actorId: "actor-1",
				creationRequestId: "request-1234567890",
				autoActivateUsers: false,
				deprovisionAction: "suspend",
				defaultRoleTemplateId: "role-1",
			}),
		).resolves.toEqual({
			status: "creation_failed",
			creationRequestId: "request-1234567890",
		});
		await controlPlane.create({
			organizationId: "org-1",
			actorId: "actor-1",
			creationRequestId: "request-0987654321",
			autoActivateUsers: false,
			deprovisionAction: "suspend",
			defaultRoleTemplateId: "role-1",
		});

		expect(store.failCreation).toHaveBeenCalledWith(
			expect.objectContaining({ claimToken: expect.any(String) }),
		);
		expect(auth.api.createSCIMManagedConnection).toHaveBeenCalledTimes(1);
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
