import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	type BrowserClockCommandCapabilities,
	frozenClockCommandsAvailable,
	prepareBrowserClockCommand,
	toBrowserClockActionResult,
} from "./browser-clock-command";

const capabilities: BrowserClockCommandCapabilities = {
	commandVersions: [2],
	submit: "available",
	context: {
		userId: "user-1",
		organizationId: "org-1",
		employeeId: "5f0c6a52-58a4-4d5c-9b0e-5f7b8c1d2e3f",
		server: "https://z8.test",
	},
};
const session = { userId: "user-1", organizationId: "org-1", origin: "https://z8.test" };
const operationId = "0f8fad5b-d9cb-469f-a165-70867728950e";
const projectId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const now = parseInstant("2026-09-25T08:15:30.120Z");

describe("prepareBrowserClockCommand", () => {
	it("freezes a clock-in with identity, UTC instant, event zone, captured context and delayed admission", () => {
		expect(
			prepareBrowserClockCommand({
				kind: "clock_in",
				operationId,
				capabilities,
				session,
				now,
				timezone: "Europe/Berlin",
				workLocationType: "home",
			}),
		).toEqual({
			ok: true,
			request: {
				operationId,
				kind: "clock_in",
				admission: "delayed",
				occurredAt: "2026-09-25T08:15:30.120Z",
				timezone: "Europe/Berlin",
				context: capabilities.context,
				workLocationType: "home",
			},
		});
	});

	it("keeps attribution omission, clearing and replacement distinct and names the known period", () => {
		const prepared = prepareBrowserClockCommand({
			kind: "clock_out",
			operationId,
			capabilities,
			session,
			now: parseInstant("2026-09-25T08:15:00Z"),
			timezone: "Europe/Berlin",
			knownWorkPeriodId: "a3bb189e-8bf9-3888-9912-ace4e6543002",
			projectId,
			workCategoryId: null,
		});
		expect(prepared).toEqual({
			ok: true,
			request: expect.objectContaining({
				kind: "clock_out",
				occurredAt: "2026-09-25T08:15:00.000Z",
				knownWorkPeriodId: "a3bb189e-8bf9-3888-9912-ace4e6543002",
				project: { kind: "replace", id: projectId },
				workCategory: { kind: "clear" },
			}),
		});
		expect(
			prepareBrowserClockCommand({
				kind: "clock_out",
				operationId,
				capabilities,
				session,
				now,
				timezone: "Europe/Berlin",
			}),
		).toMatchObject({
			ok: true,
			request: {
				knownWorkPeriodId: null,
				project: { kind: "preserve" },
				workCategory: { kind: "preserve" },
			},
		});
	});

	it("defaults a missing work location the way the legacy clock-in does", () => {
		expect(
			prepareBrowserClockCommand({
				kind: "clock_in",
				operationId,
				capabilities,
				session,
				now,
				timezone: "UTC",
			}),
		).toMatchObject({ ok: true, request: { workLocationType: "office" } });
	});

	it.each([
		[
			"fresh submission is not adopted",
			{ ...capabilities, submit: "unavailable" as const },
			session,
			"Europe/Berlin",
			"unavailable",
		],
		[
			"version 2 is not offered",
			{ ...capabilities, commandVersions: [3] },
			session,
			"Europe/Berlin",
			"unavailable",
		],
		[
			"the server origin is unknown",
			{ ...capabilities, context: { ...capabilities.context, server: null } },
			session,
			"Europe/Berlin",
			"unavailable",
		],
		[
			"the server names another origin than this page",
			capabilities,
			{ ...session, origin: "https://other.test" },
			"Europe/Berlin",
			"unavailable",
		],
		[
			"the session switched organization",
			capabilities,
			{ ...session, organizationId: "org-2" },
			"Europe/Berlin",
			"context_changed",
		],
		[
			"the session switched account",
			capabilities,
			{ ...session, userId: "user-2" },
			"Europe/Berlin",
			"context_changed",
		],
		["the event zone is unknown", capabilities, session, null, "timezone_unknown"],
		["the event zone is not IANA", capabilities, session, "+02:00", "timezone_unknown"],
	] as const)("does not freeze when %s", (_name, caps, currentSession, timezone, reason) => {
		expect(
			prepareBrowserClockCommand({
				kind: "clock_in",
				operationId,
				capabilities: caps,
				session: currentSession,
				now,
				timezone,
			}),
		).toEqual({ ok: false, reason });
	});

	it("does not freeze attribution the v2 contract cannot represent", () => {
		expect(
			prepareBrowserClockCommand({
				kind: "clock_out",
				operationId,
				capabilities,
				session,
				now,
				timezone: "UTC",
				projectId: "not-a-uuid",
			}),
		).toEqual({ ok: false, reason: "attribution_unsupported" });
	});
});

describe("toBrowserClockActionResult", () => {
	it("reports a committed clock-out with its entry and post-commit advice", () => {
		expect(
			toBrowserClockActionResult({
				state: "committed",
				kind: "clock_out",
				receipt: {
					kind: "close_active_work",
					result: { clockOutEntryId: "entry-out", clockInEntryId: "entry-in" },
				},
				clockOut: { complianceWarnings: [], breakAdjustment: undefined },
			}),
		).toEqual({
			success: true,
			data: { id: "entry-out", complianceWarnings: [], breakAdjustment: undefined },
		});
	});

	it("reports a committed clock-in with the clock-in entry", () => {
		expect(
			toBrowserClockActionResult({
				state: "committed",
				kind: "clock_in",
				receipt: { kind: "start_live_work", result: { clockInEntryId: "entry-in" } },
			}),
		).toEqual({ success: true, data: { id: "entry-in" } });
	});

	it("reports an attended rejection as a failure with its code and holiday", () => {
		expect(
			toBrowserClockActionResult({
				state: "rejected",
				kind: "clock_in",
				lastOutcome: { kind: "rejected", code: "not_allowed_at_time", holidayName: "Neujahr" },
			}),
		).toEqual({
			success: false,
			code: "not_allowed_at_time",
			holidayName: "Neujahr",
			error: "Clocking is not allowed at this time",
		});
		expect(
			toBrowserClockActionResult({
				state: "rejected",
				kind: "clock_in",
				lastOutcome: { kind: "rejected", code: "append_review_required" },
			}),
		).toMatchObject({ success: false, code: "append_review_required" });
	});

	it.each(["pending", "exhausted", "review_required"] as const)(
		"reports a saved but unconfirmed %s command as queued, never as a failed save",
		(state) => {
			expect(
				toBrowserClockActionResult({
					state,
					kind: "clock_in",
					lastOutcome: { kind: "transient" },
				}),
			).toEqual({
				success: true,
				queued: true,
				delivery: state === "pending" ? "pending" : "held",
			});
		},
	);

	it("reports an unknown outcome after durable capture as queued", () => {
		expect(toBrowserClockActionResult(null)).toEqual({
			success: true,
			queued: true,
			delivery: "pending",
		});
	});
});

describe("frozenClockCommandsAvailable", () => {
	it("is true only for version 2 submission in exactly this session and origin", () => {
		expect(frozenClockCommandsAvailable(capabilities, session)).toBe(true);
		expect(frozenClockCommandsAvailable(null, session)).toBe(false);
		expect(frozenClockCommandsAvailable({ ...capabilities, submit: "unavailable" }, session)).toBe(
			false,
		);
		expect(
			frozenClockCommandsAvailable(capabilities, { ...session, organizationId: "org-2" }),
		).toBe(false);
		expect(
			frozenClockCommandsAvailable(capabilities, { ...session, origin: "https://other.test" }),
		).toBe(false);
	});
});
