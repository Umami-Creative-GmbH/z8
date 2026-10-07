import { Layer, ManagedRuntime } from "effect";
import { AnalyticsService } from "./services/analytics.service";
import { AuthServiceLive } from "./services/auth.service";
import { ChangePolicyServiceLive } from "./services/change-policy.service";
import { CoverageServiceLive } from "./services/coverage.service";
import { CustomRoleServiceLive } from "./services/custom-role.service";
import { DatabaseServiceLive } from "./services/database.service";
import { EmailServiceLive } from "./services/email.service";
import { ManagerServiceLive } from "./services/manager.service";
import { OnboardingServiceLive } from "./services/onboarding.service";
import { PermissionsServiceLive } from "./services/permissions.service";
import { PlatformAdminServiceLive } from "./services/platform-admin.service";
import { SetupServiceLive } from "./services/setup.service";
import { ShiftServiceLive } from "./services/shift.service";
import { ShiftRequestServiceLive } from "./services/shift-request.service";
import { SkillServiceLive } from "./services/skill.service";
import { TimeEntryServiceLive } from "./services/time-entry.service";
import { WorkPolicyServiceLive } from "./services/work-policy.service";

export const AppLayer = Layer.mergeAll(
	DatabaseServiceLive,
	AuthServiceLive,
	EmailServiceLive,
	AnalyticsService.Live.pipe(
		Layer.provide(WorkPolicyServiceLive),
		Layer.provide(DatabaseServiceLive),
	),
	TimeEntryServiceLive.pipe(Layer.provide(DatabaseServiceLive)),
	PlatformAdminServiceLive.pipe(Layer.provide(DatabaseServiceLive)),
	SetupServiceLive.pipe(Layer.provide(DatabaseServiceLive)),
	CustomRoleServiceLive.pipe(Layer.provide(DatabaseServiceLive)),
	OnboardingServiceLive.pipe(Layer.provide(AuthServiceLive), Layer.provide(DatabaseServiceLive)),
	ChangePolicyServiceLive.pipe(Layer.provide(DatabaseServiceLive)),
	WorkPolicyServiceLive.pipe(Layer.provide(DatabaseServiceLive)),
	PermissionsServiceLive.pipe(Layer.provide(DatabaseServiceLive)),
	ManagerServiceLive.pipe(Layer.provide(DatabaseServiceLive)),
	ShiftServiceLive.pipe(Layer.provide(DatabaseServiceLive)),
	ShiftRequestServiceLive.pipe(Layer.provide(DatabaseServiceLive)),
	SkillServiceLive.pipe(Layer.provide(DatabaseServiceLive)),
	CoverageServiceLive.pipe(Layer.provide(DatabaseServiceLive)),
);

// Runtime for executing effects
export const runtime = ManagedRuntime.make(AppLayer);
