import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { AuditAction } from "@/lib/audit-logger";
import { withAuditTrail } from "@/lib/audit-trail";
import type { StoredContractorCompensation } from "@/lib/contractor-compensation/kinds";
import { compensationInputOfStored } from "@/lib/contractor-compensation/terms";
import type { Clock } from "@/lib/datetime/temporal-core";
import { systemClock } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { currentOrganizationAdminUserIds } from "@/lib/notifications/manager-notice-recipients";
import { notifyInvitationContractorTermsNeedReview } from "@/lib/notifications/invitation-contractor-terms-need-review";

const logger = createLogger("joining");

/** The first compensation terms a contractor invitation carries (#1935). */
export type InvitationContractorTerms = {
	organizationId: string;
	employeeId: string;
	/** The contractor's user. */
	userId: string;
	/** As the invitation stored them, parsed when it was sent. */
	compensation: StoredContractorCompensation;
	/** The invitation draft's id: one notice per draft. */
	draftId: string;
	invitationId: string | null;
	/** The admin who prepared the invitation (`updatedBy`); null when nobody can be named. */
	actorUserId: string | null;
};

/** Why the terms were not written: a store refusal, a failure, or no admin to act as. */
type NotApplied = { reason: "no_admin_actor" } | { reason: "refused"; refusal: string };

/**
 * Writes a contractor invitation's terms as the first terms of the contractor's
 * new engagement, from its start, acting as the admin who prepared the
 * invitation (like the contracting details and projects joining applies),
 * once the joining committed. Terms are never dropped silently: when they
 * cannot be written (the engagement already has terms, it is no contractor
 * engagement, no admin can be named, or the write fails) an audit entry
 * records it and the organization's admins get a notice to set the rate by
 * hand. Never throws.
 */
export async function applyInvitationContractorTerms(
	terms: InvitationContractorTerms,
	clock: Clock = systemClock,
): Promise<void> {
	let notApplied: NotApplied | null = null;
	try {
		notApplied = await apply(terms, clock);
	} catch (error) {
		logger.error(
			{ error, organizationId: terms.organizationId, employeeId: terms.employeeId },
			"Could not write the compensation terms of a contractor invitation",
		);
		notApplied = { reason: "refused", refusal: "unexpected_error" };
	}
	if (notApplied) await reportNotApplied(terms, notApplied);
}

async function apply(terms: InvitationContractorTerms, clock: Clock): Promise<NotApplied | null> {
	if (!terms.actorUserId) return { reason: "no_admin_actor" };
	const { setFirstContractorTerms } = await import("@/lib/contractor-compensation/store");
	const outcome = await setFirstContractorTerms(db, {
		organizationId: terms.organizationId,
		actorUserId: terms.actorUserId,
		employeeId: terms.employeeId,
		compensation: compensationInputOfStored(terms.compensation),
		now: clock.nowInstant(),
	});
	return outcome.ok ? null : { reason: "refused", refusal: outcome.reason };
}

/**
 * Best effort: the audit entry and the admins' notice never fail the step.
 * With no admin to name, the entry is a system finding standing on the
 * contractor's user, as the planned engagement end records it.
 */
async function reportNotApplied(terms: InvitationContractorTerms, notApplied: NotApplied) {
	try {
		await withAuditTrail((audit) =>
			audit.record(db, {
				organizationId: terms.organizationId,
				action: AuditAction.EMPLOYEE_INVITATION_CONTRACTOR_TERMS_NOT_APPLIED,
				actorUserId: terms.actorUserId ?? terms.userId,
				targetType: "employee",
				targetId: terms.employeeId,
				employeeId: terms.employeeId,
				metadata: {
					...(terms.actorUserId ? {} : { actorKind: "system" }),
					...notApplied,
					compensation: terms.compensation,
					draftId: terms.draftId,
					invitationId: terms.invitationId,
				},
			}),
		);
	} catch (error) {
		logger.error(
			{ error, organizationId: terms.organizationId, employeeId: terms.employeeId },
			"Could not record that a contractor invitation's terms were not applied",
		);
	}
	try {
		const recipientUserIds = await currentOrganizationAdminUserIds(db, {
			organizationId: terms.organizationId,
		});
		if (recipientUserIds.length === 0) return;
		const person = await db.query.user.findFirst({
			where: eq(user.id, terms.userId),
			columns: { name: true, email: true },
		});
		await notifyInvitationContractorTermsNeedReview({
			organizationId: terms.organizationId,
			employeeId: terms.employeeId,
			draftId: terms.draftId,
			name: person?.name || person?.email || terms.employeeId,
			recipientUserIds,
		});
	} catch (error) {
		logger.error(
			{ error, organizationId: terms.organizationId, employeeId: terms.employeeId },
			"Could not tell admins that a contractor invitation's terms need review",
		);
	}
}
