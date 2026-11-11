import { and, eq } from "drizzle-orm";
import { organization } from "@/db/auth-schema";
import { employee, userSettings } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { resolvePersonalTimezone } from "@/lib/timezone/resolve-timezone";
import { loadChangePolicyCandidates } from "./candidates";
import { type ChangePolicyLevel, resolveChangePolicy } from "./resolution";

/**
 * Why a change policy does not apply to this change: it is made on the owner's behalf, or by an
 * organization owner or admin to their own work. The caller decides who is exempt.
 */
export type ChangePolicyExemption = "on_behalf" | "owner_admin_self";

/** The change policy that decided a verdict, with the assignment it came through. */
export type AppliedChangePolicy = {
	policyId: string;
	policyName: string;
	assignmentId: string;
	level: ChangePolicyLevel;
	selfServiceDays: number;
	approvalDays: number;
	noApprovalRequired: boolean;
	notifyAllManagers: boolean;
};

/**
 * What a change policy allows for work of a given age. `policy` is the one that decided, and is
 * null when none applies or an exemption made it irrelevant.
 */
export type ChangePolicyVerdict = {
	/** Calendar days from the work's local end date to today's, in the zone the verdict used. */
	daysBack: number;
	policy: AppliedChangePolicy | null;
} & (
	| {
			type: "direct";
			reason: ChangePolicyExemption | "no_policy" | "trust_mode" | "within_self_service";
	  }
	| { type: "approval_required"; reason: "within_approval_window" }
	| { type: "forbidden"; reason: "beyond_approval_window" }
);

/** A verdict as an editing surface shows it. */
export type EditCapability =
	| { type: "direct"; reason: "within_self_service" | "no_policy" | "trust_mode" }
	| { type: "approval_required"; reason: "within_approval_window" }
	| { type: "forbidden"; reason: "beyond_approval_window"; daysBack: number };

/** How a manual entry is recorded: at once, or as a request for approval. */
export type ManualApprovalIntent =
	| {
			intent: "direct";
			reason: ChangePolicyExemption | "no_policy" | "trust_mode" | "within_self_service";
	  }
	| { intent: "approval"; reason: "within_approval_window" | "beyond_approval_window" };

/** The work has no employee in this organization, so no change policy can be read for it. */
export class ChangePolicySubjectNotFoundError extends Error {
	constructor(readonly subject: { organizationId: string; employeeId: string }) {
		super("No employee in this organization to resolve a change policy for");
		this.name = "ChangePolicySubjectNotFoundError";
	}
}

/**
 * Calendar days from the work's local end date to `now`'s local date in the zone. Work that ends
 * exactly at local midnight belongs to the day that begins there. Live work has no end yet and is
 * zero days back.
 */
export function calendarDaysBack(end: Instant | null, now: Instant, timezone: string): number {
	if (end === null) return 0;
	return end
		.toZonedDateTimeISO(timezone)
		.toPlainDate()
		.until(now.toZonedDateTimeISO(timezone).toPlainDate(), { largestUnit: "days" }).days;
}

/**
 * The window rule. Thresholds are inclusive calendar days: up to `selfServiceDays` back the
 * change is direct, up to `approvalDays` further it needs approval, and beyond that it is
 * forbidden. An exemption, no policy and trust mode are direct at any age.
 */
export function decideChangePolicyVerdict(input: {
	exemption: ChangePolicyExemption | null;
	policy: AppliedChangePolicy | null;
	daysBack: number;
}): ChangePolicyVerdict {
	const { exemption, policy, daysBack } = input;
	if (exemption) return { type: "direct", reason: exemption, daysBack, policy };
	if (!policy) return { type: "direct", reason: "no_policy", daysBack, policy };
	if (policy.noApprovalRequired) return { type: "direct", reason: "trust_mode", daysBack, policy };
	if (daysBack <= policy.selfServiceDays) {
		return { type: "direct", reason: "within_self_service", daysBack, policy };
	}
	if (daysBack <= policy.selfServiceDays + policy.approvalDays) {
		return { type: "approval_required", reason: "within_approval_window", daysBack, policy };
	}
	return { type: "forbidden", reason: "beyond_approval_window", daysBack, policy };
}

/**
 * The verdict as a manual entry reads it (#254 §5): where an edit is forbidden by age, a manual
 * entry is still recorded, as a request for approval.
 */
export function manualApprovalIntentOf(verdict: ChangePolicyVerdict): ManualApprovalIntent {
	if (verdict.type === "direct") return { intent: "direct", reason: verdict.reason };
	return { intent: "approval", reason: verdict.reason };
}

/**
 * The verdict as an editing surface shows it. An exemption shows as no policy: the surface
 * already knows the editor is exempt.
 */
export function editCapabilityOf(verdict: ChangePolicyVerdict): EditCapability {
	if (verdict.type === "forbidden") {
		return { type: "forbidden", reason: verdict.reason, daysBack: verdict.daysBack };
	}
	if (verdict.type === "approval_required") return { type: verdict.type, reason: verdict.reason };
	if (verdict.reason === "on_behalf" || verdict.reason === "owner_admin_self") {
		return { type: "direct", reason: "no_policy" };
	}
	return { type: "direct", reason: verdict.reason };
}

/**
 * What the change policy in effect at `now` allows for one employee's work that ended at
 * `workEnd` (null for live work).
 *
 * The employee is read by ID and organization together, and an employee who is not in the
 * organization throws `ChangePolicySubjectNotFoundError`. Days back are counted in `timezone`
 * when the caller passes the zone it recorded the work in, and otherwise in the employee's own
 * zone: their user setting, then the organization's timezone.
 *
 * It reads through `reader` and opens no connection of its own, so a work transaction can pass
 * its transaction and the instant it sampled.
 */
export async function readChangePolicyVerdict(
	reader: Pick<DatabaseClient, "select">,
	input: {
		organizationId: string;
		employeeId: string;
		workEnd: Instant | null;
		now: Instant;
		exemption?: ChangePolicyExemption | null;
		timezone?: string;
	},
): Promise<ChangePolicyVerdict> {
	const [owner] = await reader
		.select({
			teamId: employee.teamId,
			userTimezone: userSettings.timezone,
			organizationTimezone: organization.timezone,
		})
		.from(employee)
		.innerJoin(organization, eq(organization.id, employee.organizationId))
		.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
		.where(
			and(eq(employee.id, input.employeeId), eq(employee.organizationId, input.organizationId)),
		)
		.limit(1);
	if (!owner) {
		throw new ChangePolicySubjectNotFoundError({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
		});
	}

	const timezone =
		input.timezone ??
		resolvePersonalTimezone({
			userTimezone: owner.userTimezone,
			organizationTimezone: owner.organizationTimezone ?? undefined,
		}).timezone;
	const daysBack = calendarDaysBack(input.workEnd, input.now, timezone);
	const exemption = input.exemption ?? null;
	if (exemption) return decideChangePolicyVerdict({ exemption, policy: null, daysBack });

	const subject = {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		teamId: owner.teamId,
	};
	const resolved = resolveChangePolicy(
		await loadChangePolicyCandidates(reader, subject),
		subject,
		input.now,
	);
	return decideChangePolicyVerdict({
		exemption: null,
		daysBack,
		policy: resolved && {
			policyId: resolved.policyId,
			policyName: resolved.policyName,
			assignmentId: resolved.assignmentId,
			level: resolved.level,
			selfServiceDays: resolved.selfServiceDays,
			approvalDays: resolved.approvalDays,
			noApprovalRequired: resolved.noApprovalRequired,
			notifyAllManagers: resolved.notifyAllManagers,
		},
	});
}
