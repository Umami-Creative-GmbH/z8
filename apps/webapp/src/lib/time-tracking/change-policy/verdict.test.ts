import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	type AppliedChangePolicy,
	calendarDaysBack,
	decideChangePolicyVerdict,
	editCapabilityOf,
	manualApprovalIntentOf,
} from "./verdict";

const policy: AppliedChangePolicy = {
	policyId: "policy-1",
	policyName: "Two then three",
	assignmentId: "assignment-1",
	level: "organization",
	selfServiceDays: 2,
	approvalDays: 3,
	noApprovalRequired: false,
	notifyAllManagers: false,
};

describe("calendarDaysBack", () => {
	const back = (end: string | null, now: string, zone = "Europe/Berlin") =>
		calendarDaysBack(end === null ? null : parseInstant(end), parseInstant(now), zone);

	it("counts calendar days from the work's local end date to today's local date in the zone", () => {
		expect(back("2026-09-24T21:00:00Z", "2026-09-24T21:59:00Z")).toBe(0);
		expect(back("2026-09-24T21:00:00Z", "2026-09-24T22:00:00Z")).toBe(1);
		expect(back("2026-09-24T21:00:00Z", "2026-09-25T22:00:00Z")).toBe(2);
		expect(back("2026-09-24T21:00:00Z", "2026-09-25T22:00:00Z", "UTC")).toBe(1);
	});

	it("counts whole calendar days across both daylight saving changes", () => {
		// Berlin springs forward on 2026-03-29 (a 23-hour day) and falls back on 2026-10-25 (25 hours).
		expect(back("2026-03-28T22:30:00Z", "2026-03-29T22:30:00Z")).toBe(2);
		expect(back("2026-03-28T12:00:00Z", "2026-03-30T00:30:00Z")).toBe(2);
		expect(back("2026-10-24T12:00:00Z", "2026-10-25T22:59:00Z")).toBe(1);
		expect(back("2026-10-24T12:00:00Z", "2026-10-25T23:00:00Z")).toBe(2);
	});

	it("puts work that ends exactly at local midnight on the day that begins there", () => {
		// 22:00Z is 00:00 in Berlin on the 25th.
		expect(back("2026-09-24T22:00:00Z", "2026-09-25T08:00:00Z")).toBe(0);
		expect(back("2026-09-24T21:59:59Z", "2026-09-25T08:00:00Z")).toBe(1);
	});

	it("counts live work, which has no end yet, as zero days back", () => {
		expect(back(null, "2026-09-25T08:00:00Z")).toBe(0);
	});
});

describe("decideChangePolicyVerdict", () => {
	const decide = (
		daysBack: number,
		over: Partial<Parameters<typeof decideChangePolicyVerdict>[0]> = {},
	) => decideChangePolicyVerdict({ exemption: null, policy, daysBack, ...over });

	it.each([
		[0, "direct", "within_self_service"],
		[2, "direct", "within_self_service"],
		[3, "approval_required", "within_approval_window"],
		[5, "approval_required", "within_approval_window"],
		[6, "forbidden", "beyond_approval_window"],
		[90, "forbidden", "beyond_approval_window"],
	] as const)("%i days back under 2 self-service and 3 approval days is %s", (daysBack, type, reason) => {
		expect(decide(daysBack)).toEqual({ type, reason, daysBack, policy });
	});

	it("requires approval from the first day when the self-service window is zero days", () => {
		const sameDayOnly = { ...policy, selfServiceDays: 0, approvalDays: 7 };
		expect(decide(0, { policy: sameDayOnly }).type).toBe("direct");
		expect(decide(1, { policy: sameDayOnly }).type).toBe("approval_required");
	});

	it("is direct without a policy, whatever the age", () => {
		expect(decide(90, { policy: null })).toEqual({
			type: "direct",
			reason: "no_policy",
			daysBack: 90,
			policy: null,
		});
	});

	it("is direct in trust mode, whatever the age", () => {
		const trusting = { ...policy, noApprovalRequired: true };
		expect(decide(90, { policy: trusting })).toEqual({
			type: "direct",
			reason: "trust_mode",
			daysBack: 90,
			policy: trusting,
		});
	});

	it.each(["on_behalf", "owner_admin_self"] as const)(
		"is direct for the %s exemption and names it as the reason",
		(exemption) => {
			expect(decide(90, { exemption })).toMatchObject({ type: "direct", reason: exemption });
		},
	);
});

describe("manualApprovalIntentOf", () => {
	const intentAt = (daysBack: number, exemption: "on_behalf" | "owner_admin_self" | null = null) =>
		manualApprovalIntentOf(decideChangePolicyVerdict({ exemption, policy, daysBack }));

	it("records a manual entry directly wherever an edit would be direct", () => {
		expect(intentAt(2)).toEqual({ intent: "direct", reason: "within_self_service" });
		expect(intentAt(90, "on_behalf")).toEqual({ intent: "direct", reason: "on_behalf" });
		expect(intentAt(90, "owner_admin_self")).toEqual({
			intent: "direct",
			reason: "owner_admin_self",
		});
	});

	it("needs approval inside the approval window", () => {
		expect(intentAt(3)).toEqual({ intent: "approval", reason: "within_approval_window" });
	});

	it("needs approval beyond the approval window, where an edit is refused", () => {
		expect(intentAt(6)).toEqual({ intent: "approval", reason: "beyond_approval_window" });
	});
});

describe("editCapabilityOf", () => {
	it("keeps the outcome and reason and leaves the policy out", () => {
		expect(editCapabilityOf(decideChangePolicyVerdict({ exemption: null, policy, daysBack: 3 }))).toEqual({
			type: "approval_required",
			reason: "within_approval_window",
		});
	});

	it("carries the days back only when the edit is refused", () => {
		expect(editCapabilityOf(decideChangePolicyVerdict({ exemption: null, policy, daysBack: 6 }))).toEqual({
			type: "forbidden",
			reason: "beyond_approval_window",
			daysBack: 6,
		});
	});
});
