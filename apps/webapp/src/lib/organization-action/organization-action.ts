import { SpanStatusCode, trace } from "@opentelemetry/api";
import { Effect } from "effect";
import type { z } from "zod";
import {
	type AnyAppError,
	AuthorizationError,
	type DatabaseError,
	ValidationError,
} from "@/lib/effect/errors";
import {
	type AppServices,
	runServerActionSafe,
	type ServerActionResult,
} from "@/lib/effect/result";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { ensureOnCurrentRoster } from "@/lib/employee-lifecycle/current-roster-guard";
import { loadManagedScope, type ManagedScope } from "./managed-scope";
import {
	type EmployeeRole,
	meetsSettingsAccess,
	resolveCallerSettingsAccess,
	type SettingsAccess,
} from "./settings-access";

export type { ManagedScope } from "./managed-scope";
export type { SettingsAccess } from "./settings-access";

/** The explicit marker for an action that takes no input. */
export const noInput = Object.freeze({ organizationActionInput: "none" as const });
export type NoInput = typeof noInput;

type InputSchema = z.ZodType | NoInput;

export interface OrganizationActor {
	readonly userId: string;
	/** The role of the actor's approved membership, e.g. `owner`, `admin` or `member`. */
	readonly membershipRole: string;
	/** The actor's employee record on the current roster; null for an org admin without one. */
	readonly employee: { readonly id: string; readonly role: EmployeeRole } | null;
	readonly settingsAccess: SettingsAccess;
	/**
	 * Steps up inside the handler when the level the action needs depends on its
	 * validated input; fails with an `AuthorizationError` below `level`.
	 */
	require(level: SettingsAccess): Effect.Effect<void, AuthorizationError>;
	/**
	 * Whom the actor manages, loaded on first use: the whole organization for an
	 * org admin, else the employees they manage and the teams whose members or
	 * settings they may manage (none for an org member).
	 */
	managedScope(): Effect.Effect<ManagedScope, DatabaseError, DatabaseService>;
}

export interface OrganizationActionContext<Input> {
	readonly actor: OrganizationActor;
	/** The session's active organization; load every row by ID and this. */
	readonly organizationId: string;
	readonly input: Input;
}

export interface OrganizationActionDeclaration<Schema extends InputSchema> {
	/** Names the OTel span and the refusal's resource, e.g. `telegram.updateSettings`. */
	readonly name: string;
	/** The settings access the action requires; a higher level also qualifies. */
	readonly requires: SettingsAccess;
	/** A zod schema the input must satisfy, checked after authorization, or `noInput`. */
	readonly schema: Schema;
	/**
	 * The employees this call adds to a role, a team, a policy or another
	 * assignment. Any that is not on the organization's current roster is refused
	 * with the `former_employee` refusal before the handler runs. Name only the
	 * employees the save adds (`addedEmployeeIds`), so keeping one still works.
	 */
	readonly addsEmployees?: (
		input: OrganizationActionInput<Schema>,
	) => readonly (string | null | undefined)[];
}

/** The handler's validated input. */
export type OrganizationActionInput<Schema extends InputSchema> = Schema extends z.ZodType
	? z.output<Schema>
	: undefined;

/** The server action's parameters: none, or the input before validation. */
type ActionArgs<Schema extends InputSchema> = Schema extends z.ZodType
	? [input: z.input<Schema>]
	: [];

// A registry symbol, so the mark survives a second copy of this module.
const PRODUCED_BY_ORGANIZATION_ACTION = Symbol.for("z8.organizationAction");

/**
 * Produces a settings server action (ADR 0002). Every call runs, in one OTel
 * span named `declaration.name`: session → the session's active organization
 * (behind the SSO/MFA gate) → settings access → schema → current-roster check of
 * `addsEmployees` → handler, and returns a `ServerActionResult`. A refused
 * caller never reaches validation or the handler.
 *
 * Export the result from a `"use server"` module:
 *
 *   export const updateTelegramSettings = organizationAction(
 *     { name: "telegram.updateSettings", requires: "orgAdmin", schema: telegramSettingsSchema },
 *     ({ organizationId, input }) => Effect.gen(function* () { … }),
 *   );
 */
export function organizationAction<Schema extends InputSchema, T>(
	declaration: OrganizationActionDeclaration<Schema>,
	handler: (
		context: OrganizationActionContext<OrganizationActionInput<Schema>>,
	) => Effect.Effect<T, AnyAppError, AppServices>,
): (...args: ActionArgs<Schema>) => Promise<ServerActionResult<T>> {
	const action = (...args: ActionArgs<Schema>) =>
		trace
			.getTracer("organization-action")
			.startActiveSpan(
				declaration.name,
				{ attributes: { "settings.requires": declaration.requires } },
				async (span) => {
					try {
						const result = await runServerActionSafe(
							authorizeAndRun(declaration, handler, args[0]),
						);
						span.setStatus(
							result.success
								? { code: SpanStatusCode.OK }
								: { code: SpanStatusCode.ERROR, message: result.code ?? result.error },
						);
						return result;
					} finally {
						span.end();
					}
				},
			);
	Object.defineProperty(action, PRODUCED_BY_ORGANIZATION_ACTION, { value: true });
	return action;
}

function authorizeAndRun<Schema extends InputSchema, T>(
	declaration: OrganizationActionDeclaration<Schema>,
	handler: (
		context: OrganizationActionContext<OrganizationActionInput<Schema>>,
	) => Effect.Effect<T, AnyAppError, AppServices>,
	rawInput: unknown,
): Effect.Effect<T, AnyAppError, AppServices> {
	return Effect.gen(function* () {
		const caller = yield* resolveCallerSettingsAccess();
		const require = (level: SettingsAccess) =>
			meetsSettingsAccess(caller.settingsAccess, level)
				? Effect.void
				: Effect.fail(
						new AuthorizationError({
							message: "You do not have access to this setting",
							userId: caller.userId,
							resource: declaration.name,
							action: level,
						}),
					);
		yield* require(declaration.requires);
		// Past `require`, the caller has settings access.
		const settingsAccess = caller.settingsAccess as SettingsAccess;

		const input = yield* parseInput(declaration.schema, rawInput);
		if (declaration.addsEmployees) {
			yield* ensureOnCurrentRoster(yield* DatabaseService, {
				organizationId: caller.organizationId,
				employeeIds: declaration.addsEmployees(input),
				field: "employeeIds",
			});
		}

		const managedScope = yield* Effect.cached(
			loadManagedScope({
				organizationId: caller.organizationId,
				settingsAccess,
				employeeId: caller.employee?.id ?? null,
			}),
		);
		const actor: OrganizationActor = {
			userId: caller.userId,
			membershipRole: caller.membershipRole ?? "",
			employee: caller.employee,
			settingsAccess,
			require,
			managedScope: () => managedScope,
		};
		return yield* handler({ actor, organizationId: caller.organizationId, input });
	});
}

/** True for a function `organizationAction` produced; the settings coverage test relies on it. */
export function isOrganizationAction(value: unknown): boolean {
	return (
		typeof value === "function" &&
		(value as unknown as Record<symbol, unknown>)[PRODUCED_BY_ORGANIZATION_ACTION] === true
	);
}

function parseInput<Schema extends InputSchema>(
	schema: Schema,
	value: unknown,
): Effect.Effect<OrganizationActionInput<Schema>, ValidationError> {
	if (schema === noInput) return Effect.succeed(undefined as OrganizationActionInput<Schema>);
	const result = (schema as z.ZodType).safeParse(value);
	if (result.success) return Effect.succeed(result.data as OrganizationActionInput<Schema>);
	const issue = result.error.issues[0];
	return Effect.fail(
		new ValidationError({
			message: issue?.message ?? "Invalid input",
			field: issue?.path.join(".") || "input",
		}),
	);
}
