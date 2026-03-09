import { desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import { employee, location } from "@/db/schema";
import type { AnyAppError } from "@/lib/effect/errors";
import { AuthorizationError, NotFoundError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";

export const logger = createLogger("SchedulingActions");
export type CurrentEmployee = typeof employee.$inferSelect;

const MANAGER_ROLES = new Set(["manager", "admin"]);

export interface LocationWithSubareas {
	id: string;
	name: string;
	subareas: Array<{
		id: string;
		name: string;
		isActive: boolean;
	}>;
}

export function runSchedulingAction<A, E extends AnyAppError, R>(
	name: string,
	effect: Effect.Effect<A, E, R>,
) {
	return runServerActionSafe(effect.pipe(Effect.withSpan(name), Effect.provide(AppLayer)));
}

export function requireCurrentEmployee(queryName = "getCurrentEmployee") {
	return Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const dbService = yield* _(DatabaseService);
		const session = yield* _(authService.getSession());

		yield* _(Effect.annotateCurrentSpan("user.id", session.user.id));

		const currentEmployee = yield* _(
			dbService.query(queryName, async () => {
				return await db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
		);

		if (!currentEmployee) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
						entityId: session.user.id,
					}),
				),
			);
		}

		return { currentEmployee, session };
	});
}

export function ensureManagerAccess(input: {
	currentEmployee: CurrentEmployee;
	userId: string;
	resource: string;
	action: string;
	message: string;
}) {
	if (MANAGER_ROLES.has(input.currentEmployee.role)) {
		return Effect.void;
	}

	return Effect.fail(
		new AuthorizationError({
			message: input.message,
			userId: input.userId,
			resource: input.resource,
			action: input.action,
		}),
	);
}

export function requireManagerEmployee(input: {
	action: string;
	message: string;
	queryName?: string;
	resource: string;
}) {
	return Effect.gen(function* (_) {
		const { currentEmployee, session } = yield* _(requireCurrentEmployee(input.queryName));

		yield* _(
			ensureManagerAccess({
				currentEmployee,
				userId: session.user.id,
				resource: input.resource,
				action: input.action,
				message: input.message,
			}),
		);

		return { currentEmployee, session };
	});
}

export function getLocationsWithSubareasForOrganization(organizationId: string) {
	return Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		const locations = yield* _(
			dbService.query("getLocationsWithSubareas", async () => {
				return await db.query.location.findMany({
					where: eq(location.organizationId, organizationId),
					with: {
						subareas: {
							columns: {
								id: true,
								name: true,
								isActive: true,
							},
						},
					},
					orderBy: [desc(location.createdAt)],
				});
			}),
		);

		return locations.map((currentLocation) => ({
			id: currentLocation.id,
			name: currentLocation.name,
			subareas: currentLocation.subareas,
		}));
	});
}

export type SchedulingActionResult<T> = ServerActionResult<T>;
