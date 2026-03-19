import { SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api";
import { revalidateTag } from "next/cache";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import type { ZodType } from "zod";
import { member, user } from "@/db/auth-schema";
import { employee, team } from "@/db/schema";
import { CACHE_TAGS } from "@/lib/cache/tags";
import {
	type AnyAppError,
	AuthorizationError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { ManagerService } from "@/lib/effect/services/manager.service";
import {
	isSettingsAccessMembershipRole,
	resolveSettingsAccessTier,
	type SettingsAccessTier,
} from "@/lib/settings-access";
import { canAccessManagedEmployeeSettingsTarget } from "./employee-scope";

const employeeNotFoundError = () =>
	new NotFoundError({
		message: "Employee profile not found",
		entityType: "employee",
	});

export function getEmployeeContext(options?: { organizationId?: string; queryName?: string }) {
	return Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		const where = options?.organizationId
			? and(
				eq(employee.userId, session.user.id),
				eq(employee.organizationId, options.organizationId),
				eq(employee.isActive, true),
			)
			: and(eq(employee.userId, session.user.id), eq(employee.isActive, true));

		const currentEmployee = yield* _(
			dbService.query(options?.queryName ?? "getCurrentEmployee", async () => {
				return await dbService.db.query.employee.findFirst({ where });
			}),
			Effect.flatMap((value) =>
				value ? Effect.succeed(value) : Effect.fail(employeeNotFoundError()),
			),
		);

		return { session, dbService, currentEmployee };
	});
}

export function getEmployeeSettingsActorContext(options?: {
	organizationId?: string;
	queryName?: string;
}) {
	return Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);
		const organizationId = options?.organizationId ?? session.session.activeOrganizationId;

		if (!organizationId) {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "No active organization selected",
						userId: session.user.id,
						resource: "employee_settings",
						action: "access",
					}),
				),
			);
		}

		const [membershipRecord, employeeRecord] = yield* _(
			Effect.all([
				dbService.query(`${options?.queryName ?? "getEmployeeSettingsActor"}:membership`, async () => {
					return await dbService.db.query.member.findFirst({
						where: and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)),
						columns: { role: true },
					});
				}),
				dbService.query(`${options?.queryName ?? "getEmployeeSettingsActor"}:employee`, async () => {
					return await dbService.db.query.employee.findFirst({
						where: and(
							eq(employee.userId, session.user.id),
							eq(employee.organizationId, organizationId),
							eq(employee.isActive, true),
						),
					});
				}),
			]),
		);

		const accessTier = resolveSettingsAccessTier({
			activeOrganizationId: organizationId,
			membershipRole: isSettingsAccessMembershipRole(membershipRecord?.role)
				? membershipRecord.role
				: null,
			employeeRole: employeeRecord?.role ?? null,
		});

		if (accessTier === "member") {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "You do not have access to employee settings",
						userId: session.user.id,
						resource: "employee_settings",
						action: "access",
					}),
				),
			);
		}

		return {
			session,
			dbService,
			organizationId,
			accessTier,
			currentEmployee: employeeRecord ?? null,
		};
	});
}

export function requireAdmin(
	currentEmployee: typeof employee.$inferSelect,
	options: {
		message: string;
		resource: string;
		action: string;
	},
) {
	if (currentEmployee.role === "admin") {
		return Effect.void;
	}

	return Effect.fail(
		new AuthorizationError({
			message: options.message,
			userId: currentEmployee.id,
			resource: options.resource,
			action: options.action,
		}),
	);
}

export function ensureCanAccessEmployeeSettingsTarget(
	currentEmployee: typeof employee.$inferSelect,
	targetEmployee: typeof employee.$inferSelect,
	options: {
		message: string;
		resource: string;
		action: string;
	},
) {
	return Effect.gen(function* (_) {
		yield* _(
			ensureSameOrganization(currentEmployee, targetEmployee, options.resource, options.action),
		);

		if (currentEmployee.role === "admin") {
			return;
		}

		if (currentEmployee.role !== "manager") {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: options.message,
						userId: currentEmployee.id,
						resource: options.resource,
						action: options.action,
					}),
				),
			);
		}

		const managerService = yield* _(ManagerService);
		const isManagedEmployee = yield* _(
			managerService.isManagerOf(currentEmployee.id, targetEmployee.id),
		);

		if (
			!canAccessManagedEmployeeSettingsTarget({
				actorRole: currentEmployee.role,
				isManagedEmployee,
			})
		) {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: options.message,
						userId: currentEmployee.id,
						resource: options.resource,
						action: options.action,
					}),
				),
			);
		}
	});
}

export function requireOrgAdminEmployeeSettingsAccess(
	actor: {
		accessTier: SettingsAccessTier;
		organizationId: string;
		session: { user: { id: string } };
	},
	options: {
		message: string;
		resource: string;
		action: string;
	},
) {
	if (actor.accessTier === "orgAdmin") {
		return Effect.void;
	}

	return Effect.fail(
		new AuthorizationError({
			message: options.message,
			userId: actor.session.user.id,
			resource: options.resource,
			action: options.action,
		}),
	);
}

export function ensureSettingsActorCanAccessEmployeeTarget(
	actor: {
		accessTier: SettingsAccessTier;
		organizationId: string;
		session: { user: { id: string } };
		currentEmployee: typeof employee.$inferSelect | null;
	},
	targetEmployee: typeof employee.$inferSelect,
	options: {
		message: string;
		resource: string;
		action: string;
	},
) {
	return Effect.gen(function* (_) {
		if (actor.organizationId !== targetEmployee.organizationId) {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Cannot access employee from different organization",
						userId: actor.session.user.id,
						resource: options.resource,
						action: options.action,
					}),
				),
			);
		}

		if (actor.accessTier === "orgAdmin") {
			return;
		}

		if (!actor.currentEmployee || actor.currentEmployee.role !== "manager") {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: options.message,
						userId: actor.session.user.id,
						resource: options.resource,
						action: options.action,
					}),
				),
			);
		}

		const managerService = yield* _(ManagerService);
		const isManagedEmployee = yield* _(
			managerService.isManagerOf(actor.currentEmployee.id, targetEmployee.id),
		);

		if (
			!canAccessManagedEmployeeSettingsTarget({
				actorRole: actor.currentEmployee.role,
				isManagedEmployee,
			})
		) {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: options.message,
						userId: actor.session.user.id,
						resource: options.resource,
						action: options.action,
					}),
				),
			);
		}
	});
}

export function requireSettingsActorEmployeeAssignmentAccess(
	actor: {
		accessTier: SettingsAccessTier;
		session: { user: { id: string } };
	},
	assignmentType: "organization" | "team" | "employee",
	options: {
		message: string;
		resource: string;
		action: string;
	},
) {
	if (actor.accessTier === "orgAdmin") {
		return Effect.void;
	}

	if (assignmentType === "employee") {
		return Effect.void;
	}

	return Effect.fail(
		new AuthorizationError({
			message: options.message,
			userId: actor.session.user.id,
			resource: options.resource,
			action: options.action,
		}),
	);
}

export function validateAssignmentTargetFields(
	assignmentType: "organization" | "team" | "employee",
	input: {
		teamId?: string;
		employeeId?: string;
	},
) {
	const hasTeamId = Boolean(input.teamId);
	const hasEmployeeId = Boolean(input.employeeId);

	if (assignmentType === "organization") {
		if (hasTeamId || hasEmployeeId) {
			return Effect.fail(
				new ValidationError({
					message: "Organization assignments cannot target teams or employees",
					field: hasTeamId ? "teamId" : "employeeId",
				}),
			);
		}

		return Effect.void;
	}

	if (assignmentType === "team") {
		if (!hasTeamId) {
			return Effect.fail(
				new ValidationError({
					message: "Team assignments require a teamId",
					field: "teamId",
				}),
			);
		}

		if (hasEmployeeId) {
			return Effect.fail(
				new ValidationError({
					message: "Team assignments cannot target an employee",
					field: "employeeId",
				}),
			);
		}

		return Effect.void;
	}

	if (!hasEmployeeId) {
		return Effect.fail(
			new ValidationError({
				message: "Employee assignments require an employeeId",
				field: "employeeId",
			}),
		);
	}

	if (hasTeamId) {
		return Effect.fail(
			new ValidationError({
				message: "Employee assignments cannot target a team",
				field: "teamId",
			}),
		);
		}

	return Effect.void;
}

export function getManagedEmployeeIdsForSettingsActor(actor: {
	accessTier: SettingsAccessTier;
	currentEmployee: Pick<typeof employee.$inferSelect, "id" | "role"> | null;
}) {
	return Effect.gen(function* (_) {
		if (actor.accessTier === "orgAdmin") {
			return null as Set<string> | null;
		}

		if (!actor.currentEmployee || actor.currentEmployee.role !== "manager") {
			return new Set<string>();
		}

		const managerService = yield* _(ManagerService);
		const managedEmployees = yield* _(managerService.getManagedEmployees(actor.currentEmployee.id));

		return new Set(managedEmployees.map((managedEmployee) => managedEmployee.id));
	});
}

export function requireSettingsActorEmployeeRecord(
	actor: {
		session: { user: { id: string } };
		currentEmployee: typeof employee.$inferSelect | null;
	},
	options?: {
		message?: string;
		resource?: string;
		action?: string;
	},
) {
	if (actor.currentEmployee) {
		return Effect.succeed(actor.currentEmployee);
	}

	return Effect.fail(
		new NotFoundError({
			message: options?.message ?? "Employee profile not found",
			entityType: options?.resource ?? "employee",
			entityId: actor.session.user.id,
		}),
	);
}

export function filterItemsToManagedEmployees<
	T extends {
		employeeId?: string | null;
		employee?: { id: string } | null;
	},
>(items: T[], managedEmployeeIds: Set<string> | null) {
	if (!managedEmployeeIds) {
		return items;
	}

	return items.filter((item) => {
		const employeeId = item.employeeId ?? item.employee?.id ?? null;
		return employeeId ? managedEmployeeIds.has(employeeId) : false;
	});
}

export function validateInput<T>(schema: ZodType<T>, data: unknown, fallbackField = "data") {
	const result = schema.safeParse(data);
	if (result.success) {
		return Effect.succeed(result.data);
	}

	const issue = result.error.issues[0];
	return Effect.fail(
		new ValidationError({
			message: issue?.message ?? "Invalid input",
			field: issue?.path?.join(".") || fallbackField,
		}),
	);
}

export function getTargetEmployee(employeeId: string, queryName = "getTargetEmployee") {
	return Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		return yield* _(
			dbService.query(queryName, async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.id, employeeId),
				});
			}),
			Effect.flatMap((value) =>
				value
					? Effect.succeed(value)
					: Effect.fail(
							new NotFoundError({
								message: "Employee not found",
								entityType: "employee",
								entityId: employeeId,
							}),
						),
			),
		);
	});
}

export function getOrganizationTeam(
	teamId: string,
	organizationId: string,
	queryName = "getOrganizationTeam",
) {
	return Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		return yield* _(
			dbService.query(queryName, async () => {
				return await dbService.db.query.team.findFirst({
					where: and(eq(team.id, teamId), eq(team.organizationId, organizationId)),
				});
			}),
			Effect.flatMap((value) =>
				value
					? Effect.succeed(value)
					: Effect.fail(
							new NotFoundError({
								message: "Team not found",
								entityType: "team",
								entityId: teamId,
							}),
						),
			),
		);
	});
}

export function getTargetUser(userId: string, queryName = "getTargetUser") {
	return Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		return yield* _(
			dbService.query(queryName, async () => {
				return await dbService.db.query.user.findFirst({
					where: eq(user.id, userId),
				});
			}),
			Effect.flatMap((value) =>
				value
					? Effect.succeed(value)
					: Effect.fail(
							new NotFoundError({
								message: "User not found",
								entityType: "user",
								entityId: userId,
							}),
						),
			),
		);
	});
}

export function ensureSameOrganization(
	currentEmployee: typeof employee.$inferSelect,
	targetEmployee: typeof employee.$inferSelect,
	resource: string,
	action: string,
) {
	if (currentEmployee.organizationId === targetEmployee.organizationId) {
		return Effect.void;
	}

	return Effect.fail(
		new AuthorizationError({
			message: "Cannot access employee from different organization",
			userId: currentEmployee.id,
			resource,
			action,
		}),
	);
}

export function parseHourlyRate(value?: string | null) {
	return value ? Number.parseFloat(value) : null;
}

export function hasAppAccessChanges(data: {
	canUseWebapp?: boolean;
	canUseDesktop?: boolean;
	canUseMobile?: boolean;
}) {
	return (
		data.canUseWebapp !== undefined ||
		data.canUseDesktop !== undefined ||
		data.canUseMobile !== undefined
	);
}

export function revalidateEmployeesCache(organizationId: string) {
	revalidateTag(CACHE_TAGS.EMPLOYEES(organizationId), "max");
}

export function runTracedEmployeeAction<T>(options: {
	name: string;
	attributes?: Attributes;
	logError: (error: unknown) => void;
	execute: (span: Span) => Effect.Effect<T, AnyAppError, any>;
}): Promise<ServerActionResult<T>> {
	const tracer = trace.getTracer("employees");
	const runWithSpan = (span: Span) =>
		options.execute(span).pipe(
			Effect.tap(() =>
				Effect.sync(() => {
					span.setStatus({ code: SpanStatusCode.OK });
				}),
			),
			Effect.catchAll((error) =>
				Effect.gen(function* (_) {
					span.recordException(error as Error);
					span.setStatus({
						code: SpanStatusCode.ERROR,
						message: String(error),
					});
					options.logError(error);
					return yield* _(Effect.fail(error as AnyAppError));
				}),
			),
			Effect.onExit(() => Effect.sync(() => span.end())),
			Effect.provide(AppLayer),
		);

	const effect = options.attributes
		? tracer.startActiveSpan(options.name, { attributes: options.attributes }, runWithSpan)
		: tracer.startActiveSpan(options.name, runWithSpan);

	return runServerActionSafe(effect);
}
