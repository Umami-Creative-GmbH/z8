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
	type PersonalDataFieldGuide,
	type PersonalDataPart,
	recordPart,
} from "../collector";
import { PersonalDataSubjectNotFoundError } from "./employment";

/** The README's explanation of the account parts (see "Field guide" in `../collector.ts`). */
export const accountFieldGuide: PersonalDataFieldGuide = (t) => ({
	user: {
		summary: t(
			"personalDataExport.readme.fields.account.user.summary",
			"Your user account: the login you use for this organization.",
		),
		fields: {
			name: t("personalDataExport.readme.fields.account.user.name", "Your account's display name."),
			first_name: t(
				"personalDataExport.readme.fields.account.user.firstName",
				"Your account's first name.",
			),
			last_name: t(
				"personalDataExport.readme.fields.account.user.lastName",
				"Your account's last name.",
			),
			email: t(
				"personalDataExport.readme.fields.account.user.email",
				"The email address you sign in with.",
			),
		},
	},
});

export const accountCollector: PersonalDataCollector = {
	category: "account",
	collect: collectAccount,
	fields: accountFieldGuide,
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
