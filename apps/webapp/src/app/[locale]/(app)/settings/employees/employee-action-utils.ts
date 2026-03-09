import { SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api";
import { revalidateTag } from "next/cache";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import type { ZodType } from "zod";
import { user } from "@/db/auth-schema";
import { employee } from "@/db/schema";
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
			)
			: eq(employee.userId, session.user.id);

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
