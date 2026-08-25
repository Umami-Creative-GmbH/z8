import { randomUUID } from "node:crypto";
import type {
	SCIMManagedConnection,
	SCIMManagedConnectionEvent,
	SCIMManagedCredential,
} from "@better-auth/scim";
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { db } from "@/db";
import { scimProviderConfig } from "@/db/schema/scim";
import type { auth as z8Auth } from "@/lib/auth";
import { getSCIMCredentialExpiresAt, SCIM_SCOPES } from "./constants";

type ConfigState =
	| "creating"
	| "creation_failed"
	| "active"
	| "decommissioning"
	| "decommissioned";
const CREATION_RECOVERY_AFTER_MS = 5 * 60 * 1000;

export interface SCIMProviderConfigRecord {
	id: string;
	organizationId: string;
	creationRequestId: string;
	connectionId: string | null;
	state: ConfigState;
	autoActivateUsers: boolean;
	deprovisionAction: "soft_delete" | "suspend";
	defaultRoleTemplateId: string;
	createdBy: string;
	updatedBy: string | null;
	createdAt: Date;
	creationRecoveryClaimToken: string | null;
	creationRecoveryClaimExpiresAt: Date | null;
	creationAttemptCount: number;
	creationLastError: string | null;
}

export interface SCIMProviderConfigReservationInput {
	organizationId: string;
	creationRequestId: string;
	autoActivateUsers: boolean;
	deprovisionAction: "soft_delete" | "suspend";
	defaultRoleTemplateId: string;
	createdBy: string;
}

export interface SCIMManagedControlPlaneStore {
	reserve(input: SCIMProviderConfigReservationInput): Promise<{
		config: SCIMProviderConfigRecord;
		created: boolean;
	}>;
	findByOrganizationId(
		organizationId: string,
	): Promise<SCIMProviderConfigRecord | null>;
	activate(input: {
		organizationId: string;
		creationRequestId: string;
		connectionId: string;
		actorId: string;
		claimToken: string | null;
	}): Promise<SCIMProviderConfigRecord | null>;
	failCreation(input: {
		organizationId: string;
		creationRequestId: string;
		claimToken: string;
	}): Promise<boolean>;
	claimRecovery(input: {
		organizationId: string;
		creationRequestId: string;
		claimToken: string;
		now: Date;
		expiresAt: Date;
	}): Promise<boolean>;
}

export class SCIMCreationRecoveryConflictError extends Error {
	constructor() {
		super("SCIM creation recovery lease is no longer owned");
		this.name = "SCIMCreationRecoveryConflictError";
	}
}

export type SCIMManagedAuthApi = Pick<
	typeof z8Auth.api,
	| "createSCIMManagedConnection"
	| "listSCIMManagedConnections"
	| "getSCIMManagedConnection"
	| "rotateSCIMManagedCredential"
	| "revokeSCIMManagedCredential"
	| "listSCIMManagedConnectionEvents"
	| "decommissionSCIMManagedConnection"
>;

export type SCIMManagedConnectionDTO = Omit<
	SCIMManagedConnection,
	"createdAt" | "decommissionStartedAt" | "decommissionedAt"
> & {
	createdAt: string;
	decommissionStartedAt: string | null;
	decommissionedAt: string | null;
};
export type SCIMManagedCredentialDTO = Omit<
	SCIMManagedCredential,
	"expiresAt" | "createdAt" | "lastUsedAt" | "revokedAt"
> & {
	expiresAt: string;
	createdAt: string;
	lastUsedAt: string | null;
	revokedAt: string | null;
};
export type SCIMManagedConnectionEventDTO = Omit<
	SCIMManagedConnectionEvent,
	"createdAt"
> & { createdAt: string };

interface SCIMManagedControlPlaneCreateRequest {
	organizationId: string;
	creationRequestId: string;
	autoActivateUsers: boolean;
	deprovisionAction: "soft_delete" | "suspend";
	defaultRoleTemplateId: string;
	actorId: string;
}

function toConnectionDTO(
	connection: SCIMManagedConnection,
): SCIMManagedConnectionDTO {
	return {
		...connection,
		createdAt: connection.createdAt.toISOString(),
		decommissionStartedAt:
			connection.decommissionStartedAt?.toISOString() ?? null,
		decommissionedAt: connection.decommissionedAt?.toISOString() ?? null,
	};
}

function toCredentialDTO(
	credential: SCIMManagedCredential,
): SCIMManagedCredentialDTO {
	return {
		...credential,
		expiresAt: credential.expiresAt.toISOString(),
		createdAt: credential.createdAt.toISOString(),
		lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
		revokedAt: credential.revokedAt?.toISOString() ?? null,
	};
}

function toEventDTO(
	event: SCIMManagedConnectionEvent,
): SCIMManagedConnectionEventDTO {
	return { ...event, createdAt: event.createdAt.toISOString() };
}

export function createSCIMManagedControlPlane(input: {
	auth: { api: SCIMManagedAuthApi };
	store: SCIMManagedControlPlaneStore;
	now?: () => Date;
}) {
	const expiresAt = () =>
		getSCIMCredentialExpiresAt(input.now?.() ?? new Date());
	const create = async (request: SCIMManagedControlPlaneCreateRequest) => {
		const reservation = await input.store.reserve({
			organizationId: request.organizationId,
			creationRequestId: request.creationRequestId,
			autoActivateUsers: request.autoActivateUsers,
			deprovisionAction: request.deprovisionAction,
			defaultRoleTemplateId: request.defaultRoleTemplateId,
			createdBy: request.actorId,
		});
		if (
			reservation.config.state === "active" ||
			reservation.config.state === "decommissioning"
		) {
			throw new Error("SCIM connection already exists for this organization");
		}
		const now = input.now?.() ?? new Date();
		const isRecovery =
			!reservation.created &&
			now.getTime() - reservation.config.createdAt.getTime() >=
				CREATION_RECOVERY_AFTER_MS;
		if (
			!reservation.created &&
			!reservation.config.connectionId &&
			!isRecovery
		) {
			return {
				status: "creating" as const,
				creationRequestId: reservation.config.creationRequestId,
			};
		}
		const claimToken = isRecovery ? randomUUID() : undefined;
		if (
			claimToken &&
			!(await input.store.claimRecovery({
				organizationId: request.organizationId,
				creationRequestId: reservation.config.creationRequestId,
				claimToken,
				now,
				expiresAt: new Date(now.getTime() + CREATION_RECOVERY_AFTER_MS),
			}))
		) {
			return {
				status: "creating" as const,
				creationRequestId: reservation.config.creationRequestId,
			};
		}
		let created: {
			connection: SCIMManagedConnection;
			credential: SCIMManagedCredential;
			token: string;
		} | null = null;
		const existing = await input.auth.api.listSCIMManagedConnections({
			body: { provisioningDomainId: request.organizationId },
		});
		const adopted = existing.connections.find(
			(connection) =>
				connection.creationRequestId === reservation.config.creationRequestId,
		);
		if (adopted) {
			const prior = await input.auth.api.getSCIMManagedConnection({
				body: {
					connectionId: adopted.connectionId,
					provisioningDomainId: request.organizationId,
				},
			});
			const rotated = await input.auth.api.rotateSCIMManagedCredential({
				body: {
					connectionId: adopted.connectionId,
					provisioningDomainId: request.organizationId,
					actorId: request.actorId,
					scopes: SCIM_SCOPES,
					expiresAt: expiresAt(),
				},
			});
			for (const credential of prior.credentials) {
				if (credential.status === "active")
					await input.auth.api.revokeSCIMManagedCredential({
						body: {
							connectionId: adopted.connectionId,
							provisioningDomainId: request.organizationId,
							credentialId: credential.credentialId,
							actorId: request.actorId,
						},
					});
			}
			created = rotated;
		} else if (!reservation.created) {
			if (!claimToken) throw new SCIMCreationRecoveryConflictError();
			const failed = await input.store.failCreation({
				organizationId: request.organizationId,
				creationRequestId: reservation.config.creationRequestId,
				claimToken,
			});
			if (!failed) throw new SCIMCreationRecoveryConflictError();
			return {
				status: "creation_failed" as const,
				creationRequestId: reservation.config.creationRequestId,
			};
		} else {
			created = await input.auth.api.createSCIMManagedConnection({
				body: {
					creationRequestId: reservation.config.creationRequestId,
					provisioningDomainId: request.organizationId,
					actorId: request.actorId,
					scopes: SCIM_SCOPES,
					expiresAt: expiresAt(),
				},
			});
		}
		const activated = await input.store.activate({
			organizationId: request.organizationId,
			creationRequestId: reservation.config.creationRequestId,
			connectionId: created.connection.connectionId,
			actorId: request.actorId,
			claimToken: claimToken ?? null,
		});
		if (!activated) {
			await input.auth.api.revokeSCIMManagedCredential({
				body: {
					connectionId: created.connection.connectionId,
					provisioningDomainId: request.organizationId,
					credentialId: created.credential.credentialId,
					actorId: request.actorId,
				},
			});
			throw new SCIMCreationRecoveryConflictError();
		}
		return {
			connection: toConnectionDTO(created.connection),
			credential: toCredentialDTO(created.credential),
			token: created.token,
		};
	};

	return {
		create,
		async getCreationState(organizationId: string) {
			const config = await input.store.findByOrganizationId(organizationId);
			return config
				? { connectionId: config.connectionId, status: config.state }
				: { connectionId: null, status: "creation_failed" as const };
		},
		async list(organizationId: string) {
			const result = await input.auth.api.listSCIMManagedConnections({
				body: { provisioningDomainId: organizationId },
			});
			return result.connections.map(toConnectionDTO);
		},
		async get(request: { organizationId: string; connectionId: string }) {
			const result = await input.auth.api.getSCIMManagedConnection({
				body: {
					connectionId: request.connectionId,
					provisioningDomainId: request.organizationId,
				},
			});
			return {
				connection: toConnectionDTO(result.connection),
				credentials: result.credentials.map(toCredentialDTO),
			};
		},
		async rotate(request: {
			organizationId: string;
			connectionId: string;
			actorId: string;
		}) {
			const result = await input.auth.api.rotateSCIMManagedCredential({
				body: {
					connectionId: request.connectionId,
					provisioningDomainId: request.organizationId,
					actorId: request.actorId,
					scopes: SCIM_SCOPES,
					expiresAt: expiresAt(),
				},
			});
			return {
				connection: toConnectionDTO(result.connection),
				credential: toCredentialDTO(result.credential),
				token: result.token,
			};
		},
		async revoke(request: {
			organizationId: string;
			connectionId: string;
			credentialId: string;
			actorId: string;
		}) {
			await input.auth.api.revokeSCIMManagedCredential({
				body: {
					connectionId: request.connectionId,
					provisioningDomainId: request.organizationId,
					credentialId: request.credentialId,
					actorId: request.actorId,
				},
			});
		},
		async listEvents(request: {
			organizationId: string;
			connectionId: string;
		}) {
			const result = await input.auth.api.listSCIMManagedConnectionEvents({
				body: {
					connectionId: request.connectionId,
					provisioningDomainId: request.organizationId,
				},
			});
			return result.events.map(toEventDTO);
		},
	};
}

type ControlPlaneDb = Pick<typeof db, "insert" | "query" | "update">;

export function createSCIMManagedControlPlaneStore(
	database: ControlPlaneDb,
): SCIMManagedControlPlaneStore {
	return {
		async reserve(input) {
			const [config] = await database
				.insert(scimProviderConfig)
				.values({
					organizationId: input.organizationId,
					creationRequestId: input.creationRequestId,
					autoActivateUsers: input.autoActivateUsers,
					deprovisionAction: input.deprovisionAction,
					defaultRoleTemplateId: input.defaultRoleTemplateId,
					createdBy: input.createdBy,
					connectionId: null,
					state: "creating",
					updatedBy: null,
					creationRecoveryClaimToken: null,
					creationRecoveryClaimExpiresAt: null,
					creationAttemptCount: 0,
					creationLastError: null,
				})
				.onConflictDoNothing({ target: scimProviderConfig.organizationId })
				.returning();
			if (config) return { config, created: true };
			const existing = await database.query.scimProviderConfig.findFirst({
				where: eq(scimProviderConfig.organizationId, input.organizationId),
			});
			if (!existing)
				throw new Error("Failed to reserve SCIM provider configuration");
			if (
				existing.state === "creation_failed" &&
				existing.creationRequestId !== input.creationRequestId
			) {
				const [retried] = await database
					.update(scimProviderConfig)
					.set({
						creationRequestId: input.creationRequestId,
						state: "creating",
						creationAttemptCount: 0,
						creationLastError: null,
						creationRecoveryClaimToken: null,
						creationRecoveryClaimExpiresAt: null,
						createdAt: sql`now()`,
						updatedBy: input.createdBy,
					})
					.where(
						and(
							eq(scimProviderConfig.organizationId, input.organizationId),
							eq(scimProviderConfig.state, "creation_failed"),
						),
					)
					.returning();
				if (retried) return { config: retried, created: true };
			}
			return { config: existing, created: false };
		},
		async findByOrganizationId(organizationId) {
			return (
				(await database.query.scimProviderConfig.findFirst({
					where: eq(scimProviderConfig.organizationId, organizationId),
				})) ?? null
			);
		},
		async activate(input) {
			const [config] = await database
				.update(scimProviderConfig)
				.set({
					connectionId: input.connectionId,
					state: "active",
					updatedBy: input.actorId,
					creationRecoveryClaimToken: null,
					creationRecoveryClaimExpiresAt: null,
				})
				.where(
					and(
						eq(scimProviderConfig.organizationId, input.organizationId),
						eq(scimProviderConfig.creationRequestId, input.creationRequestId),
						eq(scimProviderConfig.state, "creating"),
						...(input.claimToken
							? [
									eq(
										scimProviderConfig.creationRecoveryClaimToken,
										input.claimToken,
									),
								]
							: [isNull(scimProviderConfig.creationRecoveryClaimToken)]),
					),
				)
				.returning();
			return config ?? null;
		},
		async failCreation(input) {
			const [config] = await database
				.update(scimProviderConfig)
				.set({
					state: "creation_failed",
					creationLastError: "remote_connection_not_found",
					creationRecoveryClaimToken: null,
					creationRecoveryClaimExpiresAt: null,
				})
				.where(
					and(
						eq(scimProviderConfig.organizationId, input.organizationId),
						eq(scimProviderConfig.creationRequestId, input.creationRequestId),
						eq(scimProviderConfig.state, "creating"),
						eq(scimProviderConfig.creationRecoveryClaimToken, input.claimToken),
					),
				)
				.returning();
			return Boolean(config);
		},
		async claimRecovery(input) {
			const [config] = await database
				.update(scimProviderConfig)
				.set({
					creationRecoveryClaimToken: input.claimToken,
					creationRecoveryClaimExpiresAt: input.expiresAt,
					creationAttemptCount: sql`${scimProviderConfig.creationAttemptCount} + 1`,
				})
				.where(
					and(
						eq(scimProviderConfig.organizationId, input.organizationId),
						eq(scimProviderConfig.creationRequestId, input.creationRequestId),
						eq(scimProviderConfig.state, "creating"),
						or(
							isNull(scimProviderConfig.creationRecoveryClaimToken),
							lte(scimProviderConfig.creationRecoveryClaimExpiresAt, input.now),
						),
					),
				)
				.returning({ id: scimProviderConfig.id });
			return Boolean(config);
		},
	};
}
