import { type Effect, Layer, ManagedRuntime } from "effect";
import { AuthServiceLive } from "./services/auth.service";
import { DatabaseServiceLive } from "./services/database.service";
import { EmailServiceLive } from "./services/email.service";
import { AnalyticsService } from "./services/analytics.service";
import { ReportingService } from "./services/reporting.service";
import { OnboardingServiceLive } from "./services/onboarding.service";

// Combine all service layers
export const AppLayer = Layer.mergeAll(
	DatabaseServiceLive,
	EmailServiceLive,
	AuthServiceLive,
	AnalyticsService.Live,
	ReportingService.Live,
	OnboardingServiceLive,
).pipe(Layer.provide(DatabaseServiceLive)); // Provide DatabaseService where needed

// Runtime for executing effects
export const runtime = ManagedRuntime.make(AppLayer);

// Helper to run effects in server actions
export function runServerAction<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
	return runtime.runPromise(effect);
}
