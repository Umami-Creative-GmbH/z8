import "server-only";

import { and, eq, ne, sql } from "drizzle-orm";
import { invitation } from "@/db/auth-schema";
import { employeeInvitationDraft } from "@/db/schema";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import {
	findPersonnelNumberHolder,
	type PersonnelNumberHolder,
	type PersonnelNumberReader,
	PersonnelNumberTaken,
	personnelNumberKeySql,
} from "@/lib/organization/personnel-number-uniqueness";
import { buildEligibleInvitationDraftPredicate } from "./employee-invitation-draft-eligibility";

type Scope = {
	organizationId: string;
	personnelNumber: string;
	/** The draft being saved, which may keep its own number. */
	draftId: string;
	now: Date;
};

/**
 * The other pending invitation draft of the organization (invitation pending
 * and not expired, invitee not yet an employee) that holds the personnel
 * number; null when none does. Compares by the key, like the employee index.
 */
async function findPendingDraftPersonnelNumberHolder(
	reader: PersonnelNumberReader,
	scope: Scope,
): Promise<Pick<PersonnelNumberHolder, "name"> | null> {
	const [row] = await reader
		.select({
			firstName: employeeInvitationDraft.firstName,
			lastName: employeeInvitationDraft.lastName,
			email: employeeInvitationDraft.normalizedEmail,
		})
		.from(employeeInvitationDraft)
		.innerJoin(invitation, eq(employeeInvitationDraft.invitationId, invitation.id))
		.where(
			and(
				buildEligibleInvitationDraftPredicate({
					organizationId: scope.organizationId,
					now: scope.now,
				}),
				ne(employeeInvitationDraft.id, scope.draftId),
				sql`${personnelNumberKeySql(employeeInvitationDraft.employeeNumber)} = ${personnelNumberKeySql(sql`${scope.personnelNumber}::text`)}`,
			),
		)
		.limit(1);
	if (!row) return null;
	return {
		name: buildAuthUserDisplayName({
			firstName: row.firstName,
			lastName: row.lastName,
			name: null,
			email: row.email,
		}),
	};
}

/**
 * Who holds the personnel number a draft is saved with (#1197): an employee of
 * the organization, current or former, or another pending draft there.
 */
export async function findDraftPersonnelNumberHolder(
	reader: PersonnelNumberReader,
	scope: Scope,
): Promise<Pick<PersonnelNumberHolder, "name"> | null> {
	return (
		(await findPersonnelNumberHolder(reader, {
			organizationId: scope.organizationId,
			personnelNumber: scope.personnelNumber,
		})) ?? (await findPendingDraftPersonnelNumberHolder(reader, scope))
	);
}

/** Refuses the draft save (throws `PersonnelNumberTaken`) when the number is held. */
export async function assertDraftPersonnelNumberFree(
	reader: PersonnelNumberReader,
	scope: Scope,
): Promise<void> {
	const holder = await findDraftPersonnelNumberHolder(reader, scope);
	if (holder) throw new PersonnelNumberTaken(holder);
}
