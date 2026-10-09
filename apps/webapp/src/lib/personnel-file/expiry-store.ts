import { and, asc, eq, inArray, isNotNull, lte } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { organization, user } from "@/db/auth-schema";
import { employee, employeeDocument, personnelFileReminderSetting } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import type { PersonnelFileAccess } from "./access";
import { visibleDocumentsCondition } from "./access-store";
import { type DocumentCategory, EXPIRY_DATE_CATEGORIES } from "./document.types";
import { todayInOrganization } from "./document-rules";
import {
	DEFAULT_EXPIRY_REMINDER_LEAD_DAYS,
	describeExpiry,
	type ExpiryDescription,
	expiryWindowEnd,
} from "./expiry";

/**
 * Expiry reminder settings and the expiring documents list (#869).
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Pick<Transaction, "select">;

/** The organization's expiry reminder lead time in days (default 30). */
export async function loadExpiryReminderLeadDays(
	database: Reader,
	organizationId: string,
): Promise<number> {
	const [row] = await database
		.select({ leadDays: personnelFileReminderSetting.expiryLeadDays })
		.from(personnelFileReminderSetting)
		.where(eq(personnelFileReminderSetting.organizationId, organizationId))
		.limit(1);
	return row?.leadDays ?? DEFAULT_EXPIRY_REMINDER_LEAD_DAYS;
}

/** Stores a validated lead time (`validateExpiryReminderLeadDays`). */
export async function saveExpiryReminderLeadDays(
	database: Database | Pick<Transaction, "insert">,
	input: { organizationId: string; leadDays: number; actorUserId?: string | null },
): Promise<void> {
	await database
		.insert(personnelFileReminderSetting)
		.values({
			organizationId: input.organizationId,
			expiryLeadDays: input.leadDays,
			updatedBy: input.actorUserId ?? null,
		})
		.onConflictDoUpdate({
			target: personnelFileReminderSetting.organizationId,
			set: {
				expiryLeadDays: input.leadDays,
				updatedBy: input.actorUserId ?? null,
				updatedAt: new Date(),
			},
		});
}

/** The organization's calendar day and lead time, as the reminder job and the list see them. */
export async function loadExpiryReminderWindow(
	database: Reader,
	input: { organizationId: string; now: Instant },
): Promise<{ today: string; leadDays: number; windowEnd: string }> {
	const [[org], leadDays] = await Promise.all([
		database
			.select({ timezone: organization.timezone })
			.from(organization)
			.where(eq(organization.id, input.organizationId))
			.limit(1),
		loadExpiryReminderLeadDays(database, input.organizationId),
	]);
	const today = todayInOrganization(input.now, org?.timezone);
	return { today, leadDays, windowEnd: expiryWindowEnd({ today, leadDays }) };
}

export interface ExpiringDocument {
	documentId: string;
	employeeId: string;
	employeeName: string;
	title: string;
	category: DocumentCategory;
	visibility: "shared" | "hr_only";
	/** YYYY-MM-DD */
	expiryDate: string;
	expiry: ExpiryDescription;
}

/**
 * The documents the actor manages that expire within the lead time or have
 * already expired, earliest first (the Personnel files area). Documents of
 * former employees are left out, like the reminders: nothing about them is
 * still to be renewed.
 */
export async function listExpiringDocuments(
	database: Reader,
	access: PersonnelFileAccess,
	input: { now: Instant },
): Promise<ExpiringDocument[]> {
	const { today, windowEnd } = await loadExpiryReminderWindow(database, {
		organizationId: access.organizationId,
		now: input.now,
	});
	// Only documents the actor manages; their own shared documents are in My documents.
	const managed = visibleDocumentsCondition({ ...access, selfEmployeeId: null });
	const rows = await database
		.select({
			documentId: employeeDocument.id,
			employeeId: employeeDocument.employeeId,
			userName: user.name,
			employeeNumber: employee.employeeNumber,
			title: employeeDocument.title,
			category: employeeDocument.category,
			visibility: employeeDocument.visibility,
			expiryDate: employeeDocument.expiryDate,
		})
		.from(employeeDocument)
		.innerJoin(
			employee,
			and(
				eq(employee.id, employeeDocument.employeeId),
				eq(employee.organizationId, employeeDocument.organizationId),
			),
		)
		.leftJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				managed,
				inArray(employeeDocument.category, [...EXPIRY_DATE_CATEGORIES]),
				isNotNull(employeeDocument.expiryDate),
				lte(employeeDocument.expiryDate, windowEnd),
				employeeHasOrganizationAccess(input.now),
			),
		)
		.orderBy(
			asc(employeeDocument.expiryDate),
			asc(user.name),
			asc(employeeDocument.title),
			asc(employeeDocument.id),
		);
	return rows.flatMap((row) => {
		if (!row.expiryDate) return [];
		return [
			{
				documentId: row.documentId,
				employeeId: row.employeeId,
				employeeName: row.userName?.trim() || row.employeeNumber || row.employeeId,
				title: row.title,
				category: row.category,
				visibility: row.visibility,
				expiryDate: row.expiryDate,
				expiry: describeExpiry({ today, expiryDate: row.expiryDate }),
			},
		];
	});
}
