// Frozen Effect v3 copy (#625). The v4 version is lib/effect/runtime.ts.
// Make any change in both copies until #633 deletes lib/effect-v3.
import { type Effect, Exit, Layer, ManagedRuntime } from "effect-v3";
import type { ActionState } from "@/lib/effect/runtime";
import { createLogger } from "@/lib/logger";
import { AuthServiceLive } from "./services/auth.service";
import { DatabaseServiceLive } from "./services/database.service";
import { EmailServiceLive } from "./services/email.service";

// Base layer with DatabaseService (no dependencies)
const BaseLayer = DatabaseServiceLive;

// Layer for AuthService (depends on nothing external)
const AuthLayer = AuthServiceLive;

// Combine all service layers
export const AppLayer = Layer.mergeAll(BaseLayer, AuthLayer, EmailServiceLive);

// Runtime for executing effects
export const runtime = ManagedRuntime.make(AppLayer);

const logger = createLogger("ActionRuntime");

export type { ActionState } from "@/lib/effect/runtime";

/**
 * Safely executes an Effect in a Server Action context.
 * Catches all defects/failures and returns a standardized ActionState.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

	// Try to extract a meaningful error message
	// If it's a known application error (string or object with message), use it
	// Otherwise fallback to generic error
	// Note: You can expand this to check for specific Error classes in your domain
	return {
		success: false,
		error: "An unexpected error occurred. Please try again.",
	};
}

// Helper to run effects in server actions (Classic mode - throws errors)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function runServerAction<A, E>(
	// biome-ignore lint/suspicious/noExplicitAny: it is what it is
	effect: Effect.Effect<A, E, any>,
): Promise<A> {
	return runtime.runPromise(effect);
}

// Alias for runServerAction - used in calculations and other modules
export const runEffect = runServerAction;
