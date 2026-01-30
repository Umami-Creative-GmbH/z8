import { type Effect, Layer, ManagedRuntime, Exit } from "effect";
import { createLogger } from "../logger";
import { AnalyticsService } from "./services/analytics.service";
import { AppAccessServiceLive } from "./services/app-access.service";
import { AuthServiceLive } from "./services/auth.service";
import { ChangePolicyServiceLive } from "./services/change-policy.service";
import { DatabaseServiceLive } from "./services/database.service";
import { EmailServiceLive } from "./services/email.service";
import { ManagerServiceLive } from "./services/manager.service";
import { OnboardingServiceLive } from "./services/onboarding.service";
import { PermissionsServiceLive } from "./services/permissions.service";
import { ReportingService } from "./services/reporting.service";
import { ShiftServiceLive } from "./services/shift.service";
import { ShiftRequestServiceLive } from "./services/shift-request.service";
import { TimeEntryServiceLive } from "./services/time-entry.service";
import { WorkPolicyServiceLive } from "./services/work-policy.service";

// Base layer with DatabaseService (no dependencies)
const BaseLayer = DatabaseServiceLive;

// Layer for AuthService (depends on nothing external)
const AuthLayer = AuthServiceLive;

// Layer for services that depend on DatabaseService and AuthService
const OnboardingLayer = OnboardingServiceLive.pipe(
	Layer.provide(AuthServiceLive),
	Layer.provide(DatabaseServiceLive),
);

// Layer for PermissionsService (depends on DatabaseService)
const PermissionsLayer = PermissionsServiceLive.pipe(Layer.provide(DatabaseServiceLive));

// Layer for ManagerService (depends on DatabaseService)
const ManagerLayer = ManagerServiceLive.pipe(Layer.provide(DatabaseServiceLive));

// Layer for TimeEntryService (depends on DatabaseService)
const TimeEntryLayer = TimeEntryServiceLive.pipe(Layer.provide(DatabaseServiceLive));

// Layer for ShiftService (depends on DatabaseService)
const ShiftLayer = ShiftServiceLive.pipe(Layer.provide(DatabaseServiceLive));

// Layer for ShiftRequestService (depends on DatabaseService)
const ShiftRequestLayer = ShiftRequestServiceLive.pipe(Layer.provide(DatabaseServiceLive));

// Layer for ChangePolicyService (depends on DatabaseService)
const ChangePolicyLayer = ChangePolicyServiceLive.pipe(Layer.provide(DatabaseServiceLive));

// Layer for WorkPolicyService (depends on DatabaseService)
const WorkPolicyLayer = WorkPolicyServiceLive.pipe(Layer.provide(DatabaseServiceLive));

// Layer for AppAccessService (depends on DatabaseService)
const AppAccessLayer = AppAccessServiceLive.pipe(Layer.provide(DatabaseServiceLive));

// Combine all service layers
export const AppLayer = Layer.mergeAll(
	BaseLayer,
	AuthLayer,
	EmailServiceLive,
	AnalyticsService.Live.pipe(Layer.provide(DatabaseServiceLive)),
	ReportingService.Live.pipe(Layer.provide(DatabaseServiceLive)),
	OnboardingLayer,
	PermissionsLayer,
	ManagerLayer,
	TimeEntryLayer,
	ShiftLayer,
	ShiftRequestLayer,
	ChangePolicyLayer,
	WorkPolicyLayer,
	AppAccessLayer,
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function safeAction<A, E>(effect: Effect.Effect<A, E, any>): Promise<ActionState<A>> {
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
export function runServerAction<A, E>(effect: Effect.Effect<A, E, any>): Promise<A> {
	return runtime.runPromise(effect);
}

// Alias for runServerAction - used in calculations and other modules
export const runEffect = runServerAction;
