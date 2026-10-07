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

// DatabaseServiceLive reaches every member through the one provideMerge, which also
// keeps it in the output.
export const AppLayer = Layer.mergeAll(
	AuthServiceLive,
	EmailServiceLive,
	AnalyticsService.Live.pipe(Layer.provide(WorkPolicyServiceLive)),
	TimeEntryServiceLive,
	PlatformAdminServiceLive,
	SetupServiceLive,
	CustomRoleServiceLive,
	OnboardingServiceLive.pipe(Layer.provide(AuthServiceLive)),
	ChangePolicyServiceLive,
	WorkPolicyServiceLive,
	PermissionsServiceLive,
	ManagerServiceLive,
	ShiftServiceLive,
	ShiftRequestServiceLive,
	SkillServiceLive,
	CoverageServiceLive,
).pipe(Layer.provideMerge(DatabaseServiceLive));

// Runtime for executing effects
export const runtime = ManagedRuntime.make(AppLayer);
