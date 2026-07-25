import { and, eq, gt, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { invitation, user } from "@/db/auth-schema";
import { employee, employeeInvitationDraft, team } from "@/db/schema";
import {
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { acquireEmployeeIdentityLock } from "./employee-identity-lock";

type InvitationDraftTransaction = Parameters<
	Parameters<typeof appDb.transaction>[0]
>[0];
type InvitationDraftClient = typeof appDb | InvitationDraftTransaction;

export function normalizeInvitationEmail(email: string): string {
	return email.trim().toLowerCase();
}

export async function attachInvitationToEmployeeDraft(
	dbClient: InvitationDraftClient,
	input: {
		organizationId: string;
		normalizedEmail: string;
		invitationId: string;
		canCreateOrganizations: boolean;
		initialTeamId: string | null;
		initialRole: "admin" | "employee";
		updatedBy: string;
	},
) {
	const drafts = await dbClient
		.insert(employeeInvitationDraft)
		.values({
			organizationId: input.organizationId,
			normalizedEmail: input.normalizedEmail,
			invitationId: input.invitationId,
			canCreateOrganizations: input.canCreateOrganizations,
			teamId: input.initialTeamId,
			role: input.initialRole,
			contractType: "fixed",
			updatedBy: input.updatedBy,
		})
		.onConflictDoUpdate({
			target: [
				employeeInvitationDraft.organizationId,
				employeeInvitationDraft.normalizedEmail,
			],
			set: {
				invitationId: input.invitationId,
				canCreateOrganizations: input.canCreateOrganizations,
			},
		})
		.returning();

	return drafts[0];
}

export async function persistEmployeeInvitationDraft(
	dbClient: typeof appDb,
	input: {
		organizationId: string;
		normalizedEmail: string;
		invitationId: string;
		canCreateOrganizations: boolean;
		targetTeamId: string | null;
		initialRole: "admin" | "employee";
		updatedBy: string;
	},
): Promise<{ outcome: "persisted" | "consumed" }> {
	return await dbClient.transaction(async (tx) => {
		await acquireEmployeeIdentityLock(tx, {
			organizationId: input.organizationId,
			normalizedEmail: input.normalizedEmail,
		});

		const authoritativeInvitation = await tx.query.invitation.findFirst({
			where: and(
				eq(invitation.id, input.invitationId),
				eq(invitation.organizationId, input.organizationId),
			),
		});
		if (
			!authoritativeInvitation ||
			normalizeInvitationEmail(authoritativeInvitation.email) !==
				input.normalizedEmail
		) {
			throw new Error("Invitation persistence conflict");
		}

		const [existingEmployee] = await tx
			.select({ id: employee.id })
			.from(employee)
			.innerJoin(user, eq(employee.userId, user.id))
			.where(
				and(
					eq(employee.organizationId, input.organizationId),
					sql`lower(btrim(${user.email})) = ${input.normalizedEmail}`,
				),
			)
			.limit(1);

		if (existingEmployee || authoritativeInvitation.status === "accepted") {
			return { outcome: "consumed" };
		}
		if (!isInvitationActionable(authoritativeInvitation)) {
			throw new Error("Invitation persistence conflict");
		}

		const persistenceNow = dateFromInstant(systemClock.nowInstant());
		const updatedInvitations = await tx
			.update(invitation)
			.set({
				canCreateOrganizations: input.canCreateOrganizations,
				targetTeamId: input.targetTeamId,
			})
			.where(
				and(
					eq(invitation.id, input.invitationId),
					eq(invitation.organizationId, input.organizationId),
					sql`lower(btrim(${invitation.email})) = ${input.normalizedEmail}`,
					eq(invitation.status, "pending"),
					gt(invitation.expiresAt, persistenceNow),
				),
			)
			.returning({ id: invitation.id });

		if (updatedInvitations.length === 0) {
			const currentInvitation = await tx.query.invitation.findFirst({
				where: and(
					eq(invitation.id, input.invitationId),
					eq(invitation.organizationId, input.organizationId),
				),
			});
			if (
				currentInvitation?.status === "accepted" &&
				normalizeInvitationEmail(currentInvitation.email) ===
					input.normalizedEmail
			) {
				return { outcome: "consumed" };
			}
			throw new Error("Invitation persistence conflict");
		}

		const draft = await attachInvitationToEmployeeDraft(tx, {
			organizationId: input.organizationId,
			normalizedEmail: input.normalizedEmail,
			invitationId: input.invitationId,
			canCreateOrganizations: input.canCreateOrganizations,
			initialTeamId: input.targetTeamId,
			initialRole: input.initialRole,
			updatedBy: input.updatedBy,
		});
		if (!draft) throw new Error("Invitation persistence conflict");

		return { outcome: "persisted" };
	});
}

export async function syncInvitationTargetTeam(
	dbClient: typeof appDb,
	input: {
		organizationId: string;
		invitationId: string;
		email: string;
		targetTeamId: string | null;
	},
) {
	const normalizedEmail = normalizeInvitationEmail(input.email);
	await dbClient.transaction(async (tx) => {
		await acquireEmployeeIdentityLock(tx, {
			organizationId: input.organizationId,
			normalizedEmail,
		});

		const [draft] = await tx
			.select({
				id: employeeInvitationDraft.id,
				invitationId: employeeInvitationDraft.invitationId,
			})
			.from(employeeInvitationDraft)
			.where(
				and(
					eq(employeeInvitationDraft.organizationId, input.organizationId),
					eq(employeeInvitationDraft.normalizedEmail, normalizedEmail),
				),
			)
			.for("update");

		const [lockedInvitation] = await tx
			.select({
				email: invitation.email,
				id: invitation.id,
				status: invitation.status,
			})
			.from(invitation)
			.where(
				and(
					eq(invitation.id, input.invitationId),
					eq(invitation.organizationId, input.organizationId),
				),
			)
			.for("update");

		if (
			lockedInvitation?.status !== "pending" ||
			normalizeInvitationEmail(lockedInvitation.email) !== normalizedEmail ||
			(draft != null && draft.invitationId !== input.invitationId)
		) {
			throw new Error("Invitation target team conflict");
		}

		if (input.targetTeamId) {
			const selectedTeam = await tx.query.team.findFirst({
				where: and(
					eq(team.id, input.targetTeamId),
					eq(team.organizationId, input.organizationId),
				),
				columns: { id: true },
			});
			if (!selectedTeam) throw new Error("Invitation target team conflict");
		}

		const updatedInvitations = await tx
			.update(invitation)
			.set({ targetTeamId: input.targetTeamId })
			.where(
				and(
					eq(invitation.id, input.invitationId),
					eq(invitation.organizationId, input.organizationId),
					eq(invitation.status, "pending"),
				),
			)
			.returning({ id: invitation.id });
		if (updatedInvitations.length === 0) {
			throw new Error("Invitation target team conflict");
		}

		if (draft) {
			const updatedDrafts = await tx
				.update(employeeInvitationDraft)
				.set({ teamId: input.targetTeamId })
				.where(
					and(
						eq(employeeInvitationDraft.id, draft.id),
						eq(employeeInvitationDraft.organizationId, input.organizationId),
						eq(employeeInvitationDraft.normalizedEmail, normalizedEmail),
						eq(employeeInvitationDraft.invitationId, input.invitationId),
					),
				)
				.returning({ id: employeeInvitationDraft.id });
			if (updatedDrafts.length === 0) {
				throw new Error("Invitation target team conflict");
			}
		}
	});
}

export async function resolveAcceptedInvitationCanCreateOrganizations(
	dbClient: InvitationDraftClient,
	input: {
		organizationId: string;
		normalizedEmail: string;
		invitationCanCreateOrganizations: boolean;
	},
): Promise<boolean> {
	if (input.invitationCanCreateOrganizations) return true;

	const stableDraft = await dbClient.query.employeeInvitationDraft.findFirst({
		where: and(
			eq(employeeInvitationDraft.organizationId, input.organizationId),
			eq(employeeInvitationDraft.normalizedEmail, input.normalizedEmail),
		),
		columns: { canCreateOrganizations: true },
	});

	return stableDraft?.canCreateOrganizations ?? false;
}

export function isInvitationActionable(
	invitation: { status: string; expiresAt: Date },
	now: Instant = systemClock.nowInstant(),
): boolean {
	return (
		invitation.status === "pending" &&
		compareInstants(instantFromDate(invitation.expiresAt), now) > 0
	);
}
