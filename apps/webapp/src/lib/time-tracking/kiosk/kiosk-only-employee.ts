import "server-only";

import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { db as rootDatabase } from "@/db";
import { member, user } from "@/db/auth-schema";
import { employee, team } from "@/db/schema";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { toAuthStructuredName } from "@/lib/auth/derived-user-name";
import { acquireEmployeeIdentityLock } from "@/lib/auth/employee-identity-lock";
import { normalizeInvitationEmail } from "@/lib/auth/employee-invitation-draft";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import { generateReservedEmail, isReservedEmail } from "@/lib/auth/reserved-email";
import { withAuthorizationMutation } from "@/lib/authorization/authorization-mutation";
import { loadOrganizationPrincipalContext } from "@/lib/authorization/principal-loader";
import { syncBillingSeatsAfterMemberChange } from "@/lib/billing/seat-sync-trigger";
import { assertEnterpriseIdentityInvitationAllowed } from "@/lib/enterprise-identity/enforcement";
import { createLogger } from "@/lib/logger";
import { KioskPinRefusal } from "./pin-errors";

type Database = typeof rootDatabase;

const logger = createLogger("KioskOnlyEmployee");
const NAME_MAX_LENGTH = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailSchema = z.email();

export type CreateKioskOnlyEmployeeInput = {
	organizationId: string;
	/** An owner or admin of the organization. */
	actorUserId: string;
	firstName: string;
	lastName?: string | null;
	teamId?: string | null;
};

/**
 * What adding a real email needs from outside the database: the single-use
 * link with which the person chooses a password, and delivery of the
 * organization's invitation email carrying it.
 */
export type KioskOnlyEmailUpgradeDeps = {
	createPasswordSetupUrl(organizationId: string, userId: string): Promise<string>;
	sendInvitationEmail(invitation: {
		organizationId: string;
		email: string;
		invitationUrl: string;
		inviterUserId: string;
	}): Promise<void>;
};

async function requireOrganizationAdmin(db: Database, organizationId: string, actorUserId: string) {
	const principal = await loadOrganizationPrincipalContext(db, {
		userId: actorUserId,
		organizationId,
	});
	const role = principal.orgMembership?.role;
	if (!hasOrganizationRole(role, "owner") && !hasOrganizationRole(role, "admin")) {
		throw new KioskPinRefusal(
			"not_allowed",
			"Only organization owners and admins can manage kiosk-only employees.",
		);
	}
}

function namePart(value: string | null | undefined): string {
	return typeof value === "string" ? value.trim() : "";
}

function isUniqueViolation(error: unknown): boolean {
	for (let current = error; current && typeof current === "object"; ) {
		if ((current as { code?: unknown }).code === "23505") return true;
		current = (current as { cause?: unknown }).cause;
	}
	return false;
}

/**
 * Creates a kiosk-only employee (ADR 0006): a real user with a reserved,
 * undeliverable address unique to them and no credential, an approved member
 * of the organization and an ordinary employee profile. The names live on the
 * user, the single name source. The employee is a full billable seat.
 */
export async function createKioskOnlyEmployee(
	db: Database,
	input: CreateKioskOnlyEmployeeInput,
): Promise<{ employeeId: string; userId: string }> {
	await requireOrganizationAdmin(db, input.organizationId, input.actorUserId);

	const firstName = namePart(input.firstName);
	const lastName = namePart(input.lastName);
	if (!firstName || firstName.length > NAME_MAX_LENGTH || lastName.length > NAME_MAX_LENGTH) {
		throw new KioskPinRefusal("invalid_name", "Enter a first name of up to 100 characters.");
	}

	const teamId = input.teamId || null;
	if (teamId) {
		const [targetTeam] = UUID_PATTERN.test(teamId)
			? await db
					.select({ id: team.id })
					.from(team)
					.where(and(eq(team.id, teamId), eq(team.organizationId, input.organizationId)))
					.limit(1)
			: [];
		if (!targetTeam) {
			throw new KioskPinRefusal("team_not_found", "Team not found in this organization.");
		}
	}

	const userId = crypto.randomUUID();
	const memberId = crypto.randomUUID();
	const email = generateReservedEmail();
	const now = new Date();
	const employeeId = await withAuthorizationMutation(
		{ organizationId: input.organizationId, userIds: [userId] },
		async (tx) => {
			await acquireEmployeeIdentityLock(tx, {
				organizationId: input.organizationId,
				normalizedEmail: email,
			});
			await tx.insert(user).values({
				id: userId,
				...toAuthStructuredName({ firstName, lastName }),
				email,
				emailVerified: false,
				createdAt: now,
				updatedAt: now,
			});
			await tx.insert(member).values({
				id: memberId,
				organizationId: input.organizationId,
				userId,
				role: "member",
				status: "approved",
				createdAt: now,
			});
			const [created] = await tx
				.insert(employee)
				.values({
					userId,
					organizationId: input.organizationId,
					teamId,
					role: "employee",
					isActive: true,
				})
				.returning({ id: employee.id });
			return created.id;
		},
		db,
	);

	await syncBillingSeatsAfterMemberChange({
		organizationId: input.organizationId,
		memberId,
		userId,
		change: "added",
	});
	await logAudit({
		action: AuditAction.KIOSK_ONLY_EMPLOYEE_CREATED,
		actorId: input.actorUserId,
		employeeId,
		targetId: employeeId,
		targetType: "employee",
		organizationId: input.organizationId,
		timestamp: now,
	});
	return { employeeId, userId };
}

/**
 * Turns a kiosk-only employee into an ordinary one (ADR 0006, #857): the real
 * address replaces the reserved one on the same user, so the employee keeps
 * their user, kiosk PIN and history. The address counts as verified because,
 * as with any invitation, signing in still needs control of it: the emailed
 * password setup link, a password reset, or a provider vouching for it. The
 * organization's invitation email then carries the password setup link.
 *
 * If delivery fails after the address changed, the person can still use
 * "Forgot password" with the new address; `invitationSent` reports it.
 */
export async function addEmailToKioskOnlyEmployee(
	db: Database,
	input: { organizationId: string; actorUserId: string; employeeId: string; email: string },
	deps: KioskOnlyEmailUpgradeDeps,
): Promise<{ invitationSent: boolean }> {
	await requireOrganizationAdmin(db, input.organizationId, input.actorUserId);

	const email = normalizeInvitationEmail(input.email);
	if (!emailSchema.safeParse(email).success) {
		throw new KioskPinRefusal("invalid_email", "Enter a valid email address.");
	}
	if (isReservedEmail(email)) {
		throw new KioskPinRefusal("reserved_email", "This address cannot be used.");
	}
	try {
		await assertEnterpriseIdentityInvitationAllowed({ organizationId: input.organizationId, email });
	} catch {
		throw new KioskPinRefusal(
			"email_not_allowed",
			"Your organization's sign-in policy does not allow this address.",
		);
	}

	const userId = await db
		.transaction(async (tx) => {
			await acquireEmployeeIdentityLock(tx, {
				organizationId: input.organizationId,
				normalizedEmail: email,
			});
			const [target] = UUID_PATTERN.test(input.employeeId)
				? await tx
						.select({ userId: user.id, email: user.email })
						.from(employee)
						.innerJoin(user, eq(user.id, employee.userId))
						.where(
							and(
								eq(employee.id, input.employeeId),
								eq(employee.organizationId, input.organizationId),
							),
						)
						.limit(1)
						.for("update", { of: user })
				: [];
			if (!target) {
				throw new KioskPinRefusal("employee_not_found", "Employee not found in this organization.");
			}
			if (!isReservedEmail(target.email)) {
				throw new KioskPinRefusal("not_kiosk_only", "This employee already has an email address.");
			}
			const [taken] = await tx
				.select({ id: user.id })
				.from(user)
				.where(and(sql`lower(btrim(${user.email})) = ${email}`, ne(user.id, target.userId)))
				.limit(1);
			if (taken) {
				throw new KioskPinRefusal("email_in_use", "Another account already uses this address.");
			}
			await tx
				.update(user)
				.set({ email, emailVerified: true, updatedAt: new Date() })
				.where(eq(user.id, target.userId));
			return target.userId;
		})
		.catch((error: unknown) => {
			if (isUniqueViolation(error)) {
				throw new KioskPinRefusal("email_in_use", "Another account already uses this address.");
			}
			throw error;
		});

	await logAudit({
		action: AuditAction.KIOSK_ONLY_EMPLOYEE_EMAIL_ADDED,
		actorId: input.actorUserId,
		employeeId: input.employeeId,
		targetId: input.employeeId,
		targetType: "employee",
		organizationId: input.organizationId,
		timestamp: new Date(),
	});

	try {
		const invitationUrl = await deps.createPasswordSetupUrl(input.organizationId, userId);
		await deps.sendInvitationEmail({
			organizationId: input.organizationId,
			email,
			invitationUrl,
			inviterUserId: input.actorUserId,
		});
		return { invitationSent: true };
	} catch (error) {
		logger.error(
			{ error, organizationId: input.organizationId, employeeId: input.employeeId },
			"Failed to send the invitation to a former kiosk-only employee",
		);
		return { invitationSent: false };
	}
}
