import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { protectAuthorizationMutation } from "@/lib/authorization/authorization-mutation";
import { reconcileBillingSeatsForOrganization } from "@/lib/billing/seat-sync-trigger";
import { recordFollowUpDeactivation } from "@/lib/employee-lifecycle/deactivation/follow-up-record";
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
	options: { actorUserId?: string } = {},
) {
	const outcome = await dependencies.db.transaction((tx) =>
		revokeRemovedMemberAccessInTransaction(tx, userId, organizationId, options),
	);

	await Promise.all(
		outcome.sessionTokens.map((token) =>
			dependencies.deleteSecondarySession(token),
		),
	);
	return { accessRestored: outcome.accessRestored };
}

/**
 * Deactivates a removed member's employee and deletes their organization
 * session rows. The user's exclusive configuration/access guard comes first
 * (#314), ahead of the identity lock; inside the removal transaction the
 * removal's before-hook already holds it.
 */
export async function revokeRemovedMemberAccessInTransaction(
	dbClient: MemberRemovalTransaction,
	userId: string,
	organizationId: string,
	options: {
		/** Who removed the member, when known (an admin's removal or rejection). */
		actorUserId?: string;
	} = {},
): Promise<RemovedMemberAccessOutcome> {
	await protectAuthorizationMutation(dbClient, {
		organizationId,
		userIds: [userId],
	});
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
	const deactivated = await dbClient
		.update(employee)
		.set({ isActive: false })
		.where(
			and(
				eq(employee.userId, userId),
				eq(employee.organizationId, organizationId),
			),
		)
		.returning({ id: employee.id });

	// Member removal is a deactivation (#1629, Organization ADR 0011): when this
	// removal switched the employee off, a pending deactivation at that moment
	// waits for the follow-up, which applies it in the deactivation's locks and
	// ends what they hold, their deputy duties too (#1014). It is audited under
	// the removing admin; only without a known one, under the removed member's
	// own user. A person re-added before it runs keeps everything.
	if (deactivated[0]) {
		await recordFollowUpDeactivation(dbClient, {
			organizationId,
			employeeId: deactivated[0].id,
			createdBy: options.actorUserId ?? userId,
			reason: "member_removed",
		});
	}

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
		/** The admin removing the member, for the audit of its side effects. */
		actorUserId?: string;
	},
	dependencies: {
		revokeRemovedMemberAccess?: typeof revokeRemovedMemberAccess;
		db?: MemberRemovalDb;
		deleteSecondarySession?: (token: string) => Promise<void>;
		reconcileBillingSeatsForOrganization: typeof reconcileBillingSeatsForOrganization;
	} = postRemovalCleanupDependencies,
) {
	if (dependencies.revokeRemovedMemberAccess) {
		await (input.actorUserId
			? dependencies.revokeRemovedMemberAccess(input.userId, input.organizationId, undefined, {
					actorUserId: input.actorUserId,
				})
			: dependencies.revokeRemovedMemberAccess(input.userId, input.organizationId));
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
		revokeRemovedMemberAccessInTransaction(tx, input.userId, input.organizationId, {
			actorUserId: input.actorUserId,
		}),
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
