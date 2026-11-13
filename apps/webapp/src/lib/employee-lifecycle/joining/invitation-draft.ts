import { and, eq, exists, lte, or, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { invitation, user } from "@/db/auth-schema";
import { employee, employeeInvitationDraft, team } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import type { AuditTrail } from "@/lib/audit-trail";
import { dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import { ValidationError } from "@/lib/effect/errors";
import { writeFirstEmploymentTerms } from "@/lib/employment-history/first-terms";
import { createLogger } from "@/lib/logger";
import {
	findPersonnelNumberHolder,
	isPersonnelNumberConflict,
} from "@/lib/organization/personnel-number-uniqueness";
import { hourlyWageSchema } from "@/lib/validations/employment-history";

export type JoiningDatabase = typeof appDb;
/** The transaction that approves the membership; joining opens none of its own. */
export type JoiningTransaction = Parameters<Parameters<JoiningDatabase["transaction"]>[0]>[0];
type JoiningClient = JoiningDatabase | JoiningTransaction;

export type InvitationDraft = typeof employeeInvitationDraft.$inferSelect;

/** The draft clean-up that runs after the joining transaction committed. */
export type DraftCleanup = {
	organizationId: string;
	/** Absent: every consumable draft of the organization. */
	draftId?: string;
	/** A draft found by email may belong to a replacement invitation that went stale. */
	allowStaleLinkedInvitation?: boolean;
};

const logger = createLogger("joining");

/**
 * The draft for the invitation the membership comes from: the invitation's own
 * draft, else the organization's draft for the user's email (a replacement
 * invitation or a direct member add carries none of its own).
 */
export async function loadInvitationDraft(
	client: JoiningClient,
	input: { organizationId: string; invitationId: string | null; normalizedEmail: string },
): Promise<{ draft: InvitationDraft; identityFallback: boolean } | null> {
	const exactDraft = input.invitationId
		? await client.query.employeeInvitationDraft.findFirst({
				where: and(
					eq(employeeInvitationDraft.organizationId, input.organizationId),
					eq(employeeInvitationDraft.invitationId, input.invitationId),
				),
			})
		: null;
	if (exactDraft) return { draft: exactDraft, identityFallback: false };

	const identityDraft = await client.query.employeeInvitationDraft.findFirst({
		where: and(
			eq(employeeInvitationDraft.organizationId, input.organizationId),
			eq(employeeInvitationDraft.normalizedEmail, input.normalizedEmail),
		),
	});
	return identityDraft ? { draft: identityDraft, identityFallback: true } : null;
}

/** The team, when it belongs to this organization; only such a team places the employee. */
export async function teamOfOrganization(
	client: JoiningClient,
	organizationId: string,
	teamId: string | null | undefined,
): Promise<string | null> {
	if (!teamId) return null;
	const targetTeam = await client.query.team.findFirst({
		where: and(eq(team.id, teamId), eq(team.organizationId, organizationId)),
		columns: { id: true },
	});
	return targetTeam?.id ?? null;
}

/**
 * The employee values a draft gives a new employee. The personnel number is
 * left out: `writeWithDraftPersonnelNumber` adds it only while it is free. So is
 * the team: `placeArrivingEmployee` places the employee in it (Organization ADR 0010).
 */
export function draftCreationValues(draft: InvitationDraft | null) {
	if (!draft) return {};
	return {
		role: draft.role,
		firstName: draft.firstName,
		lastName: draft.lastName,
		gender: draft.gender,
		pronouns: draft.pronouns,
		birthday: draft.birthday,
		position: draft.position,
		startDate: draft.startDate,
		endDate: draft.endDate,
		contractType: draft.contractType,
	};
}

/** Like `draftCreationValues`, for a reactivated employee: only what the draft sets. */
export function draftReactivationValues(draft: InvitationDraft | null) {
	if (!draft) return {};
	return {
		...(draft.role != null ? { role: draft.role } : {}),
		...(draft.firstName != null ? { firstName: draft.firstName } : {}),
		...(draft.lastName != null ? { lastName: draft.lastName } : {}),
		...(draft.gender != null ? { gender: draft.gender } : {}),
		...(draft.pronouns != null ? { pronouns: draft.pronouns } : {}),
		...(draft.birthday != null ? { birthday: draft.birthday } : {}),
		...(draft.position != null ? { position: draft.position } : {}),
		...(draft.startDate != null ? { startDate: draft.startDate } : {}),
		...(draft.endDate != null ? { endDate: draft.endDate } : {}),
		...(draft.contractType != null ? { contractType: draft.contractType } : {}),
	};
}

/** A draft personnel number joining did not copy because another employee held it. */
export type DroppedPersonnelNumber = {
	droppedPersonnelNumber: string;
	/** Null when the employee who won a concurrent save can no longer be found. */
	heldByEmployeeId: string | null;
	reason?: "personnel_number_managed_by_idp";
};

/**
 * Writes the new or reactivated employee with the draft's personnel number
 * (#1197) when it is free, and without it when another employee of the
 * organization holds it, so joining never fails because of the number. A
 * concurrent save that takes the number first hits the unique index inside a
 * savepoint, and the write is repeated without the number.
 */
export async function writeWithDraftPersonnelNumber<T>(
	tx: JoiningTransaction,
	input: {
		organizationId: string;
		/** The draft's number, normalized; null writes none. */
		personnelNumber: string | null;
		/** The reactivated employee, whose own number is no clash. */
		exceptEmployeeId?: string;
		personnelNumberManagedByScim?: boolean;
	},
	write: (
		client: JoiningTransaction,
		personnelNumber: { employeeNumber: string } | Record<string, never>,
	) => Promise<T>,
): Promise<{ written: T; dropped: DroppedPersonnelNumber | null }> {
	const { personnelNumber } = input;
	if (personnelNumber === null) return { written: await write(tx, {}), dropped: null };
	const scope = {
		organizationId: input.organizationId,
		personnelNumber,
		exceptEmployeeId: input.exceptEmployeeId,
	};
	const dropWith = async (heldByEmployeeId: string | null) => ({
		written: await write(tx, {}),
		dropped: { droppedPersonnelNumber: personnelNumber, heldByEmployeeId },
	});

	if (input.personnelNumberManagedByScim) {
		return {
			written: await write(tx, {}),
			dropped: {
				droppedPersonnelNumber: personnelNumber,
				heldByEmployeeId: null,
				reason: "personnel_number_managed_by_idp",
			},
		};
	}
	const holder = await findPersonnelNumberHolder(tx, scope);
	if (holder) return dropWith(holder.employeeId);
	try {
		const written = await tx.transaction((savepoint) =>
			write(savepoint, { employeeNumber: personnelNumber }),
		);
		return { written, dropped: null };
	} catch (error) {
		if (!isPersonnelNumberConflict(error)) throw error;
		const winner = await findPersonnelNumberHolder(tx, scope);
		return dropWith(winner?.employeeId ?? null);
	}
}

/** The audit entry of a draft personnel number joining dropped (#1197). */
export function recordDroppedPersonnelNumber(
	tx: JoiningTransaction,
	audit: AuditTrail,
	input: {
		organizationId: string;
		userId: string;
		employee: { id: string; employeeNumber: string | null };
		draft: InvitationDraft;
		dropped: DroppedPersonnelNumber;
		outcome: "created" | "reactivated";
	},
) {
	return audit.record(tx, {
		organizationId: input.organizationId,
		action: AuditAction.EMPLOYEE_PERSONNEL_NUMBER_DROPPED,
		// The joining user's acceptance dropped the number.
		actorUserId: input.userId,
		targetType: "employee",
		targetId: input.employee.id,
		employeeId: input.employee.id,
		metadata: {
			...input.dropped,
			reason: input.dropped.reason ?? "personnel_number_taken",
			outcome: input.outcome,
			invitationId: input.draft.invitationId,
			draftId: input.draft.id,
			...(input.outcome === "reactivated"
				? { keptPersonnelNumber: input.employee.employeeNumber }
				: {}),
		},
	});
}

/**
 * A former employee who stays off the current roster gets nothing of the draft
 * (spec #1664 decision 4): the entry says so, and the draft is discarded after commit.
 */
export function recordDraftNotApplied(
	tx: JoiningTransaction,
	audit: AuditTrail,
	input: {
		organizationId: string;
		actorUserId: string;
		employeeId: string;
		draft: InvitationDraft;
	},
) {
	return audit.record(tx, {
		organizationId: input.organizationId,
		action: AuditAction.EMPLOYEE_INVITATION_DRAFT_NOT_APPLIED,
		actorUserId: input.actorUserId,
		targetType: "employee_invitation_draft",
		targetId: input.draft.id,
		employeeId: input.employeeId,
		metadata: {
			reason: "former_employee_needs_rehire",
			invitationId: input.draft.invitationId,
			draftId: input.draft.id,
		},
	});
}

/**
 * The draft's contract becomes the employee's first employment terms, in the
 * joining transaction: when the terms cannot be written, nobody joins. Only
 * hourly drafts with a wage get terms.
 */
export function writeDraftFirstTerms(
	tx: JoiningTransaction,
	input: { organizationId: string; userId: string; employeeId: string; draft: InvitationDraft },
) {
	const { draft } = input;
	return writeFirstEmploymentTerms(tx, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		// The org admin who prepared the draft set the wage.
		actorUserId: draft.updatedBy ?? input.userId,
		contractType: draft.contractType,
		hourlyRate: draftHourlyWage(draft.currentHourlyRate),
		startDate: draft.startDate ?? null,
	});
}

/** The draft's stored decimal-string wage, as employment terms hold it. */
function draftHourlyWage(stored: string | null): number | null {
	if (stored == null) return null;
	const parsed = hourlyWageSchema.safeParse(stored);
	if (!parsed.success) {
		throw new ValidationError({
			message: parsed.error.issues[0]?.message ?? "Invalid hourly rate",
			field: "hourlyRate",
		});
	}
	return parsed.data;
}

/**
 * Deletes consumed drafts: a draft whose invitation was accepted (or, for a
 * draft found by email, went stale) once the organization has an employee
 * for its email. Best effort after commit; a failure is logged.
 */
export async function consumeInvitationDrafts(client: JoiningClient, input: DraftCleanup) {
	try {
		const staleBoundary = dateFromInstant(systemClock.nowInstant());
		const linkedInvitationStatus = input.allowStaleLinkedInvitation
			? or(
					eq(invitation.status, "accepted"),
					eq(invitation.status, "canceled"),
					and(eq(invitation.status, "pending"), lte(invitation.expiresAt, staleBoundary)),
				)
			: eq(invitation.status, "accepted");
		await client.delete(employeeInvitationDraft).where(
			and(
				eq(employeeInvitationDraft.organizationId, input.organizationId),
				input.draftId ? eq(employeeInvitationDraft.id, input.draftId) : undefined,
				// Drizzle renders a raw `sql` argument to exists() without parentheses,
				// so each subquery carries its own; `exists select` is a syntax error (#1185).
				exists(sql`(
						select 1
						from ${invitation}
						where ${invitation.id} = ${employeeInvitationDraft.invitationId}
						and ${invitation.organizationId} = ${input.organizationId}
						and ${linkedInvitationStatus}
					)`),
				exists(sql`(
						select 1
						from ${employee}
						inner join ${user} on ${employee.userId} = ${user.id}
						where ${employee.organizationId} = ${input.organizationId}
						and lower(btrim(${user.email})) = ${employeeInvitationDraft.normalizedEmail}
					)`),
			),
		);
	} catch {
		logger.warn(
			{
				operation: "consumeInvitationDrafts",
				organizationId: input.organizationId,
				draftId: input.draftId ?? null,
			},
			"Employee invitation draft cleanup failed",
		);
	}
}
