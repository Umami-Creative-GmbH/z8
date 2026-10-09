import "server-only";
import { and, eq } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { member } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import type { Instant } from "@/lib/datetime/temporal-core";
import { canManageDocument, isEmployeeInScope } from "./access";
import {
	isPersonnelFilesEnabled,
	loadEmployeeRef,
	resolvePersonnelFileAccess,
} from "./access-store";
import type { DocumentCategory } from "./document.types";
import { manageGrantOf } from "./officer-grant";
import { listActivePersonnelFileOfficers } from "./officer-grant-store";

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Pick<Transaction, "select">;

/**
 * Who is told about an employee's document of one category (#866; used by the
 * employee upload, expiry and retention notifications of #867, #869, #870):
 * the users whose active personnel file officer grant covers the employee and
 * the category. When no officer covers them, the organization's owners and
 * admins are told instead. The employee is never among the recipients, and
 * nobody is who could not open the document right now (former employees,
 * unapproved members, personnel files turned off): every candidate passes the
 * access resolver. Returns distinct user ids, sorted.
 */
export async function listPersonnelFileNotificationRecipients(
	database: Reader,
	input: { organizationId: string; employeeId: string; category: DocumentCategory; now?: Instant },
): Promise<string[]> {
	const { organizationId, category } = input;
	if (!(await isPersonnelFilesEnabled(database, organizationId))) return [];
	const [subject, [subjectRow]] = await Promise.all([
		loadEmployeeRef(database, { organizationId, employeeId: input.employeeId }),
		database
			.select({ userId: employee.userId })
			.from(employee)
			.where(and(eq(employee.id, input.employeeId), eq(employee.organizationId, organizationId)))
			.limit(1),
	]);
	if (!subject || !subjectRow) return [];
	const subjectUserId = subjectRow.userId;

	const canManage = async (userId: string) => {
		const access = await resolvePersonnelFileAccess(database, {
			userId,
			organizationId,
			now: input.now,
		});
		return access !== null && canManageDocument(access, subject, category);
	};
	const confirmed = async (userIds: Iterable<string>) => {
		const candidates = [...new Set(userIds)].filter((userId) => userId !== subjectUserId);
		const allowed = await Promise.all(candidates.map(canManage));
		return candidates.filter((_, index) => allowed[index]).toSorted();
	};

	const officers = await listActivePersonnelFileOfficers(database, { organizationId });
	const coveringOfficers = await confirmed(
		officers
			.filter(({ grant }) => {
				const manageGrant = manageGrantOf(grant);
				return (
					manageGrant.categories.has(category) && isEmployeeInScope(manageGrant.scope, subject)
				);
			})
			.map((officer) => officer.userId),
	);
	if (coveringOfficers.length > 0) return coveringOfficers;

	const members = await database
		.select({ userId: member.userId, role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, organizationId), eq(member.status, "approved")));
	return confirmed(
		members
			.filter(
				(row) => hasOrganizationRole(row.role, "owner") || hasOrganizationRole(row.role, "admin"),
			)
			.map((row) => row.userId),
	);
}
