import { type Effect, Layer, ManagedRuntime } from "effect";
import { AuthServiceLive } from "./services/auth.service";
import { DatabaseServiceLive } from "./services/database.service";
import { EmailServiceLive } from "./services/email.service";
import { AnalyticsService } from "./services/analytics.service";
import { ReportingService } from "./services/reporting.service";
import { OnboardingServiceLive } from "./services/onboarding.service";
import { PermissionsServiceLive } from "./services/permissions.service";
import { ManagerServiceLive } from "./services/manager.service";
import { TimeEntryServiceLive } from "./services/time-entry.service";

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
const PermissionsLayer = PermissionsServiceLive.pipe(
	Layer.provide(DatabaseServiceLive),
);

// Layer for ManagerService (depends on DatabaseService)
const ManagerLayer = ManagerServiceLive.pipe(
	Layer.provide(DatabaseServiceLive),
);

// Layer for TimeEntryService (depends on DatabaseService)
const TimeEntryLayer = TimeEntryServiceLive.pipe(
	Layer.provide(DatabaseServiceLive),
);

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
);

// Runtime for executing effects
export const runtime = ManagedRuntime.make(AppLayer);

// Helper to run effects in server actions
export function runServerAction<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
	return runtime.runPromise(effect);
}
