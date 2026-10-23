/**
 * A stand-in for `@/lib/employee-lifecycle/current-roster-guard` in unit tests
 * that mock the database. The employees in `former()` are refused; everyone
 * else is on the current roster. The PostgreSQL suite covers the real query.
 *
 * vi.mock("@/lib/employee-lifecycle/current-roster-guard", async () =>
 *   (await import("@/lib/employee-lifecycle/testing/current-roster-guard.test.mock"))
 *     .currentRosterGuardModule(() => state.formerEmployeeIds));
 */
import { Effect } from "effect";
import { vi } from "vitest";
import type * as Guard from "../current-roster-guard";

export async function currentRosterGuardModule(
	former: () => ReadonlySet<string>,
): Promise<typeof Guard> {
	const actual = await vi.importActual<typeof Guard>("../current-roster-guard");
	const refused = (ids: readonly (string | null | undefined)[]) =>
		[...new Set(ids)].filter((id): id is string => typeof id === "string" && former().has(id));
	return {
		...actual,
		findEmployeesNotOnCurrentRoster: vi.fn(async (_client, input) => refused(input.employeeIds)),
		assertOnCurrentRoster: vi.fn(async (_client, check) => {
			const ids = refused(check.employeeIds);
			if (ids.length > 0) throw actual.formerEmployeeRefusal(check, ids);
		}),
		ensureOnCurrentRoster: vi.fn((_dbService, check) => {
			const ids = refused(check.employeeIds);
			return ids.length > 0 ? Effect.fail(actual.formerEmployeeRefusal(check, ids)) : Effect.void;
		}),
	};
}
