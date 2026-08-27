"use server";

import { randomUUID } from "node:crypto";
import { and, eq, isNull, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { enterpriseIdentitySetup, roleTemplate } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
	createSCIMDecommissionStore,
	decommissionSCIMConnection,
} from "@/lib/scim/decommission";
import {
	createSCIMManagedControlPlane,
	createSCIMManagedControlPlaneStore,
} from "@/lib/scim/managed-control-plane";
import {
	getOrCreateEnterpriseIdentitySetupRecord,
	requireEnterpriseOrgAdmin,
} from "./actions";

const IDENTITY_SETUP_PATH = "/settings/enterprise/identity-setup";
const connectionIdSchema = z.string().trim().min(1).max(255);
const createConnectionSchema = z.strictObject({
	autoActivateUsers: z.boolean().default(false),
	deprovisionAction: z.enum(["soft_delete", "suspend"]).default("suspend"),
	defaultRoleTemplateId: z.uuid(),
});

const controlPlane = createSCIMManagedControlPlane({
	auth,
	store: createSCIMManagedControlPlaneStore(db),
});

function parseConnectionId(input: unknown): string {
	const parsed = connectionIdSchema.safeParse(input);
	if (!parsed.success) throw new Error("Invalid SCIM connection");
	return parsed.data;
}

function connectionNotFound(): never {
	throw new Error("SCIM connection not found");
}

function assertCurrentOrganizationConnection(
	connection: { provisioningDomainId?: string | null },
	organizationId: string,
) {
	if (connection.provisioningDomainId !== organizationId) connectionNotFound();
	return connection;
}

async function assertDefaultRoleTemplate(
	organizationId: string,
	defaultRoleTemplateId: string,
): Promise<void> {
	const template = await db.query.roleTemplate.findFirst({
		where: and(
			eq(roleTemplate.id, defaultRoleTemplateId),
			eq(roleTemplate.isActive, true),
			or(
				eq(roleTemplate.organizationId, organizationId),
				and(
					eq(roleTemplate.isGlobal, true),
					isNull(roleTemplate.organizationId),
				),
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
		throw new Error(
			"Default role template is not available for this organization",
		);
	}
}

async function persistScimConnection(input: {
	organizationId: string;
	actorId: string;
	policy: {
		autoActivateUsers: boolean;
		deprovisionAction: "soft_delete" | "suspend";
		defaultRoleTemplateId: string;
	};
	connection: { connectionId: string; createdAt: string };
}) {
	await db
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

async function adoptActiveScimConnection(input: {
	organizationId: string;
	actorId: string;
	policy: {
		autoActivateUsers: boolean;
		deprovisionAction: "soft_delete" | "suspend";
		defaultRoleTemplateId: string;
	};
}) {
	const creation = await controlPlane.getCreationState(input.organizationId);
	if (creation.status !== "active" || !creation.connectionId) return null;
	const result = await controlPlane.get({
		organizationId: input.organizationId,
		connectionId: creation.connectionId,
	});
	assertCurrentOrganizationConnection(result.connection, input.organizationId);
	await persistScimConnection({
		...input,
		connection: result.connection,
	});
	return result.connection;
}

export async function createEnterpriseIdentityScimConnectionAction(
	input: unknown,
) {
	const { authContext, organizationId } = await requireEnterpriseOrgAdmin();
	const parsed = createConnectionSchema.safeParse(input);
	if (!parsed.success) throw new Error("Invalid SCIM connection input");
	await assertDefaultRoleTemplate(
		organizationId,
		parsed.data.defaultRoleTemplateId,
	);
	await getOrCreateEnterpriseIdentitySetupRecord(
		organizationId,
		authContext.user.id,
	);
	const adopted = await adoptActiveScimConnection({
		organizationId,
		actorId: authContext.user.id,
		policy: parsed.data,
	});
	if (adopted) {
		revalidatePath(IDENTITY_SETUP_PATH);
		return { connection: adopted, status: "active" as const };
	}

	const result = await controlPlane.create({
		...parsed.data,
		organizationId,
		actorId: authContext.user.id,
		creationRequestId: randomUUID(),
	});

	if (result.connection) {
		assertCurrentOrganizationConnection(result.connection, organizationId);
		await persistScimConnection({
			organizationId,
			actorId: authContext.user.id,
			policy: parsed.data,
			connection: result.connection,
		});
	}

	revalidatePath(IDENTITY_SETUP_PATH);
	return result;
}

export async function getEnterpriseIdentityScimStatusAction(input: unknown) {
	const { organizationId } = await requireEnterpriseOrgAdmin();
	const connectionId = parseConnectionId(input);
	try {
		const result = await controlPlane.get({ organizationId, connectionId });
		assertCurrentOrganizationConnection(result.connection, organizationId);
		return result;
	} catch {
		return connectionNotFound();
	}
}

export async function reconcileEnterpriseIdentityScimCreationAction(
	input: unknown,
) {
	const { authContext, organizationId } = await requireEnterpriseOrgAdmin();
	const parsed = createConnectionSchema.safeParse(input);
	if (!parsed.success) throw new Error("Invalid SCIM connection input");
	await assertDefaultRoleTemplate(
		organizationId,
		parsed.data.defaultRoleTemplateId,
	);
	await getOrCreateEnterpriseIdentitySetupRecord(
		organizationId,
		authContext.user.id,
	);
	const adopted = await adoptActiveScimConnection({
		organizationId,
		actorId: authContext.user.id,
		policy: parsed.data,
	});
	if (adopted) {
		revalidatePath(IDENTITY_SETUP_PATH);
		return { connection: adopted, status: "active" as const };
	}
	const result = await controlPlane.create({
		...parsed.data,
		organizationId,
		actorId: authContext.user.id,
		creationRequestId: randomUUID(),
	});
	if ("connection" in result && result.connection) {
		assertCurrentOrganizationConnection(result.connection, organizationId);
		await persistScimConnection({
			organizationId,
			actorId: authContext.user.id,
			policy: parsed.data,
			connection: result.connection,
		});
		revalidatePath(IDENTITY_SETUP_PATH);
		return { connection: result.connection, status: "active" as const };
	}
	revalidatePath(IDENTITY_SETUP_PATH);
	return { status: result.status };
}

export async function rotateEnterpriseIdentityScimCredentialAction(
	input: unknown,
) {
	const { authContext, organizationId } = await requireEnterpriseOrgAdmin();
	const connectionId = parseConnectionId(input);
	try {
		const result = await controlPlane.rotate({
			organizationId,
			connectionId,
			actorId: authContext.user.id,
		});
		assertCurrentOrganizationConnection(result.connection, organizationId);
		revalidatePath(IDENTITY_SETUP_PATH);
		return result;
	} catch {
		return connectionNotFound();
	}
}

export async function revokeEnterpriseIdentityScimCredentialAction(
	connectionInput: unknown,
	credentialInput: unknown,
) {
	const { authContext, organizationId } = await requireEnterpriseOrgAdmin();
	const connectionId = parseConnectionId(connectionInput);
	const credentialId = parseConnectionId(credentialInput);
	try {
		await controlPlane.revoke({
			organizationId,
			connectionId,
			credentialId,
			actorId: authContext.user.id,
		});
		revalidatePath(IDENTITY_SETUP_PATH);
	} catch {
		return connectionNotFound();
	}
}

export async function listEnterpriseIdentityScimEventsAction(input: unknown) {
	const { organizationId } = await requireEnterpriseOrgAdmin();
	const connectionId = parseConnectionId(input);
	try {
		return await controlPlane.listEvents({ organizationId, connectionId });
	} catch {
		return connectionNotFound();
	}
}

export async function decommissionEnterpriseIdentityScimConnectionAction(
	input: unknown,
) {
	const { authContext, organizationId } = await requireEnterpriseOrgAdmin();
	const connectionId = parseConnectionId(input);
	try {
		const result = await decommissionSCIMConnection({
			database: db,
			store: createSCIMDecommissionStore(db),
			auth,
			organizationId,
			connectionId,
			actorId: authContext.user.id,
		});
		if (result === "skipped") return connectionNotFound();
		revalidatePath(IDENTITY_SETUP_PATH);
		return result;
	} catch {
		return connectionNotFound();
	}
}
