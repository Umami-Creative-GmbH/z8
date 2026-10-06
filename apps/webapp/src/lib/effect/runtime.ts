import { type Effect, Exit, Layer, ManagedRuntime } from "effect";
import { createLogger } from "../logger";
import { AnalyticsService } from "./services/analytics.service";
import { AuthServiceLive } from "./services/auth.service";
import { CustomRoleServiceLive } from "./services/custom-role.service";
import { DatabaseServiceLive } from "./services/database.service";
import { EmailServiceLive } from "./services/email.service";
import { PlatformAdminServiceLive } from "./services/platform-admin.service";
import { SetupServiceLive } from "./services/setup.service";
import { TimeEntryServiceLive } from "./services/time-entry.service";

// Services move here from lib/effect-v3/runtime.ts as their slices port them to v4 (#625).
export const AppLayer = Layer.mergeAll(
	DatabaseServiceLive,
	AuthServiceLive,
	EmailServiceLive,
	AnalyticsService.Live.pipe(Layer.provide(DatabaseServiceLive)),
	TimeEntryServiceLive.pipe(Layer.provide(DatabaseServiceLive)),
	PlatformAdminServiceLive,
	SetupServiceLive,
	CustomRoleServiceLive.pipe(Layer.provide(DatabaseServiceLive)),
);

// Runtime for executing effects
export const runtime = ManagedRuntime.make(AppLayer);

const logger = createLogger("ActionRuntime");

export type ActionState<T> =
	| { success: true; data: T }
	| { success: false; error: string; code?: string };

/**
 * Safely executes an Effect in a Server Action context.
 * Catches all defects/failures and returns a standardized ActionState.
 */
export async function safeAction<A, E>(
	// biome-ignore lint/suspicious/noExplicitAny: it is what it is
	effect: Effect.Effect<A, E, any>,
): Promise<ActionState<A>> {
	const exit = await runtime.runPromiseExit(effect);

	if (Exit.isSuccess(exit)) {
		return { success: true, data: exit.value };
	}

	// Handle failure
	const failure = exit.cause;
	// Log the full failure cause to the console/observability
	logger.error({ failure }, "Action Failed");

	return {
		success: false,
		error: "An unexpected error occurred. Please try again.",
	};
}

// Helper to run effects in server actions (Classic mode - throws errors)
export function runServerAction<A, E>(
	// biome-ignore lint/suspicious/noExplicitAny: it is what it is
	effect: Effect.Effect<A, E, any>,
): Promise<A> {
	return runtime.runPromise(effect);
}

// Alias for runServerAction - used in calculations and other modules
export const runEffect = runServerAction;
