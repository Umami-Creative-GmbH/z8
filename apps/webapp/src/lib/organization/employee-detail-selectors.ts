import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { cacheLife } from "next/cache";
import { getEmployeeSettingsActorContext } from "@/app/[locale]/(app)/settings/employees/employee-action-utils";
import {
	buildEmployeeFilters,
	employeeSortName,
} from "@/app/[locale]/(app)/settings/employees/selectable-employees";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { employee, workPolicy } from "@/db/schema";
import { runServerActionSafe } from "@/lib/effect/result";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import type { SettingsAccessTier } from "@/lib/settings-access";
import type { EmployeeManagerChoice } from "./employee-read-types";

type SelectorScope = {
	userId: string;
	organizationId: string;
	accessTier: SettingsAccessTier;
	managerId: string | null;
};

type ManagerFilter = {
	excludeId: string;
	limit: number;
	roles: ["admin", "manager"];
	status: "current";
};

function managerWhere(scope: SelectorScope, filter: ManagerFilter) {
	return buildEmployeeFilters(scope.organizationId, {
		roles: filter.roles,
		status: filter.status,
		excludeIds: [filter.excludeId],
		managerId: scope.managerId ?? undefined,
	});
}

/**
 * Source versions are checked outside the cache. The eligible set covers removed
 * rows, changed manager scope and due departures even before a worker runs.
 * PostgreSQL xmin covers writes that preserve updatedAt (imports and APIs too).
 * Only a digest leaves this query; no employee detail is held in the cache key.
 */
async function managerRevision(
	reader: DatabaseClient,
	scope: SelectorScope,
	filter: ManagerFilter,
) {
	const [row] = await reader
		.select({
			revision: sql<string>`md5(coalesce(string_agg(concat_ws(':', ${employee.id}::text, ${employee}.xmin::text, ${user}.xmin::text), ',' order by ${employee.id}), ''))`,
		})
		.from(employee)
		.innerJoin(user, eq(employee.userId, user.id))
		.where(managerWhere(scope, filter));
	return row.revision;
}

async function cachedManagerChoices(
	scope: SelectorScope,
	filter: ManagerFilter,
	_revision: string,
): Promise<EmployeeManagerChoice[]> {
	"use cache";
	cacheLife({ stale: 0, revalidate: 299, expire: 300 });
	return db
		.select({
			id: employee.id,
			userId: employee.userId,
			user: {
				firstName: user.firstName,
				lastName: user.lastName,
				name: user.name,
				email: user.email,
				image: user.image,
			},
		})
		.from(employee)
		.innerJoin(user, eq(employee.userId, user.id))
		.where(managerWhere(scope, filter))
		.orderBy(asc(employeeSortName), asc(user.email), asc(employee.id))
		.limit(filter.limit);
}

const activePolicies = (organizationId: string) =>
	and(
		eq(workPolicy.organizationId, organizationId),
		eq(workPolicy.isActive, true),
	);

async function policyRevision(reader: DatabaseClient, organizationId: string) {
	const [row] = await reader
		.select({
			revision: sql<string>`md5(coalesce(string_agg(concat_ws(':', ${workPolicy.id}::text, ${workPolicy}.xmin::text), ',' order by ${workPolicy.id}), ''))`,
		})
		.from(workPolicy)
		.where(activePolicies(organizationId));
	return row.revision;
}

async function cachedPolicyChoices(scope: SelectorScope, _revision: string) {
	"use cache";
	cacheLife({ stale: 0, revalidate: 299, expire: 300 });
	return db
		.select({ id: workPolicy.id, name: workPolicy.name })
		.from(workPolicy)
		.where(activePolicies(scope.organizationId))
		.orderBy(asc(workPolicy.name), asc(workPolicy.id));
}

function displayScope(
	actor: Effect.Success<ReturnType<typeof getEmployeeSettingsActorContext>>,
): SelectorScope {
	return {
		userId: actor.session.user.id,
		organizationId: actor.organizationId,
		accessTier: actor.accessTier,
		managerId:
			actor.accessTier === "manager"
				? (actor.currentEmployee?.id ?? null)
				: null,
	};
}

/** Fresh business authorization precedes the first cache lookup on every call. */
export async function getEmployeeManagerChoices(excludeId: string) {
	return runServerActionSafe(
		Effect.gen(function* () {
			const actor = yield* getEmployeeSettingsActorContext({
				queryName: "employeeDetail.managerChoices:actor",
			});
			const scope = displayScope(actor);
			const filter: ManagerFilter = {
				excludeId,
				limit: 1000,
				roles: ["admin", "manager"],
				status: "current",
			};
			const revision = yield* actor.dbService.query(
				"employeeDetail.managerChoicesRevision",
				() => managerRevision(actor.dbService.db, scope, filter),
			);
			return yield* actor.dbService.query("employeeDetail.managerChoices", () =>
				cachedManagerChoices(scope, filter, revision),
			);
		}),
	);
}

export async function getEmployeeWorkPolicyChoices() {
	return runServerActionSafe(
		Effect.gen(function* () {
			const actor = yield* getEmployeeSettingsActorContext({
				queryName: "employeeDetail.policyChoices:actor",
			});
			const scope = displayScope(actor);
			const revision = yield* actor.dbService.query(
				"employeeDetail.policyChoicesRevision",
				() => policyRevision(actor.dbService.db, scope.organizationId),
			);
			return yield* actor.dbService.query("employeeDetail.policyChoices", () =>
				cachedPolicyChoices(scope, revision),
			);
		}),
	);
}
