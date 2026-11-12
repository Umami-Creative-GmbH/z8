"use server";

import { randomUUID } from "node:crypto";
import { and, eq, isNull, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { enterpriseIdentitySetup, roleTemplate } from "@/db/schema";
import { auth } from "@/lib/auth";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { createSCIMDecommissionStore, decommissionSCIMConnection } from "@/lib/scim/decommission";
import {
	createSCIMManagedControlPlane,
	createSCIMManagedControlPlaneStore,
} from "@/lib/scim/managed-control-plane";
import { notFound, refuse, withDatabase } from "./enterprise-work";
import { getOrCreateEnterpriseIdentitySetupRecord } from "./identity-setup-record";

const IDENTITY_SETUP_PATH = "/settings/enterprise/identity-setup";
const connectionIdSchema = z
	.string({ error: "Invalid SCIM connection" })
	.trim()
	.min(1, { error: "Invalid SCIM connection" })
	.max(255, { error: "Invalid SCIM connection" });
const connectionSchema = z.strictObject({ connectionId: connectionIdSchema });
const createConnectionSchema = z.strictObject({
	autoActivateUsers: z.boolean().default(false),
	deprovisionAction: z.enum(["soft_delete", "suspend"]).default("suspend"),
	defaultRoleTemplateId: z.uuid({ error: "Invalid SCIM connection input" }),
});

type ScimPolicy = z.output<typeof createConnectionSchema>;

const controlPlane = createSCIMManagedControlPlane({
	auth,
	store: createSCIMManagedControlPlaneStore(db),
});

function connectionNotFound(connectionId: string): never {
	notFound("SCIM connection not found", "scimConnection", connectionId);
}

/** Unknown and other organizations' connections are reported identically. */
async function scimConnectionWork<T>(connectionId: string, run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch {
		return connectionNotFound(connectionId);
	}
}

function assertCurrentOrganizationConnection(
	connection: { connectionId?: string; provisioningDomainId?: string | null },
	organizationId: string,
) {
	if (connection.provisioningDomainId !== organizationId) {
		connectionNotFound(connection.connectionId ?? "");
	}
	return connection;
}

async function assertDefaultRoleTemplate(
	database: DatabaseClient,
	organizationId: string,
	defaultRoleTemplateId: string,
): Promise<void> {
	const template = await database.query.roleTemplate.findFirst({
		where: and(
			eq(roleTemplate.id, defaultRoleTemplateId),
			eq(roleTemplate.isActive, true),
			or(
				eq(roleTemplate.organizationId, organizationId),
				and(eq(roleTemplate.isGlobal, true), isNull(roleTemplate.organizationId)),
			),
		),
	});

	if (
		!template ||
		template.isActive !== true ||
		!(
			template.organizationId === organizationId ||
			(template.organizationId === null && template.isGlobal === true)
		)
	) {
		refuse("Default role template is not available for this organization");
	}
}

async function persistScimConnection(
	database: DatabaseClient,
	input: {
		organizationId: string;
		actorId: string;
		policy: ScimPolicy;
		connection: { connectionId: string; createdAt: string };
	},
) {
	await database
		.update(enterpriseIdentitySetup)
		.set({
			scim: {
				policy: input.policy,
				connection: {
					connectionId: input.connection.connectionId,
					provisioningDomainId: input.organizationId,
					createdAt: input.connection.createdAt,
				},
			},
			updatedBy: input.actorId,
		})
		.where(eq(enterpriseIdentitySetup.organizationId, input.organizationId));
}

async function adoptActiveScimConnection(
	database: DatabaseClient,
	input: { organizationId: string; actorId: string; policy: ScimPolicy },
) {
	const creation = await controlPlane.getCreationState(input.organizationId);
	if (creation.status !== "active" || !creation.connectionId) return null;
	const result = await controlPlane.get({
		organizationId: input.organizationId,
		connectionId: creation.connectionId,
	});
	assertCurrentOrganizationConnection(result.connection, input.organizationId);
	await persistScimConnection(database, { ...input, connection: result.connection });
	return result.connection;
}

/** Checks the policy and adopts a connection that is already active, or null. */
async function prepareScimConnection(
	database: DatabaseClient,
	input: { organizationId: string; actorId: string; policy: ScimPolicy },
) {
	await assertDefaultRoleTemplate(
		database,
		input.organizationId,
		input.policy.defaultRoleTemplateId,
	);
	await getOrCreateEnterpriseIdentitySetupRecord(input.organizationId, input.actorId);
	return adoptActiveScimConnection(database, input);
}

export const createEnterpriseIdentityScimConnectionAction = organizationAction(
	{ name: "enterpriseScim.create", requires: "orgAdmin", schema: createConnectionSchema },
	({ actor, organizationId, input }) =>
		withDatabase("Unable to create the SCIM connection", async (database) => {
			const scope = { organizationId, actorId: actor.userId, policy: input };
			const adopted = await prepareScimConnection(database, scope);
			if (adopted) {
				revalidatePath(IDENTITY_SETUP_PATH);
				return { connection: adopted, status: "active" as const };
			}

			const result = await controlPlane.create({
				...input,
				organizationId,
				actorId: actor.userId,
				creationRequestId: randomUUID(),
			});

			if (result.connection) {
				assertCurrentOrganizationConnection(result.connection, organizationId);
				await persistScimConnection(database, { ...scope, connection: result.connection });
			}

			revalidatePath(IDENTITY_SETUP_PATH);
			return result;
		}),
);

export const getEnterpriseIdentityScimStatusAction = organizationAction(
	{ name: "enterpriseScim.status", requires: "orgAdmin", schema: connectionSchema },
	({ organizationId, input }) =>
		withDatabase("Unable to load the SCIM connection", () =>
			scimConnectionWork(input.connectionId, async () => {
				const result = await controlPlane.get({
					organizationId,
					connectionId: input.connectionId,
				});
				assertCurrentOrganizationConnection(result.connection, organizationId);
				return result;
			}),
		),
);

export const reconcileEnterpriseIdentityScimCreationAction = organizationAction(
	{ name: "enterpriseScim.reconcile", requires: "orgAdmin", schema: createConnectionSchema },
	({ actor, organizationId, input }) =>
		withDatabase("Unable to finish the SCIM connection", async (database) => {
			const scope = { organizationId, actorId: actor.userId, policy: input };
			const adopted = await prepareScimConnection(database, scope);
			if (adopted) {
				revalidatePath(IDENTITY_SETUP_PATH);
				return { connection: adopted, status: "active" as const };
			}
			const result = await controlPlane.create({
				...input,
				organizationId,
				actorId: actor.userId,
				creationRequestId: randomUUID(),
			});
			if ("connection" in result && result.connection) {
				assertCurrentOrganizationConnection(result.connection, organizationId);
				await persistScimConnection(database, { ...scope, connection: result.connection });
				revalidatePath(IDENTITY_SETUP_PATH);
				return { connection: result.connection, status: "active" as const };
			}
			revalidatePath(IDENTITY_SETUP_PATH);
			return { status: result.status };
		}),
);

export const rotateEnterpriseIdentityScimCredentialAction = organizationAction(
	{ name: "enterpriseScim.rotate", requires: "orgAdmin", schema: connectionSchema },
	({ actor, organizationId, input }) =>
		withDatabase("Unable to rotate the SCIM credential", () =>
			scimConnectionWork(input.connectionId, async () => {
				const result = await controlPlane.rotate({
					organizationId,
					connectionId: input.connectionId,
					actorId: actor.userId,
				});
				assertCurrentOrganizationConnection(result.connection, organizationId);
				revalidatePath(IDENTITY_SETUP_PATH);
				return result;
			}),
		),
);

export const revokeEnterpriseIdentityScimCredentialAction = organizationAction(
	{
		name: "enterpriseScim.revoke",
		requires: "orgAdmin",
		schema: z.strictObject({ connectionId: connectionIdSchema, credentialId: connectionIdSchema }),
	},
	({ actor, organizationId, input }) =>
		withDatabase("Unable to revoke the SCIM credential", () =>
			scimConnectionWork(input.connectionId, async () => {
				await controlPlane.revoke({
					organizationId,
					connectionId: input.connectionId,
					credentialId: input.credentialId,
					actorId: actor.userId,
				});
				revalidatePath(IDENTITY_SETUP_PATH);
			}),
		),
);

export const listEnterpriseIdentityScimEventsAction = organizationAction(
	{ name: "enterpriseScim.events", requires: "orgAdmin", schema: connectionSchema },
	({ organizationId, input }) =>
		withDatabase("Unable to load the SCIM events", () =>
			scimConnectionWork(input.connectionId, () =>
				controlPlane.listEvents({ organizationId, connectionId: input.connectionId }),
			),
		),
);

export const decommissionEnterpriseIdentityScimConnectionAction = organizationAction(
	{ name: "enterpriseScim.decommission", requires: "orgAdmin", schema: connectionSchema },
	({ actor, organizationId, input }) =>
		withDatabase("Unable to decommission the SCIM connection", (database) =>
			scimConnectionWork(input.connectionId, async () => {
				const result = await decommissionSCIMConnection({
					database,
					store: createSCIMDecommissionStore(database),
					auth,
					organizationId,
					connectionId: input.connectionId,
					actorId: actor.userId,
				});
				if (result === "skipped") return connectionNotFound(input.connectionId);
				revalidatePath(IDENTITY_SETUP_PATH);
				return result;
			}),
		),
);
