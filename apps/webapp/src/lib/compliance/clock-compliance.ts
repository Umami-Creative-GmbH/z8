import "server-only";

import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { userSettings } from "@/db/schema";
import {
	type AuthenticationError,
	AuthorizationError,
	type DatabaseError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import type { AuthService } from "@/lib/effect/services/auth.service";
import { ComplianceGuardrailService } from "@/lib/effect/services/compliance-guardrail.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { resolveCallerSettingsAccess } from "@/lib/organization-action/settings-access";
import type { ClockComplianceMode, ClockComplianceSnapshot } from "./clock-compliance-types";

/** One fresh admission for the visible clock region; never cache its authority. */
export const loadClockComplianceSnapshot = Effect.fn("compliance.clockDisplay")(function* (input: {
	expectedUserId: string | null;
	expectedOrganizationId: string | null;
	mode: ClockComplianceMode;
	currentSessionMinutes: number;
}): Effect.fn.Return<
	ClockComplianceSnapshot,
	AuthenticationError | AuthorizationError | DatabaseError | NotFoundError | ValidationError,
	AuthService | DatabaseService | ComplianceGuardrailService
> {
	const caller = yield* resolveCallerSettingsAccess();
	if (caller.settingsAccess === null) {
		return yield* Effect.fail(
			new AuthorizationError({
				message: "Approved organization membership required",
				userId: caller.userId,
			}),
		);
	}
	if (
		caller.userId !== input.expectedUserId ||
		caller.organizationId !== input.expectedOrganizationId
	) {
		return yield* Effect.fail(
			new ValidationError({
				message: "Organization context changed. Refresh to continue.",
				field: "scope",
				refusal: "context_changed",
			}),
		);
	}
	if (!caller.employee) {
		return yield* Effect.fail(
			new NotFoundError({
				message: "Employee profile not found",
				entityType: "employee",
			}),
		);
	}

	// The resolver has already loaded this actor's current employee using both
	// userId and organizationId. User preferences belong to the global user.
	const database = yield* DatabaseService;
	const settings = yield* database.query("compliance.clockTimezone", () =>
		database.db.query.userSettings.findFirst({
			where: eq(userSettings.userId, caller.userId),
			columns: { timezone: true },
		}),
	);
	const scope = {
		userId: caller.userId,
		organizationId: caller.organizationId,
		employeeId: caller.employee.id,
	};
	const service = yield* ComplianceGuardrailService;
	const params = { employeeId: scope.employeeId, timezone: settings?.timezone || "UTC" };
	if (input.mode === "active") {
		return {
			scope,
			mode: input.mode,
			restPeriod: null,
			myExceptions: [],
			alerts:
				input.currentSessionMinutes > 0
					? yield* service.getProactiveAlerts({
							...params,
							currentSessionMinutes: input.currentSessionMinutes,
						})
					: [],
		};
	}
	const { restPeriod, myExceptions } = yield* Effect.all(
		{
			restPeriod: service.checkRestPeriod(params),
			myExceptions: service.getMyExceptions({
				employeeId: scope.employeeId,
				includeExpired: false,
			}),
		},
		{ concurrency: 2 },
	);
	return { scope, mode: input.mode, restPeriod, myExceptions, alerts: [] };
});
