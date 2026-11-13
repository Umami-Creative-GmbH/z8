import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { employee, teamPermissions } from "@/db/schema";
import { acquireEmployeeIdentityLock } from "@/lib/auth/employee-identity-lock";
import { normalizeInvitationEmail } from "@/lib/auth/employee-invitation-draft";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import { AuditTrail } from "@/lib/audit-trail";
import { syncBillingSeatsAfterMemberChange } from "@/lib/billing/seat-sync-trigger";
import { systemClock } from "@/lib/datetime/temporal-core";
import { normalizePersonnelNumber } from "@/lib/organization/personnel-number";
import { placeArrivingEmployee } from "@/lib/organization/team-placement/team-placement";
import { acquireExclusiveUserConfigurationAccessGuards } from "@/lib/time-tracking/work-transaction";
import { onCurrentRoster } from "../current-roster";
import { reactivateOnReturn } from "../reactivation";
import {
	consumeInvitationDrafts,
	type DraftCleanup,
	draftCreationValues,
	draftReactivationValues,
	type InvitationDraft,
	type JoiningTransaction,
	loadInvitationDraft,
	recordDraftNotApplied,
	recordDroppedPersonnelNumber,
	teamOfOrganization,
	writeDraftFirstTerms,
	writeWithDraftPersonnelNumber,
} from "./invitation-draft";

export type { JoiningTransaction } from "./invitation-draft";

type Employee = typeof employee.$inferSelect;

/** A role as Better Auth stores it on the membership. */
export type MembershipRole = string | string[] | null | undefined;

export type JoiningInput = {
	organizationId: string;
	userId: string;
	/** The approved membership the user now holds. */
	membership: { id: string; role: MembershipRole };
	/** The team to place a new employee in when no invitation draft names one. */
	teamId?: string | null;
	/**
	 * The invitation the membership comes from, for its draft. Without an id
	 * (a direct member add) the draft is found by the user's email. Absent: no draft.
	 */
	invitation?: { id: string | null };
	/** Who brought a former employee back; defaults to the joining user. */
	actorUserId?: string;
};

/**
 * What joining did (Organization glossary, **Joining**):
 * - `joined`: a new employee;
 * - `reactivated`: an employee who was off is on the current roster again;
 * - `already_current`: the employee was on the current roster, nothing changed;
 * - `membership_only`: a former employee whose departure took effect; only a rehire brings them back.
 */
export type JoiningOutcome =
	| { kind: "joined"; employee: Employee }
	| { kind: "reactivated"; employee: Employee; reactivationRequestId: string | null }
	| { kind: "already_current"; employee: Employee }
	| { kind: "membership_only"; employee: Employee };

/** The seat signal of the new membership, sent after commit. */
export type SeatSignal = {
	organizationId: string;
	memberId: string;
	userId: string;
	change: "added";
};

/**
 * The one step the caller runs once the joining transaction committed: audit
 * forwarding, the invitation draft clean-up and the seat signal.
 */
export type AfterJoining = {
	seatSignal: SeatSignal;
	draftCleanup: DraftCleanup | null;
	/** A repair of an older membership passes `seatSignal: false`: no seat changed now. */
	run(options?: { seatSignal?: boolean }): Promise<void>;
};

export type Joining = { outcome: JoiningOutcome; afterCommit: AfterJoining };

/**
 * Takes the joining locks in their order: the user's exclusive configuration
 * guard (#318), then the organization's identity lock for the user's email.
 * Both are transaction-scoped advisory locks and re-entrant, so a caller that
 * already holds them may call this again.
 */
export async function acquireJoiningLocks(
	tx: JoiningTransaction,
	input: { organizationId: string; userId: string },
): Promise<{ normalizedEmail: string }> {
	await acquireExclusiveUserConfigurationAccessGuards(tx, [input.userId]);
	const targetUser = await tx.query.user.findFirst({
		where: eq(user.id, input.userId),
		columns: { email: true },
	});
	if (!targetUser) throw new Error("Cannot join a missing user to an organization");
	const normalizedEmail = normalizeInvitationEmail(targetUser.email);
	await acquireEmployeeIdentityLock(tx, { organizationId: input.organizationId, normalizedEmail });
	return { normalizedEmail };
}

/**
 * Joining (spec #1664): what follows "this user now holds an approved
 * membership in this organization", in the caller's transaction, which it
 * never commits or opens. The user gets an employee, comes back to the
 * current roster through `reactivateOnReturn`, or, as a former employee whose
 * departure took effect, keeps only the membership. An employee already on the
 * current roster is left exactly as it is. The caller runs `afterCommit` once
 * its transaction committed.
 */
export async function joinOrganization(
	tx: JoiningTransaction,
	input: JoiningInput,
): Promise<Joining> {
	// Entries reach the external audit service only once the transaction committed.
	const audit = new AuditTrail();
	const { organizationId, userId } = input;
	const { normalizedEmail } = await acquireJoiningLocks(tx, input);

	const isAdminMembership =
		hasOrganizationRole(input.membership.role, "owner") ||
		hasOrganizationRole(input.membership.role, "admin");
	const loadedDraft = input.invitation
		? await loadInvitationDraft(tx, {
				organizationId,
				invitationId: input.invitation.id,
				normalizedEmail,
			})
		: null;
	const draft = loadedDraft?.draft ?? null;
	const context: JoiningContext = { tx, audit, input, draft, isAdminMembership };

	const existing = await tx.query.employee.findFirst({
		where: and(eq(employee.userId, userId), eq(employee.organizationId, organizationId)),
	});
	const outcome = !existing
		? await joinAsNewEmployee(context)
		: (await isOnCurrentRoster(tx, existing))
			? ({ kind: "already_current", employee: existing } as const)
			: await joinAsReturningEmployee(context, existing);

	const draftCleanup: DraftCleanup | null = draft
		? {
				organizationId,
				draftId: draft.id,
				allowStaleLinkedInvitation: loadedDraft?.identityFallback,
			}
		: null;
	const seatSignal: SeatSignal = {
		organizationId,
		memberId: input.membership.id,
		userId,
		change: "added",
	};
	return {
		outcome,
		afterCommit: {
			seatSignal,
			draftCleanup,
			async run(options = {}) {
				audit.forwardCommitted();
				if (draftCleanup) await consumeInvitationDrafts(db, draftCleanup);
				if (options.seatSignal !== false) await syncBillingSeatsAfterMemberChange(seatSignal);
			},
		},
	};
}

type JoiningContext = {
	tx: JoiningTransaction;
	audit: AuditTrail;
	input: JoiningInput;
	draft: InvitationDraft | null;
	isAdminMembership: boolean;
};

async function isOnCurrentRoster(tx: JoiningTransaction, existing: Employee): Promise<boolean> {
	const [current] = await tx
		.select({ id: employee.id })
		.from(employee)
		.where(
			and(
				eq(employee.id, existing.id),
				onCurrentRoster(existing.organizationId, employee, systemClock.nowInstant()),
			),
		);
	return current !== undefined;
}

async function joinAsNewEmployee(context: JoiningContext): Promise<JoiningOutcome> {
	const { tx, audit, input, draft, isAdminMembership } = context;
	const { organizationId, userId } = input;
	const {
		written: [created],
		dropped,
	} = await writeWithDraftPersonnelNumber(
		tx,
		{ organizationId, personnelNumber: normalizePersonnelNumber(draft?.employeeNumber) },
		(client, personnelNumber) =>
			client
				.insert(employee)
				.values({
					userId,
					organizationId,
					role: isAdminMembership ? "admin" : "employee",
					isActive: true,
					// With a draft, its role decides (spec #1664 decision 6).
					...draftCreationValues(draft),
					...personnelNumber,
				})
				.returning(),
	);
	if (!created) throw new Error("Joining did not create the employee");

	// The draft's team wins over the given one; only a team of this organization places.
	const teamId = await teamOfOrganization(
		tx,
		organizationId,
		draft ? draft.teamId : (input.teamId ?? null),
	);
	const placed = teamId
		? await placeArrivingEmployee(tx, { organizationId, employeeId: created.id, teamId })
		: null;
	if (draft && dropped) {
		await recordDroppedPersonnelNumber(tx, audit, {
			organizationId,
			userId,
			employee: created,
			draft,
			dropped,
			outcome: "created",
		});
	}
	if (draft) {
		await writeDraftFirstTerms(tx, { organizationId, userId, employeeId: created.id, draft });
	}
	if (isAdminMembership) await grantOrganizationWideTeamPermissions(tx, created);

	return {
		kind: "joined",
		employee: placed ? { ...created, teamId: placed.primaryTeamId } : created,
	};
}

async function joinAsReturningEmployee(
	context: JoiningContext,
	existing: Employee,
): Promise<JoiningOutcome> {
	const { tx, audit, input, draft, isAdminMembership } = context;
	const { organizationId, userId } = input;
	const actorUserId = input.actorUserId ?? userId;
	// Coming back after a deactivation is a reactivation by whoever brought
	// them back (#1628). Whether they are current afterwards decides the rest.
	const returned = await reactivateOnReturn(
		tx,
		{ organizationId, employeeId: existing.id, actorUserId },
		audit,
	);
	if (!returned.current) {
		// A departure took effect (migration 0073): only a rehire brings them back.
		if (draft) {
			await recordDraftNotApplied(tx, audit, {
				organizationId,
				actorUserId,
				employeeId: existing.id,
				draft,
			});
		}
		return { kind: "membership_only", employee: existing };
	}

	const isExisting = and(eq(employee.id, existing.id), eq(employee.organizationId, organizationId));
	const draftPersonnelNumber = normalizePersonnelNumber(draft?.employeeNumber);
	const returnValues = {
		...draftReactivationValues(draft),
		...(!draft && isAdminMembership ? { role: "admin" as const } : {}),
	};
	const {
		written: [reactivated],
		dropped,
	} = await writeWithDraftPersonnelNumber(
		tx,
		{
			organizationId,
			personnelNumber: draftPersonnelNumber,
			exceptEmployeeId: existing.id,
			personnelNumberManagedByScim:
				existing.personnelNumberManagedByScim && existing.employeeNumber !== draftPersonnelNumber,
		},
		async (client, personnelNumber) => {
			const values = { ...returnValues, ...personnelNumber };
			if (Object.keys(values).length > 0) {
				return client.update(employee).set(values).where(isExisting).returning();
			}
			// Nothing of the draft to write: the switched-on row as it is.
			return client.select().from(employee).where(isExisting);
		},
	);
	if (!reactivated) throw new Error("Joining lost the returning employee");

	// The draft's team is a move: its old primary team's membership ends.
	const teamId = draft ? await teamOfOrganization(tx, organizationId, draft.teamId) : null;
	const placed = teamId
		? await placeArrivingEmployee(tx, { organizationId, employeeId: reactivated.id, teamId })
		: null;
	const placedEmployee = placed ? { ...reactivated, teamId: placed.primaryTeamId } : reactivated;
	if (draft && dropped) {
		await recordDroppedPersonnelNumber(tx, audit, {
			organizationId,
			userId,
			employee: placedEmployee,
			draft,
			dropped,
			outcome: "reactivated",
		});
	}
	if (draft) {
		await writeDraftFirstTerms(tx, { organizationId, userId, employeeId: reactivated.id, draft });
	}
	if (isAdminMembership) await grantOrganizationWideTeamPermissions(tx, placedEmployee);

	return {
		kind: "reactivated",
		employee: placedEmployee,
		reactivationRequestId: returned.reactivationRequestId,
	};
}

/** The organization-wide team permission row of an owner or admin membership (spec #1664 decision 7). */
async function grantOrganizationWideTeamPermissions(
	tx: JoiningTransaction,
	joined: { id: string; organizationId: string },
) {
	const existing = await tx.query.teamPermissions.findFirst({
		where: and(
			eq(teamPermissions.employeeId, joined.id),
			eq(teamPermissions.organizationId, joined.organizationId),
			isNull(teamPermissions.teamId),
		),
		columns: { id: true },
	});
	if (existing) return;
	await tx.insert(teamPermissions).values({
		employeeId: joined.id,
		organizationId: joined.organizationId,
		teamId: null,
		canCreateTeams: true,
		canManageTeamMembers: true,
		canManageTeamSettings: true,
		canApproveTeamRequests: true,
		grantedBy: joined.id,
	});
}
