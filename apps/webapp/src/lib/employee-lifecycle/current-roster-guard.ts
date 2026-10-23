import { and, inArray } from "drizzle-orm";
import { Effect } from "effect";
import type { db } from "@/db";
import { employee } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import { type DatabaseError, ValidationError } from "@/lib/effect/errors";
import type { DatabaseQuery } from "@/lib/effect/services/database.service";
import { onCurrentRoster } from "./current-roster";

/**
 * The server-side guard for role saves (#1438, Organization ADR 0006). Pickers
 * offer only the current roster, but a stale form or a crafted request must not
 * save a former employee into a role either: a grant, a scope, a policy
 * assignment, a vehicle, a shift, a team, a manager link or a project.
 *
 * Callers pass only the employees the save adds, so removing a former employee
 * from a role, or re-saving a form that keeps one, still works.
 */

/** The `refusal` code on the `ValidationError`, for forms that react to it. */
export const FORMER_EMPLOYEE_REFUSAL = "former_employee";

/** Any client that can select: the global database or a transaction. */
export type RosterGuardClient = Pick<typeof db, "select">;

export interface CurrentRosterCheck {
	organizationId: string;
	employeeIds: readonly (string | null | undefined)[];
	/** The form field the refused ids came from. */
	field: string;
	/** A message safe to show users; defaults to a generic one. */
	message?: string;
	now?: Instant;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const FORMER_EMPLOYEE_MESSAGE =
	"Former employees can't be assigned. Choose someone on the current roster.";

/**
 * The given employees that are not on the organization's current roster: former
 * employees, employees of another organization and unknown ids. One query for
 * the whole list.
 */
export async function findEmployeesNotOnCurrentRoster(
	client: RosterGuardClient,
	input: {
		organizationId: string;
		employeeIds: readonly (string | null | undefined)[];
		now?: Instant;
	},
): Promise<string[]> {
	const ids = [
		...new Set(input.employeeIds.filter((id): id is string => typeof id === "string" && id !== "")),
	];
	if (ids.length === 0) return [];
	// Not a uuid can't be an employee; keep it out of the uuid comparison.
	const candidates = ids.filter((id) => UUID_PATTERN.test(id));
	const current =
		candidates.length === 0
			? []
			: await client
					.select({ id: employee.id })
					.from(employee)
					.where(
						and(
							inArray(employee.id, candidates),
							onCurrentRoster(input.organizationId, employee, input.now),
						),
					);
	const currentIds = new Set(current.map((row) => row.id));
	return ids.filter((id) => !currentIds.has(id));
}

export function formerEmployeeRefusal(
	check: Pick<CurrentRosterCheck, "field" | "message">,
	refusedIds: string[],
): ValidationError {
	return new ValidationError({
		message: check.message ?? FORMER_EMPLOYEE_MESSAGE,
		field: check.field,
		value: refusedIds,
		refusal: FORMER_EMPLOYEE_REFUSAL,
	});
}

/** Promise variant: throws the refusal `ValidationError` when any employee is not current. */
export async function assertOnCurrentRoster(
	client: RosterGuardClient,
	check: CurrentRosterCheck,
): Promise<void> {
	const refused = await findEmployeesNotOnCurrentRoster(client, check);
	if (refused.length > 0) throw formerEmployeeRefusal(check, refused);
}

/** Effect variant over a `DatabaseService` (or a transaction-bound one). */
export function ensureOnCurrentRoster(
	dbService: { readonly db: RosterGuardClient; readonly query: DatabaseQuery },
	check: CurrentRosterCheck,
): Effect.Effect<void, ValidationError | DatabaseError> {
	return Effect.gen(function* () {
		const refused = yield* dbService.query("employeeLifecycle.findNotOnCurrentRoster", () =>
			findEmployeesNotOnCurrentRoster(dbService.db, check),
		);
		if (refused.length > 0) {
			return yield* Effect.fail(formerEmployeeRefusal(check, refused));
		}
	});
}

/** The ids in `next` that `previous` doesn't hold: what a save adds to a role. */
export function addedEmployeeIds(
	next: readonly (string | null | undefined)[],
	previous: readonly (string | null | undefined)[],
): string[] {
	const held = new Set(previous);
	return [...new Set(next)].filter(
		(id): id is string => typeof id === "string" && id !== "" && !held.has(id),
	);
}
