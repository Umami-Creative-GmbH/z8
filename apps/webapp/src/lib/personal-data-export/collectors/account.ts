/**
 * Account category of a personal data export (#811). Account data belongs to
 * the person's login rather than to one organization.
 *
 * - **Admin export** (#1166): only the name and email linked to the employee.
 *   Nothing else about the login (sessions, sign-in methods, security
 *   settings, preferences, devices) ever goes into it.
 * - **Employee export**: the same `user` record, plus the rest of the account,
 *   which #1171 adds through `collectEmployeeOnlyAccountParts`.
 */

import { and, eq } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import {
	type CollectedCategory,
	type PersonalDataCollector,
	type PersonalDataExportDatabase,
	type PersonalDataExportScope,
	type PersonalDataPart,
	recordPart,
} from "../collector";
import { PersonalDataSubjectNotFoundError } from "./employment";

export const accountCollector: PersonalDataCollector = {
	category: "account",
	collect: collectAccount,
};

async function collectAccount(
	database: PersonalDataExportDatabase,
	scope: PersonalDataExportScope,
): Promise<CollectedCategory> {
	// The login linked to this organization's employee record, never another one.
	const [linked] = await database
		.select({
			name: user.name,
			firstName: user.firstName,
			lastName: user.lastName,
			email: user.email,
		})
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(
			and(eq(employee.id, scope.employeeId), eq(employee.organizationId, scope.organizationId)),
		)
		.limit(1);
	if (!linked) throw new PersonalDataSubjectNotFoundError();

	const parts: PersonalDataPart[] = [
		recordPart("user", {
			name: linked.name,
			first_name: linked.firstName,
			last_name: linked.lastName,
			email: linked.email,
		}),
	];
	if (scope.kind === "employee") {
		parts.push(...(await collectEmployeeOnlyAccountParts(database, scope)));
	}
	return { category: "account", parts };
}

/**
 * The account data only the employee export holds: sessions, sign-in
 * providers, passkeys, 2FA status, trusted devices, settings, notification
 * preferences, wellness logs, push devices and access violations (#1171).
 */
async function collectEmployeeOnlyAccountParts(
	_database: PersonalDataExportDatabase,
	_scope: PersonalDataExportScope,
): Promise<PersonalDataPart[]> {
	return [];
}
