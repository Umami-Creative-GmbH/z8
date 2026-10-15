"use server";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { employee } from "@/db/schema";
import { requireOrganizationAdmin } from "@/lib/auth/current-organization-actor";
import { systemClock } from "@/lib/datetime/temporal-core";
import { runRefusalAction } from "@/lib/effect/refusal-action";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { NotFoundError } from "@/lib/effect/errors";
import {
	commitEmployeeTrackingDate,
	loadEmployeeTrackingDateSettings,
	previewEmployeeTrackingDate,
	type EmployeeTrackingDateSettings,
	type EmployeeTrackingProposal,
} from "@/lib/time-tracking/employee-tracking-date";
import {
	TrackingDateRefusal,
	type TrackingDateActionResult,
	type TrackingDateImpact,
} from "@/lib/time-tracking/tracking-date-review-types";
import {
	ensureSettingsActorCanAccessEmployeeTarget,
	getEmployeeSettingsActorContext,
} from "./employee-action-utils";
import { refreshTrackingDateResults } from "@/lib/time-tracking/tracking-date-refresh";
const denied = () =>
	new TrackingDateRefusal(
		"not_permitted",
		"Only an organization admin can change employee tracking dates.",
	);
export async function getEmployeeTrackingDateAction(
	employeeId: string,
): Promise<ServerActionResult<EmployeeTrackingDateSettings & { canManage: boolean }>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const actor = yield* getEmployeeSettingsActorContext({
				queryName: "employeeTrackingDates.read",
			});
			const target = yield* actor.dbService.query("employeeTrackingDates.target", () =>
				actor.dbService.db.query.employee.findFirst({
					where: and(
						eq(employee.id, employeeId),
						eq(employee.organizationId, actor.organizationId),
					),
				}),
			);
			if (!target)
				return yield* Effect.fail(
					new NotFoundError({
						message: "Employee not found",
						entityType: "employee",
						entityId: employeeId,
					}),
				);
			yield* ensureSettingsActorCanAccessEmployeeTarget(actor, target, {
				message: "You do not have access to this employee",
				resource: "employee",
				action: "read",
			});
			const settings = yield* actor.dbService.query("employeeTrackingDates.settings", () =>
				loadEmployeeTrackingDateSettings(actor.dbService.db, {
					organizationId: actor.organizationId,
					employeeId,
				}),
			);
			return { ...settings, canManage: actor.accessTier === "orgAdmin" };
		}),
	);
}
export async function previewEmployeeTrackingDateAction(
	input: EmployeeTrackingProposal,
): Promise<TrackingDateActionResult<TrackingDateImpact>> {
	return runRefusalAction(
		"employeeTrackingDates.preview",
		TrackingDateRefusal,
		async (database) => {
			const actor = await requireOrganizationAdmin(denied);
			return previewEmployeeTrackingDate(database, {
				...input,
				organizationId: actor.organizationId,
				actorUserId: actor.userId,
				now: systemClock.nowInstant(),
			});
		},
	);
}
export async function commitEmployeeTrackingDateAction(
	input: EmployeeTrackingProposal & { fingerprint: string; reason: string },
): Promise<TrackingDateActionResult<{ status: "committed"; refreshPending: boolean }>> {
	return runRefusalAction("employeeTrackingDates.commit", TrackingDateRefusal, async (database) => {
		const actor = await requireOrganizationAdmin(denied);
		const impact = await commitEmployeeTrackingDate(database, {
			...input,
			organizationId: actor.organizationId,
			actorUserId: actor.userId,
			now: systemClock.nowInstant(),
		});
		return {
			status: "committed",
			refreshPending: await refreshTrackingDateResults(actor.organizationId, impact),
		};
	});
}
