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
import { team } from "@/db/schema";
import { joinOrganization } from "@/lib/employee-lifecycle/joining";
import { createLogger } from "@/lib/logger";
import type { AuthTransaction } from "./auth-transaction";
import {
	normalizeInvitationEmail,
	resolveAcceptedInvitationCanCreateOrganizations,
} from "./employee-invitation-draft";

const logger = createLogger("OrganizationJoiningHooks");
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

/** The invitation's team when it is a team of the invitation's organization. */
export async function resolveInvitationTargetTeamId(
	dbClient: InvitationTargetTeamLookupDb,
	organizationId: string,
	targetTeamId: string | null | undefined,
) {
	const targetTeamIdResult = targetTeamId ? targetTeamIdSchema.safeParse(targetTeamId) : null;
	if (!targetTeamIdResult?.success) {
		return null;
	}

	const targetTeam = await dbClient.query.team.findFirst({
		where: and(eq(team.id, targetTeamIdResult.data), eq(team.organizationId, organizationId)),
	});

	return targetTeam?.id ?? null;
}

/**
 * The membership already committed when this runs: a failure here is logged,
 * never turned into a refusal of the change. The hourly seat reconciliation
 * and the draft clean-up's later passes are the safety nets.
 */
function afterJoiningCommitted(
	run: () => Promise<void>,
	context: { organizationId: string; userId: string },
): AfterAuthCommit {
	return async () => {
		try {
			await run();
		} catch (error) {
			logger.error({ error, ...context }, "Joining's after-commit step failed");
		}
	};
}

/**
 * An accepted email invitation: the invitation's organization-creation right
 * and the joining, both in the acceptance's transaction.
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
	const canCreateOrganizations = await resolveAcceptedInvitationCanCreateOrganizations(tx, {
		organizationId: invitation.organizationId,
		normalizedEmail: normalizeInvitationEmail(invitation.email),
		invitationCanCreateOrganizations: invitationRecord?.canCreateOrganizations ?? false,
	});

	await tx
		.update(schema.user)
		.set({ canCreateOrganizations, invitedVia: invitation.id })
		.where(eq(schema.user.id, user.id));

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
	return afterJoiningCommitted(() => joined.afterCommit.run(), {
		organizationId: invitation.organizationId,
		userId: user.id,
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
	return afterJoiningCommitted(() => joined.afterCommit.run(), {
		organizationId: organization.id,
		userId: user.id,
	});
}
