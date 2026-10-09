import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	captureAssignedTo,
	positionConsentDecision,
	requiresNewNoticeVersion,
	validatePositionCaptureSettings,
} from "./policy";

describe("validatePositionCaptureSettings", () => {
	it("refuses to switch capture on without a purpose statement", () => {
		expect(
			validatePositionCaptureSettings({
				enabled: true,
				purposeStatement: "   ",
				retentionDays: 90,
			}),
		).toEqual({ ok: false, reason: "purpose_required" });
	});

	it("keeps retention within 7 to 365 days", () => {
		const base = { enabled: false, purposeStatement: null };
		expect(validatePositionCaptureSettings({ ...base, retentionDays: 6 })).toEqual({
			ok: false,
			reason: "retention_out_of_range",
		});
		expect(validatePositionCaptureSettings({ ...base, retentionDays: 366 })).toEqual({
			ok: false,
			reason: "retention_out_of_range",
		});
		expect(validatePositionCaptureSettings({ ...base, retentionDays: 7.5 })).toEqual({
			ok: false,
			reason: "retention_out_of_range",
		});
		expect(validatePositionCaptureSettings({ ...base, retentionDays: 7 })).toMatchObject({
			ok: true,
		});
		expect(validatePositionCaptureSettings({ ...base, retentionDays: 365 })).toMatchObject({
			ok: true,
		});
	});

	it("trims the purpose statement and stores an empty one as none", () => {
		expect(
			validatePositionCaptureSettings({
				enabled: true,
				purposeStatement: "  Proof of on-site work for customers  ",
				retentionDays: 30,
			}),
		).toEqual({
			ok: true,
			settings: {
				enabled: true,
				purposeStatement: "Proof of on-site work for customers",
				retentionDays: 30,
			},
		});
		expect(
			validatePositionCaptureSettings({
				enabled: false,
				purposeStatement: "  ",
				retentionDays: 90,
			}),
		).toEqual({
			ok: true,
			settings: { enabled: false, purposeStatement: null, retentionDays: 90 },
		});
	});
});

describe("requiresNewNoticeVersion", () => {
	const current = { purposeStatement: "Customer proof", retentionDays: 90 };

	it("publishes the first notice once a purpose statement exists", () => {
		expect(
			requiresNewNoticeVersion(null, { purposeStatement: "Customer proof", retentionDays: 90 }),
		).toBe(true);
		expect(requiresNewNoticeVersion(null, { purposeStatement: null, retentionDays: 90 })).toBe(
			false,
		);
	});

	it("publishes a new version when the purpose statement changes", () => {
		expect(
			requiresNewNoticeVersion(current, { purposeStatement: "Site safety", retentionDays: 90 }),
		).toBe(true);
	});

	it("publishes a new version when retention gets longer, not when it gets shorter", () => {
		expect(
			requiresNewNoticeVersion(current, { purposeStatement: "Customer proof", retentionDays: 91 }),
		).toBe(true);
		expect(
			requiresNewNoticeVersion(current, { purposeStatement: "Customer proof", retentionDays: 30 }),
		).toBe(false);
	});

	it("keeps the version when nothing the employee agreed to changes", () => {
		expect(requiresNewNoticeVersion(current, { ...current })).toBe(false);
		// Clearing the purpose (only possible while capture is off) publishes nothing.
		expect(requiresNewNoticeVersion(current, { purposeStatement: null, retentionDays: 90 })).toBe(
			false,
		);
	});
});

describe("captureAssignedTo", () => {
	const employee = { employeeId: "e1", teamId: "t1" };

	it("assigns nobody while there are no assignments", () => {
		expect(captureAssignedTo(employee, [])).toBe(false);
	});

	it("lets the most specific assignment win", () => {
		const org = { assignmentType: "organization" as const, captureEnabled: true };
		const teamOff = { assignmentType: "team" as const, teamId: "t1", captureEnabled: false };
		const teamOn = { assignmentType: "team" as const, teamId: "t1", captureEnabled: true };
		const employeeOff = {
			assignmentType: "employee" as const,
			employeeId: "e1",
			captureEnabled: false,
		};

		expect(captureAssignedTo(employee, [org])).toBe(true);
		expect(captureAssignedTo(employee, [org, teamOff])).toBe(false);
		expect(captureAssignedTo(employee, [teamOn])).toBe(true);
		expect(captureAssignedTo(employee, [teamOn, employeeOff])).toBe(false);
		expect(captureAssignedTo({ employeeId: "e2", teamId: "t1" }, [teamOn, employeeOff])).toBe(true);
	});

	it("ignores assignments for other teams and employees", () => {
		expect(
			captureAssignedTo(employee, [
				{ assignmentType: "team", teamId: "t2", captureEnabled: true },
				{ assignmentType: "employee", employeeId: "e9", captureEnabled: true },
			]),
		).toBe(false);
		expect(
			captureAssignedTo({ employeeId: "e1", teamId: null }, [
				{ assignmentType: "team", teamId: "t1", captureEnabled: true },
			]),
		).toBe(false);
	});
});

describe("positionConsentDecision", () => {
	const notice = { id: "n2", version: 2 };
	const at = parseInstant("2026-10-01T08:00:00Z");
	const later = parseInstant("2026-10-02T08:00:00Z");

	it("is undecided without any record", () => {
		expect(positionConsentDecision({ notice, consents: [], declines: [] })).toEqual({
			kind: "undecided",
		});
	});

	it("is undecided without a notice", () => {
		expect(positionConsentDecision({ notice: null, consents: [], declines: [] })).toEqual({
			kind: "undecided",
		});
	});

	it("is active for an unwithdrawn consent against the current notice", () => {
		expect(
			positionConsentDecision({
				notice,
				consents: [
					{ id: "c1", noticeId: "n2", noticeVersion: 2, grantedAt: at, withdrawnAt: null },
				],
				declines: [],
			}),
		).toEqual({ kind: "active", consentId: "c1", noticeVersion: 2, grantedAt: at });
	});

	it("is lapsed when the only unwithdrawn consent is for an earlier notice", () => {
		expect(
			positionConsentDecision({
				notice,
				consents: [
					{ id: "c1", noticeId: "n1", noticeVersion: 1, grantedAt: at, withdrawnAt: null },
				],
				declines: [],
			}),
		).toEqual({ kind: "lapsed", noticeVersion: 1, grantedAt: at });
	});

	it("is withdrawn after the latest consent was withdrawn", () => {
		expect(
			positionConsentDecision({
				notice,
				consents: [
					{ id: "c1", noticeId: "n2", noticeVersion: 2, grantedAt: at, withdrawnAt: later },
				],
				declines: [],
			}),
		).toEqual({ kind: "withdrawn", noticeVersion: 2, withdrawnAt: later });
	});

	it("is declined after 'Not now' on the current notice, unless consent was given since", () => {
		expect(
			positionConsentDecision({
				notice,
				consents: [],
				declines: [{ noticeId: "n2", declinedAt: at }],
			}),
		).toEqual({ kind: "declined", noticeVersion: 2, declinedAt: at });
		expect(
			positionConsentDecision({
				notice,
				consents: [],
				declines: [{ noticeId: "n1", declinedAt: at }],
			}),
		).toEqual({ kind: "undecided" });
	});
});
