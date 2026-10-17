import "server-only";

import { and, eq, ne, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { Effect } from "effect";
import type { db } from "@/db";
import { user } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { DatabaseError, ValidationError } from "@/lib/effect/errors";
import { isConstraintViolation } from "@/lib/projects/constraint-violation";
import { PERSONNEL_NUMBER_WHITESPACE_SQL } from "./personnel-number";
import { PERSONNEL_NUMBER_TAKEN, personnelNumberTakenMessage } from "./personnel-number-refusal";

/**
 * Uniqueness of the **Personnel number** (#881): no two employees of one
 * organization, current or former, share one. Migration 0232's unique index
 * guarantees it; saves check first so they can name the holder, and map a lost
 * race on the index to the same refusal.
 */

/** The unique index on (organization, personnel number key) from migration 0232. */
export const PERSONNEL_NUMBER_UNIQUE_INDEX = "employee_organization_personnel_number_unique_idx";

type Transaction = Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];
/** Anything that can run a select: the app database or a transaction. */
export type PersonnelNumberReader = Pick<Transaction, "select">;

/**
 * The comparison key of a personnel number in SQL, exactly as the unique index
 * computes it: the lowercase of the number trimmed like `normalizePersonnelNumber`.
 */
export function personnelNumberKeySql(value: SQLWrapper): SQL {
	return sql`lower(btrim(${value}, ${sql.raw(PERSONNEL_NUMBER_WHITESPACE_SQL)}))`;
}

export interface PersonnelNumberHolder {
	employeeId: string;
	/** The holder's display name, for the refusal message. */
	name: string;
}

/**
 * The employee of the organization (current or former) who holds the
 * personnel number, other than `exceptEmployeeId`; null when it is free or
 * blank. Compares by the key, like the unique index.
 */
export async function findPersonnelNumberHolder(
	reader: PersonnelNumberReader,
	input: { organizationId: string; personnelNumber: string; exceptEmployeeId?: string },
): Promise<PersonnelNumberHolder | null> {
	if (input.personnelNumber.trim() === "") return null;
	const [row] = await reader
		.select({
			employeeId: employee.id,
			userFirstName: user.firstName,
			userLastName: user.lastName,
			userName: user.name,
			email: user.email,
		})
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				sql`${personnelNumberKeySql(employee.employeeNumber)} = ${personnelNumberKeySql(sql`${input.personnelNumber}::text`)}`,
				input.exceptEmployeeId ? ne(employee.id, input.exceptEmployeeId) : undefined,
			),
		)
		.limit(1);
	if (!row) return null;
	return {
		employeeId: row.employeeId,
		name:
			buildAuthUserDisplayName({
				firstName: row.userFirstName,
				lastName: row.userLastName,
				name: row.userName,
				email: row.email,
			}) || row.employeeId,
	};
}

/** Thrown inside a save's transaction when the personnel number is taken; rolls it back. */
export class PersonnelNumberTaken extends Error {
	/** `holder` is the employee, or the pending invitation draft (#1197), holding the number. */
	constructor(readonly holder: Pick<PersonnelNumberHolder, "name">) {
		super("Personnel number is taken");
		this.name = "PersonnelNumberTaken";
	}
}

/** Refuses the save (throws `PersonnelNumberTaken`) when another employee holds the number. */
export async function assertPersonnelNumberFree(
	reader: PersonnelNumberReader,
	input: { organizationId: string; personnelNumber: string; exceptEmployeeId?: string },
): Promise<void> {
	const holder = await findPersonnelNumberHolder(reader, input);
	if (holder) throw new PersonnelNumberTaken(holder);
}

/** Whether a write failed on the personnel number unique index (a concurrent save won). */
export function isPersonnelNumberConflict(error: unknown): boolean {
	return isConstraintViolation(error, "23505", PERSONNEL_NUMBER_UNIQUE_INDEX);
}

/** Whether a serializable transaction was rolled back because a concurrent one conflicted. */
function isSerializationFailure(error: unknown): boolean {
	let candidate: unknown = error;
	for (let depth = 0; depth < 5 && candidate && typeof candidate === "object"; depth += 1) {
		if ((candidate as { code?: unknown }).code === "40001") return true;
		candidate = (candidate as { cause?: unknown }).cause;
	}
	return false;
}

class PersonnelNumberManagedByIdp extends Error {}

/** Call under the employee's configuration guard, so SCIM cannot claim ownership mid-save. */
export async function assertPersonnelNumberLocallyEditable(
	reader: PersonnelNumberReader,
	input: { organizationId: string; employeeId: string; personnelNumber: string | null | undefined },
): Promise<void> {
	if (input.personnelNumber === undefined) return;
	const [current] = await reader.select({ number: employee.employeeNumber, managed: employee.personnelNumberManagedByScim })
		.from(employee).where(and(eq(employee.id, input.employeeId), eq(employee.organizationId, input.organizationId)));
	if (current?.managed && current.number !== input.personnelNumber) throw new PersonnelNumberManagedByIdp();
}
type HolderLookup<E, R> = () => Effect.Effect<Pick<PersonnelNumberHolder, "name"> | null, E, R>;

function refusalNaming(
	holder: Pick<PersonnelNumberHolder, "name"> | null,
	managedByIdp = false,
): Effect.Effect<never, ValidationError> {
	return Effect.promise(async () => {
		const { getTranslate } = await import("@/tolgee/server");
		return getTranslate();
	}).pipe(
		Effect.flatMap((t) =>
			Effect.fail(
				new ValidationError({
					message: managedByIdp ? t("settings.employees.detailView.personnelNumberManagedByIdp", "Managed by your identity provider. Change the personnel number there.") : personnelNumberTakenMessage(t, holder?.name ?? null),
					field: "employeeNumber",
					refusal: managedByIdp ? "personnel_number_managed_by_idp" : PERSONNEL_NUMBER_TAKEN,
				}),
			),
		),
	);
}

/**
 * Turns a taken personnel number raised inside a save (a `DatabaseService.query`)
 * into a field-level `ValidationError` on `employeeNumber` with the refusal
 * `personnel_number_taken` and a message in the user's language naming the
 * holder: a `PersonnelNumberTaken` from the check, or a unique index violation
 * from a concurrent save, whose holder `findHolder` looks up after the
 * rollback. A serializable save rolled back by a concurrent one (40001) is
 * refused the same way when `findHolder` then finds a holder, and fails as it
 * was otherwise. `findHolder` is a `DatabaseService.query`, so its own failure
 * stays a typed `DatabaseError`. Other errors pass through.
 */
export function keepPersonnelNumberRefusal<E2, R2>(findHolder: HolderLookup<E2, R2>) {
	return <A, E, R>(
		effect: Effect.Effect<A, E, R>,
	): Effect.Effect<A, E | E2 | ValidationError, R | R2> =>
		effect.pipe(
			Effect.catch((error: E): Effect.Effect<never, E | E2 | ValidationError, R2> => {
				// The check throws inside the query, which wraps it once in a `DatabaseError`.
				const cause = error instanceof DatabaseError ? error.cause : error;
				if (cause instanceof PersonnelNumberManagedByIdp) return refusalNaming(null, true);
				if (cause instanceof PersonnelNumberTaken) return refusalNaming(cause.holder);
				if (isPersonnelNumberConflict(error)) {
					return findHolder().pipe(Effect.flatMap(refusalNaming));
				}
				if (isSerializationFailure(error)) {
					return findHolder().pipe(
						Effect.flatMap(
							(holder): Effect.Effect<never, E | ValidationError> =>
								holder ? refusalNaming(holder) : Effect.fail(error),
						),
					);
				}
				return Effect.fail(error);
			}),
		);
}
