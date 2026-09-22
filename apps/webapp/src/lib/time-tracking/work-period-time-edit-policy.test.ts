import { describe, expect, it } from "vitest";
import {
	haveWorkPeriodDatesChanged,
	haveWorkPeriodTimesChanged,
	resolveWorkPeriodTimeEditAccess,
	resolveWorkPeriodTimeEditRoute,
} from "./work-period-time-edit-policy";

const baseInput = {
	isOrgAdmin: false,
	isOwnEntry: true,
	isCompleted: true,
	approvalStatus: "approved" as const,
	hasPendingCorrection: false,
	capability: { type: "direct", reason: "within_self_service" } as const,
};

describe("resolveWorkPeriodTimeEditAccess", () => {
	it("lets organization admins edit any completed entry regardless of the change policy", () => {
		expect(
			resolveWorkPeriodTimeEditAccess({
				...baseInput,
				isOrgAdmin: true,
				isOwnEntry: false,
				capability: {
					type: "forbidden",
					reason: "beyond_approval_window",
					daysBack: 400,
				},
			}),
		).toEqual({ kind: "admin" });
	});

	it("blocks non-admins from editing other employees' entries", () => {
		expect(
			resolveWorkPeriodTimeEditAccess({ ...baseInput, isOwnEntry: false }),
		).toEqual({ kind: "blocked", reason: "not_owner" });
	});

	it("blocks running work periods for everyone", () => {
		expect(
			resolveWorkPeriodTimeEditAccess({
				...baseInput,
				isOrgAdmin: true,
				isCompleted: false,
			}),
		).toEqual({ kind: "blocked", reason: "running" });
	});

	it("blocks entries with a pending correction or pending approval", () => {
		expect(
			resolveWorkPeriodTimeEditAccess({
				...baseInput,
				isOrgAdmin: true,
				hasPendingCorrection: true,
			}),
		).toEqual({ kind: "blocked", reason: "pending_correction" });
		expect(
			resolveWorkPeriodTimeEditAccess({
				...baseInput,
				approvalStatus: "pending",
			}),
		).toEqual({ kind: "blocked", reason: "pending_approval" });
	});

	it("maps the resolved change policy for employees", () => {
		expect(resolveWorkPeriodTimeEditAccess(baseInput)).toEqual({
			kind: "self_service",
		});
		expect(
			resolveWorkPeriodTimeEditAccess({
				...baseInput,
				capability: {
					type: "approval_required",
					reason: "within_approval_window",
				},
			}),
		).toEqual({ kind: "approval" });
		expect(
			resolveWorkPeriodTimeEditAccess({
				...baseInput,
				capability: {
					type: "forbidden",
					reason: "beyond_approval_window",
					daysBack: 12,
				},
			}),
		).toEqual({
			kind: "blocked",
			reason: "beyond_approval_window",
			daysBack: 12,
		});
	});

	it("falls back to approval when no capability is available", () => {
		expect(
			resolveWorkPeriodTimeEditAccess({ ...baseInput, capability: null }),
		).toEqual({ kind: "approval" });
	});
});

describe("resolveWorkPeriodTimeEditRoute", () => {
	it("applies admin edits directly, even when dates change", () => {
		expect(
			resolveWorkPeriodTimeEditRoute({ kind: "admin" }, { datesChanged: true }),
		).toBe("admin_direct");
	});

	it("routes self-service date changes through approval", () => {
		expect(
			resolveWorkPeriodTimeEditRoute(
				{ kind: "self_service" },
				{ datesChanged: false },
			),
		).toBe("self_service_direct");
		expect(
			resolveWorkPeriodTimeEditRoute(
				{ kind: "self_service" },
				{ datesChanged: true },
			),
		).toBe("approval_request");
	});

	it("always requests approval inside the approval window", () => {
		expect(
			resolveWorkPeriodTimeEditRoute(
				{ kind: "approval" },
				{ datesChanged: false },
			),
		).toBe("approval_request");
	});

	it("returns no route when editing is blocked", () => {
		expect(
			resolveWorkPeriodTimeEditRoute(
				{ kind: "blocked", reason: "not_owner" },
				{ datesChanged: false },
			),
		).toBeNull();
	});
});

describe("work period value comparison", () => {
	const original = {
		clockInDate: "2026-09-01",
		clockInTime: "09:00",
		clockOutDate: "2026-09-01",
		clockOutTime: "17:00",
	};

	it("detects date and time changes separately", () => {
		const timeOnly = { ...original, clockOutTime: "17:30" };
		const dateMove = { ...original, clockInDate: "2026-09-02" };

		expect(haveWorkPeriodDatesChanged(original, timeOnly)).toBe(false);
		expect(haveWorkPeriodTimesChanged(original, timeOnly)).toBe(true);
		expect(haveWorkPeriodDatesChanged(original, dateMove)).toBe(true);
		expect(haveWorkPeriodTimesChanged(original, original)).toBe(false);
	});
});
