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
	const outcome = await dependencies.db.transaction(async (tx) => {
		const targetUser = await tx.query.user.findFirst({
			where: eq(authSchema.user.id, userId),
			columns: { email: true },
		});
		if (!targetUser) throw new Error("Member cleanup user not found");

		await acquireEmployeeIdentityLock(tx, {
			organizationId,
			normalizedEmail: normalizeInvitationEmail(targetUser.email),
		});

		const replacementMembership = await tx.query.member.findFirst({
			where: and(
				eq(authSchema.member.userId, userId),
				eq(authSchema.member.organizationId, organizationId),
				eq(authSchema.member.status, "approved"),
			),
			columns: { id: true },
		});
		if (replacementMembership) {
			return { accessRestored: true as const, sessionTokens: [] };
		}

		const sessionTokens = await deleteOrganizationActiveSessionRows(
			userId,
			organizationId,
			tx,
		);
		await tx
			.update(employee)
			.set({ isActive: false })
			.where(
				and(
					eq(employee.userId, userId),
					eq(employee.organizationId, organizationId),
				),
			);

		return { accessRestored: false as const, sessionTokens };
	});

	await Promise.all(
		outcome.sessionTokens.map((token) =>
			dependencies.deleteSecondarySession(token),
		),
	);
	return { accessRestored: outcome.accessRestored };
}

const postRemovalCleanupDependencies = {
	revokeRemovedMemberAccess,
	reconcileBillingSeatsForOrganization,
};

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
	} else {
		if (!dependencies.db || !dependencies.deleteSecondarySession) {
			throw new Error("Member cleanup dependencies are incomplete");
		}
		await revokeRemovedMemberAccess(input.userId, input.organizationId, {
			db: dependencies.db,
			deleteSecondarySession: dependencies.deleteSecondarySession,
		});
	}
	await dependencies.reconcileBillingSeatsForOrganization(
		input.organizationId,
		{
			strict: true,
		},
	);
}
