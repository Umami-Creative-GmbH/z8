import type { PolicyClockOutSurchargeSnapshot } from "@/lib/time-tracking/policy-clock-out-surcharge-snapshot.types";
import type { DepartureTaskContext } from "./delivery";
import type { DepartureTaskClaim } from "./outbox";

export type ClockPostprocessEffects = {
	enforceBreaks(input: {
		organizationId: string;
		employeeId: string;
		workPeriodId: string;
		sessionDurationMinutes: number;
		timezone: string;
		createdBy: string;
	}): Promise<{ affectedWorkPeriodIds: string[] }>;
	reconcileSurcharges(input: {
		organizationId: string;
		employeeId: string;
		affectedWorkPeriodIds: string[];
		snapshot: PolicyClockOutSurchargeSnapshot;
	}): Promise<void>;
	markWorkBalanceDirty(input: {
		organizationId: string;
		employeeId: string;
		dirtyFromDate: string;
	}): Promise<void>;
};

type PostprocessPayload = {
	workPeriodId: string;
	durationMinutes: number;
	periodStartedAt: string;
	timezone: string;
	createdBy: string;
	surchargeSnapshot: PolicyClockOutSurchargeSnapshot | null;
	breaksEnforced?: boolean;
	affectedWorkPeriodIds?: string[];
	surchargesReconciled?: boolean;
};

function parsePayload(payload: Record<string, unknown>): PostprocessPayload {
	if (
		typeof payload.workPeriodId !== "string" ||
		typeof payload.durationMinutes !== "number" ||
		typeof payload.periodStartedAt !== "string" ||
		typeof payload.timezone !== "string" ||
		typeof payload.createdBy !== "string"
	) {
		throw new Error("invalid_clock_postprocess_payload");
	}
	return payload as unknown as PostprocessPayload;
}

/**
 * The post-clock-out work a live clock-out runs best-effort, made durable for
 * departures: break enforcement for this exact period, surcharges for the
 * periods it touched (using the snapshot taken at close), then work balance.
 * Each completed step is recorded on the task, so a retry resumes instead of
 * replaying an effect or applying it to an unrelated later period.
 */
export function createClockPostprocessHandler(effects: ClockPostprocessEffects) {
	return async (claim: DepartureTaskClaim, context: DepartureTaskContext) => {
		const payload = parsePayload(claim.payload);
		const scope = { organizationId: claim.organizationId, employeeId: claim.employeeId };

		let affectedWorkPeriodIds = payload.affectedWorkPeriodIds ?? [payload.workPeriodId];
		if (!payload.breaksEnforced) {
			const result = await effects.enforceBreaks({
				...scope,
				workPeriodId: payload.workPeriodId,
				sessionDurationMinutes: payload.durationMinutes,
				timezone: payload.timezone,
				createdBy: payload.createdBy,
			});
			affectedWorkPeriodIds = result.affectedWorkPeriodIds;
			await context.recordProgress({ breaksEnforced: true, affectedWorkPeriodIds });
		}

		if (!payload.surchargesReconciled && payload.surchargeSnapshot) {
			await effects.reconcileSurcharges({
				...scope,
				affectedWorkPeriodIds,
				snapshot: payload.surchargeSnapshot,
			});
			await context.recordProgress({ surchargesReconciled: true });
		}

		await effects.markWorkBalanceDirty({
			...scope,
			dirtyFromDate: payload.periodStartedAt.slice(0, 10),
		});
	};
}
