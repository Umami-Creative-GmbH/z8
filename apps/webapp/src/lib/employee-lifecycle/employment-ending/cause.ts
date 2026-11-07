import type { DeactivationReason } from "../deactivation/types";
import type { EmploymentEndingContext, EmploymentEndingPlanContext } from "./types";

/** The audit reason of an ending: `employee_departure`, or the deactivation's reason. */
export function employmentEndingReason(
	ctx: Pick<EmploymentEndingContext, "cause">,
): "employee_departure" | DeactivationReason {
	return ctx.cause.kind === "departure" ? "employee_departure" : ctx.cause.reason;
}

/** What every participant's audit row says about the ending: its reason, cause and period. */
export function employmentEndingAuditMetadata(
	ctx: Pick<EmploymentEndingContext, "cause" | "employmentPeriodId">,
): Record<string, unknown> {
	const { cause } = ctx;
	return cause.kind === "departure"
		? {
				reason: "employee_departure",
				departureId: cause.departureId,
				employmentPeriodId: ctx.employmentPeriodId,
			}
		: {
				reason: cause.reason,
				deactivationId: cause.deactivationId,
				employmentPeriodId: ctx.employmentPeriodId,
			};
}

/** The employment that ends, as the stores take it. */
export function endingEmployment(ctx: EmploymentEndingPlanContext) {
	return {
		organizationId: ctx.organizationId,
		employeeId: ctx.employeeId,
		employmentPeriodId: ctx.employmentPeriodId,
	};
}
