import { and, eq } from "drizzle-orm";
import type {
	SCIMManagedConnection,
	SCIMManagedConnectionEvent,
	SCIMManagedCredential,
} from "@better-auth/scim";
import type { db } from "@/db";
import type { auth as z8Auth } from "@/lib/auth";
import { scimProviderConfig } from "@/db/schema/scim";
import { getSCIMCredentialExpiresAt, SCIM_SCOPES } from "./constants";

type ConfigState = "creating" | "active" | "decommissioning" | "decommissioned";
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
}

export interface SCIMManagedControlPlaneStore {
	reserve(
		input: Omit<
			SCIMProviderConfigRecord,
			"id" | "connectionId" | "state" | "updatedBy"
		>,
	): Promise<{
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
	}): Promise<SCIMProviderConfigRecord | null>;
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
	const create = async (
		request: Omit<
			SCIMProviderConfigRecord,
			"id" | "connectionId" | "state" | "updatedBy" | "createdBy"
		> & { actorId: string },
	) => {
		const reservation = await input.store.reserve({
			...request,
			createdBy: request.actorId,
		});
		if (
			reservation.config.state === "active" ||
			reservation.config.state === "decommissioning"
		) {
			throw new Error("SCIM connection already exists for this organization");
		}
		const isRecovery =
			!reservation.created &&
			(input.now?.().getTime() ?? Date.now()) -
				reservation.config.createdAt.getTime() >=
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
			return {
				status: "creating" as const,
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
		await input.store.activate({
			organizationId: request.organizationId,
			creationRequestId: reservation.config.creationRequestId,
			connectionId: created.connection.connectionId,
			actorId: request.actorId,
		});
		return {
			connection: toConnectionDTO(created.connection),
			credential: toCredentialDTO(created.credential),
			token: created.token,
		};
	};

	return {
		create,
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
					...input,
					connectionId: null,
					state: "creating",
					updatedBy: null,
				})
				.onConflictDoNothing({ target: scimProviderConfig.organizationId })
				.returning();
			if (config) return { config, created: true };
			const existing = await database.query.scimProviderConfig.findFirst({
				where: eq(scimProviderConfig.organizationId, input.organizationId),
			});
			if (!existing)
				throw new Error("Failed to reserve SCIM provider configuration");
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
				})
				.where(
					and(
						eq(scimProviderConfig.organizationId, input.organizationId),
						eq(scimProviderConfig.creationRequestId, input.creationRequestId),
						eq(scimProviderConfig.state, "creating"),
					),
				)
				.returning();
			return config ?? null;
		},
	};
}
