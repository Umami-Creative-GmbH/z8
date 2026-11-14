/**
 * Better Auth's two membership hooks that join (spec #1664, #1666): an
 * accepted email invitation and a member added directly, which includes the
 * owner of a newly created organization. Each runs on the auth transaction
 * that writes the membership, so a failed joining rolls the membership back,
 * and hands back the step to run once that transaction committed.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@/db/auth-schema";
import {
	joinOrganization,
	runAfterJoiningCommitted,
	teamOfOrganization,
} from "@/lib/employee-lifecycle/joining";
import type { AuthTransaction } from "./auth-transaction";
import {
	normalizeInvitationEmail,
	resolveAcceptedInvitationCanCreateOrganizations,
} from "./employee-invitation-draft";

const targetTeamIdSchema = z.uuid();

/** Runs once the auth transaction committed. */
export type AfterAuthCommit = () => Promise<void>;

type MembershipHookData = {
	member: { id: string; role: string };
	user: { id: string };
};

type AcceptedInvitationData = MembershipHookData & {
	invitation: { id: string; organizationId: string; email: string };
};

type AddedMemberData = MembershipHookData & {
	organization: { id: string };
};

type InvitationTargetTeamLookupDb = Pick<AuthTransaction, "query">;

/**
 * The invitation's team when it is a team of the invitation's organization.
 * A stored id that is not a UUID never reaches the team lookup.
 */
export async function resolveInvitationTargetTeamId(
	dbClient: InvitationTargetTeamLookupDb,
	organizationId: string,
	targetTeamId: string | null | undefined,
) {
	const parsed = targetTeamId ? targetTeamIdSchema.safeParse(targetTeamId) : null;
	return parsed?.success ? teamOfOrganization(dbClient, organizationId, parsed.data) : null;
}

/**
 * An accepted email invitation: the joining and the invitation's
 * organization-creation right, both in the acceptance's transaction. The user
 * row is written after joining took its locks, so the order stays the user
 * guard, then the identity lock, then rows (#318).
 */
export async function joinOnAcceptedInvitation(
	tx: AuthTransaction,
	{ user, invitation, member }: AcceptedInvitationData,
): Promise<AfterAuthCommit> {
	// The custom invitation fields Better Auth does not hand to the hook.
	const invitationRecord = await tx.query.invitation.findFirst({
		where: and(
			eq(schema.invitation.id, invitation.id),
			eq(schema.invitation.organizationId, invitation.organizationId),
		),
	});
	const targetTeamId = await resolveInvitationTargetTeamId(
		tx,
		invitation.organizationId,
		invitationRecord?.targetTeamId,
	);

	const joined = await joinOrganization(tx, {
		organizationId: invitation.organizationId,
		userId: user.id,
		membership: { id: member.id, role: member.role },
		teamId: targetTeamId,
		invitation: { id: invitation.id },
		// The admin who sent the invitation learns when it brought back a former
		// employee who needs a rehire (#1672); without an inviter, the admins do.
		rehireNotice: invitationRecord?.inviterId
			? { to: "users", userIds: [invitationRecord.inviterId] }
			: { to: "organization_admins" },
	});

	const canCreateOrganizations = await resolveAcceptedInvitationCanCreateOrganizations(tx, {
		organizationId: invitation.organizationId,
		normalizedEmail: normalizeInvitationEmail(invitation.email),
		invitationCanCreateOrganizations: invitationRecord?.canCreateOrganizations ?? false,
	});
	await tx
		.update(schema.user)
		.set({ canCreateOrganizations, invitedVia: invitation.id })
		.where(eq(schema.user.id, user.id));

	return () =>
		runAfterJoiningCommitted(joined.afterCommit, {
			organizationId: invitation.organizationId,
			userId: user.id,
			path: "an invitation acceptance",
		});
}

/**
 * A member added directly, including the owner of a new organization. A
 * direct add carries no invitation: its draft is found by the user's email.
 */
export async function joinOnAddedMember(
	tx: AuthTransaction,
	{ member, user, organization }: AddedMemberData,
): Promise<AfterAuthCommit> {
	const joined = await joinOrganization(tx, {
		organizationId: organization.id,
		userId: user.id,
		membership: { id: member.id, role: member.role },
		invitation: { id: null },
		// The hook does not name who added the member: the admins learn of a
		// former employee who needs a rehire (#1672).
		rehireNotice: { to: "organization_admins" },
	});
	return () =>
		runAfterJoiningCommitted(joined.afterCommit, {
			organizationId: organization.id,
			userId: user.id,
			path: "a member add",
		});
}
