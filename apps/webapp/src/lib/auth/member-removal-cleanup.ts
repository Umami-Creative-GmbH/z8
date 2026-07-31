import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { reconcileBillingSeatsForOrganization } from "@/lib/billing/seat-sync-trigger";
import { secondaryStorage } from "@/lib/redis";
import { acquireEmployeeIdentityLock } from "./employee-identity-lock";
import { normalizeInvitationEmail } from "./employee-invitation-draft";
import { deleteOrganizationActiveSessionRows } from "./organization-session-revocation";

type MemberRemovalDb = Pick<typeof db, "transaction">;
type MemberRemovalTransaction = Parameters<
	Parameters<typeof db.transaction>[0]
>[0];

export type RemovedMemberAccessOutcome = {
	accessRestored: boolean;
	sessionTokens: string[];
};

const memberAccessRevocationDependencies = {
	db,
	deleteSecondarySession: (token: string) =>
		secondaryStorage.deleteOrThrow(token),
};

export async function revokeRemovedMemberAccess(
	userId: string,
	organizationId: string,
	dependencies: {
		db: MemberRemovalDb;
		deleteSecondarySession: (token: string) => Promise<void>;
	} = memberAccessRevocationDependencies,
) {
	const outcome = await dependencies.db.transaction((tx) =>
		revokeRemovedMemberAccessInTransaction(tx, userId, organizationId),
	);

	await Promise.all(
		outcome.sessionTokens.map((token) =>
			dependencies.deleteSecondarySession(token),
		),
	);
	return { accessRestored: outcome.accessRestored };
}

export async function revokeRemovedMemberAccessInTransaction(
	dbClient: MemberRemovalTransaction,
	userId: string,
	organizationId: string,
): Promise<RemovedMemberAccessOutcome> {
	const targetUser = await dbClient.query.user.findFirst({
		where: eq(authSchema.user.id, userId),
		columns: { email: true },
	});
	if (!targetUser) throw new Error("Member cleanup user not found");

	// All membership writers take this identity lock before checking replacement access.
	await acquireEmployeeIdentityLock(dbClient, {
		organizationId,
		normalizedEmail: normalizeInvitationEmail(targetUser.email),
	});

	const replacementMembership = await dbClient.query.member.findFirst({
		where: and(
			eq(authSchema.member.userId, userId),
			eq(authSchema.member.organizationId, organizationId),
			eq(authSchema.member.status, "approved"),
		),
		columns: { id: true },
	});
	if (replacementMembership) {
		return { accessRestored: true, sessionTokens: [] };
	}

	const sessionTokens = await deleteOrganizationActiveSessionRows(
		userId,
		organizationId,
		dbClient,
	);
	await dbClient
		.update(employee)
		.set({ isActive: false })
		.where(
			and(
				eq(employee.userId, userId),
				eq(employee.organizationId, organizationId),
			),
		);

	return { accessRestored: false, sessionTokens };
}

const postRemovalCleanupDependencies = {
	db,
	deleteSecondarySession: (token: string) =>
		secondaryStorage.deleteOrThrow(token),
	reconcileBillingSeatsForOrganization,
};

export async function completeRemovedMemberCleanupPostCommit(
	input: {
		organizationId: string;
		sessionTokens: string[];
	},
	dependencies: {
		deleteSecondarySession: (token: string) => Promise<void>;
		reconcileBillingSeatsForOrganization: typeof reconcileBillingSeatsForOrganization;
	} = postRemovalCleanupDependencies,
) {
	await Promise.all(
		input.sessionTokens.map((token) =>
			dependencies.deleteSecondarySession(token),
		),
	);
	await dependencies.reconcileBillingSeatsForOrganization(
		input.organizationId,
		{ strict: true },
	);
}

export async function completeRemovedMemberCleanup(
	input: {
		organizationId: string;
		userId: string;
	},
	dependencies: {
		revokeRemovedMemberAccess?: typeof revokeRemovedMemberAccess;
		db?: MemberRemovalDb;
		deleteSecondarySession?: (token: string) => Promise<void>;
		reconcileBillingSeatsForOrganization: typeof reconcileBillingSeatsForOrganization;
	} = postRemovalCleanupDependencies,
) {
	if (dependencies.revokeRemovedMemberAccess) {
		await dependencies.revokeRemovedMemberAccess(
			input.userId,
			input.organizationId,
		);
		await dependencies.reconcileBillingSeatsForOrganization(
			input.organizationId,
			{ strict: true },
		);
		return;
	}

	if (!dependencies.db || !dependencies.deleteSecondarySession) {
		throw new Error("Member cleanup dependencies are incomplete");
	}
	const outcome = await dependencies.db.transaction((tx) =>
		revokeRemovedMemberAccessInTransaction(
			tx,
			input.userId,
			input.organizationId,
		),
	);
	await completeRemovedMemberCleanupPostCommit(
		{
			organizationId: input.organizationId,
			sessionTokens: outcome.sessionTokens,
		},
		{
			deleteSecondarySession: dependencies.deleteSecondarySession,
			reconcileBillingSeatsForOrganization:
				dependencies.reconcileBillingSeatsForOrganization,
		},
	);
}
