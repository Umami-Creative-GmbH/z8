import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { employee } from "@/db/schema";
import { drivingLicenceDeclaredClasses } from "@/db/schema/driving-licence-declared-classes";
import type { DeclaredLicenceClass } from "./check-types";
import { intendedDriverCondition } from "./intended-drivers";
import type { DrivingLicenceDatabase, DrivingLicenceTransaction } from "./verifiers";

/**
 * Storage of declared classes (#2003): an intended driver's own statement of their licence
 * classes. Kept apart from `declared-classes.ts` so the check and lifecycle modules can read
 * and trim it without importing the save path.
 */
export interface DrivingLicenceDeclaredClasses {
	classes: DeclaredLicenceClass[];
	documentExpiresOn: string | null;
	updatedAt: string;
}

export async function readDeclaredLicenceClasses(
	database: DrivingLicenceDatabase,
	organizationId: string,
	employeeId: string,
): Promise<DrivingLicenceDeclaredClasses | null> {
	const [row] = await database
		.select({
			classes: drivingLicenceDeclaredClasses.classes,
			documentExpiresOn: drivingLicenceDeclaredClasses.documentExpiresOn,
			updatedAt: drivingLicenceDeclaredClasses.updatedAt,
		})
		.from(drivingLicenceDeclaredClasses)
		.where(
			and(
				eq(drivingLicenceDeclaredClasses.organizationId, organizationId),
				eq(drivingLicenceDeclaredClasses.employeeId, employeeId),
			),
		)
		.limit(1);
	return row
		? {
				classes: row.classes,
				documentExpiresOn: row.documentExpiresOn,
				updatedAt: row.updatedAt.toISOString(),
			}
		: null;
}

/**
 * A check replaces what the employee declared for the classes it inspected, whatever their
 * result, and the document dates it recorded. Nothing left: the statement is removed.
 */
export async function replaceDeclaredLicenceClassesByCheck(
	tx: DrivingLicenceTransaction,
	input: { organizationId: string; employeeId: string; inspected: readonly string[] },
) {
	const scope = and(
		eq(drivingLicenceDeclaredClasses.organizationId, input.organizationId),
		eq(drivingLicenceDeclaredClasses.employeeId, input.employeeId),
	);
	const [row] = await tx
		.select({ classes: drivingLicenceDeclaredClasses.classes })
		.from(drivingLicenceDeclaredClasses)
		.where(scope)
		.for("update");
	if (!row) return;
	const inspected = new Set(input.inspected);
	const remaining = row.classes.filter((entry) => !inspected.has(entry.code));
	if (!remaining.length) {
		await tx.delete(drivingLicenceDeclaredClasses).where(scope);
		return;
	}
	await tx
		.update(drivingLicenceDeclaredClasses)
		.set({ classes: remaining, documentExpiresOn: null })
		.where(scope);
}

/**
 * Removes the declared classes of employees who are no longer intended drivers (optionally
 * only among `employeeIds`): the statement exists only for the driving the organization
 * requires. Call after any write that can change who is an intended driver.
 */
export async function pruneDeclaredLicenceClasses(
	tx: DrivingLicenceTransaction,
	organizationId: string,
	employeeIds?: readonly string[],
) {
	if (employeeIds && !employeeIds.length) return;
	await tx
		.delete(drivingLicenceDeclaredClasses)
		.where(
			and(
				eq(drivingLicenceDeclaredClasses.organizationId, organizationId),
				employeeIds
					? inArray(drivingLicenceDeclaredClasses.employeeId, [...employeeIds])
					: undefined,
				sql`${drivingLicenceDeclaredClasses.employeeId} not in (select ${employee.id} from ${employee} where ${intendedDriverCondition(organizationId)})`,
			),
		);
}

/** The employee left: their statement goes with the employment. */
export async function deleteDeclaredLicenceClasses(
	tx: DrivingLicenceTransaction,
	organizationId: string,
	employeeId: string,
) {
	await tx
		.delete(drivingLicenceDeclaredClasses)
		.where(
			and(
				eq(drivingLicenceDeclaredClasses.organizationId, organizationId),
				eq(drivingLicenceDeclaredClasses.employeeId, employeeId),
			),
		);
}
