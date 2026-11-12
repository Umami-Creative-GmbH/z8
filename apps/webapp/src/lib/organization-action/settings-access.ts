import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { member } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import { isFormerEmployee } from "@/lib/employee-lifecycle/current-roster";
import {
	type AuthenticationError,
	AuthorizationError,
	type DatabaseError,
} from "@/lib/effect/errors";
import { AuthService } from "@/lib/effect/services/auth.service";
import { type DatabaseClient, DatabaseService } from "@/lib/effect/services/database.service";

import type { SettingsAccess } from "./settings-access-level";

export { meetsSettingsAccess, type SettingsAccess } from "./settings-access-level";

export type EmployeeRole = "admin" | "manager" | "employee";

/** What decides a user's settings access in one organization. */
export interface SettingsAccessFacts {
	/** The role of the user's approved membership; null without one (none, or pending). */
	membershipRole: string | null;
	/** The user's employee record there, if any. */
	employee: { id: string; role: EmployeeRole; former: boolean } | null;
}

/**
 * The one rule (ADR 0002): an approved membership is required; a former
 * employee has none, owners included; an owner or admin needs no employee
 * record; a scoped manager is an employee on the current roster whose employee
 * role is admin or manager.
 */
export function settingsAccessOf(facts: SettingsAccessFacts): SettingsAccess | null {
	if (!facts.membershipRole || facts.employee?.former) return null;
	if (hasOrganizationRole(facts.membershipRole, "owner")) return "owner";
	if (hasOrganizationRole(facts.membershipRole, "admin")) return "orgAdmin";
	if (facts.employee?.role === "admin" || facts.employee?.role === "manager") {
		return "scopedManager";
	}
	return "member";
}

/** The `DatabaseService.query` name the facts load under; test stubs answer it. */
export const SETTINGS_ACCESS_FACTS_QUERY = "settingsAccess.facts";

export async function loadSettingsAccessFacts(
	db: Pick<DatabaseClient, "select">,
	input: { userId: string; organizationId: string },
): Promise<SettingsAccessFacts> {
	const [[membership], [employeeRecord]] = await Promise.all([
		db
			.select({ role: member.role })
			.from(member)
			.where(
				and(
					eq(member.userId, input.userId),
					eq(member.organizationId, input.organizationId),
					eq(member.status, "approved"),
				),
			)
			.limit(1),
		db
			.select({ id: employee.id, role: employee.role, former: isFormerEmployee(employee) })
			.from(employee)
			.where(
				and(eq(employee.userId, input.userId), eq(employee.organizationId, input.organizationId)),
			)
			.limit(1),
	]);
	return {
		membershipRole: membership?.role ?? null,
		employee: employeeRecord ?? null,
	};
}

/**
 * The caller, in the session's active organization, with their settings
 * access. Settings access needs an approved membership, so a caller with one
 * always has its role; without settings access the role may be missing.
 */
export type SettingsAccessCaller = {
	userId: string;
	organizationId: string;
	employee: { id: string; role: EmployeeRole } | null;
} & (
	| { settingsAccess: SettingsAccess; membershipRole: string }
	| { settingsAccess: null; membershipRole: string | null }
);

/**
 * The one settings access resolver, shared by `organizationAction` and the page
 * guard `requireOrgAdminSettingsAccess`. The organization is always the
 * session's active organization, behind the SSO/MFA organization gate.
 */
export function resolveCallerSettingsAccess(): Effect.Effect<
	SettingsAccessCaller,
	AuthenticationError | AuthorizationError | DatabaseError,
	AuthService | DatabaseService
> {
	return Effect.gen(function* () {
		const auth = yield* AuthService;
		const session = yield* auth.getSession();
		const organizationId = session.session.activeOrganizationId;
		if (!organizationId) {
			return yield* Effect.fail(
				new AuthorizationError({
					message: "No active organization selected",
					userId: session.user.id,
				}),
			);
		}
		// The SSO/MFA organization gate for the active organization.
		yield* auth.getSession(organizationId);

		const dbService = yield* DatabaseService;
		const facts = yield* dbService.query(SETTINGS_ACCESS_FACTS_QUERY, () =>
			loadSettingsAccessFacts(dbService.db, { userId: session.user.id, organizationId }),
		);
		const settingsAccess = settingsAccessOf(facts);
		const base = { userId: session.user.id, organizationId };
		if (settingsAccess === null || facts.membershipRole === null) {
			return {
				...base,
				employee: null,
				settingsAccess: null,
				membershipRole: facts.membershipRole,
			} satisfies SettingsAccessCaller;
		}
		return {
			...base,
			employee: facts.employee ? { id: facts.employee.id, role: facts.employee.role } : null,
			settingsAccess,
			membershipRole: facts.membershipRole,
		} satisfies SettingsAccessCaller;
	});
}
