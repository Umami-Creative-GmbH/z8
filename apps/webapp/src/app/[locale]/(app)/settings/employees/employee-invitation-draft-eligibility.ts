import { and, eq, gt, notExists, sql } from "drizzle-orm";
import { invitation, user } from "@/db/auth-schema";
import { employee, employeeInvitationDraft } from "@/db/schema";

export function buildEligibleInvitationDraftPredicate({
	organizationId,
	now,
	draftId,
}: {
	organizationId: string;
	now: Date;
	draftId?: string;
}) {
	return and(
		eq(employeeInvitationDraft.invitationId, invitation.id),
		eq(employeeInvitationDraft.organizationId, organizationId),
		eq(invitation.organizationId, organizationId),
		eq(invitation.status, "pending"),
		gt(invitation.expiresAt, now),
		draftId ? eq(employeeInvitationDraft.id, draftId) : undefined,
		notExists(sql`(
			select 1
			from ${employee}
			inner join ${user} on ${employee.userId} = ${user.id}
			where ${employee.organizationId} = ${organizationId}
			and lower(btrim(${user.email})) = ${employeeInvitationDraft.normalizedEmail}
		)`),
	);
}
