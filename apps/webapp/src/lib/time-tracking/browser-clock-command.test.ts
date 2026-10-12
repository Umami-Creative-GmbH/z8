import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	type BrowserClockCommandCapabilities,
	clockConnectionRequired,
	frozenClockCommandsAvailable,
	isClockConnectionRequired,
	offlineClockCaptureAllowed,
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

	it("carries an explicit billable choice and omits it otherwise (#900)", () => {
		const input = {
			kind: "clock_out" as const,
			operationId,
			capabilities,
			session,
			now,
			timezone: "Europe/Berlin",
			projectId,
		};
		expect(prepareBrowserClockCommand({ ...input, billable: true })).toMatchObject({
			ok: true,
			request: { project: { kind: "replace", id: projectId }, billable: true },
		});
		const prepared = prepareBrowserClockCommand(input);
		expect(prepared.ok && prepared.request).not.toHaveProperty("billable");
	});

	it("names a task only when the page names one (#875)", () => {
		const taskId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
		const clockOut = (task: { taskId?: string | null }) =>
			prepareBrowserClockCommand({
				kind: "clock_out",
				operationId,
				capabilities,
				session,
				now,
				timezone: "UTC",
				projectId,
				...task,
			});

		expect(clockOut({ taskId })).toMatchObject({
			ok: true,
			request: { task: { kind: "replace", id: taskId } },
		});
		expect(clockOut({ taskId: null })).toMatchObject({
			ok: true,
			request: { task: { kind: "clear" } },
		});
		const omitted = clockOut({});
		expect(omitted.ok && "task" in omitted.request).toBe(false);
		expect(clockOut({ taskId: "not-a-uuid" })).toEqual({
			ok: false,
			reason: "attribution_unsupported",
		});
	});

	it("carries the position taken at the event when the server accepts version 3 (#826)", () => {
		const position = {
			latitude: 52.520008,
			longitude: 13.404954,
			accuracyMeters: 18.5,
			fixedAt: "2026-09-25T08:15:29.000Z",
		};
		const prepare = (commandVersions: number[]) =>
			prepareBrowserClockCommand({
				kind: "clock_in",
				operationId,
				capabilities: { ...capabilities, commandVersions },
				session,
				now,
				timezone: "Europe/Berlin",
				position,
			});

		expect(prepare([2, 3])).toMatchObject({ ok: true, request: { position } });
		// An older server keeps the unstamped version: the event is never held for a position.
		const unstamped = prepare([2]);
		expect(unstamped.ok).toBe(true);
		expect(unstamped.ok && unstamped.request).not.toHaveProperty("position");
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
	/** A translator that records the keys it words and falls back to English. */
	const translated: string[] = [];
	const translate = (key: string, fallback: string, params: Record<string, string> = {}) => {
		translated.push(key);
		return fallback.replace(/\{(\w+)\}/g, (_match, name: string) => params[name] ?? "");
	};
	const readResult = (record: Parameters<typeof toBrowserClockActionResult>[0]) =>
		toBrowserClockActionResult(record, translate);

	it("reports a committed clock-out with its entry and post-commit advice", () => {
		expect(
			readResult({
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
			readResult({
				state: "committed",
				kind: "clock_in",
				receipt: { kind: "start_live_work", result: { clockInEntryId: "entry-in" } },
			}),
		).toEqual({ success: true, data: { id: "entry-in" } });
	});

	it("reports an attended rejection as a failure with its code and holiday", () => {
		expect(
			readResult({
				state: "rejected",
				kind: "clock_in",
				lastOutcome: { kind: "rejected", code: "not_allowed_at_time", holidayName: "Neujahr" },
			}),
		).toEqual({
			success: false,
			code: "not_allowed_at_time",
			holidayName: "Neujahr",
			error: "Cannot clock in on Neujahr",
		});
		expect(
			readResult({
				state: "rejected",
				kind: "clock_out",
				lastOutcome: { kind: "rejected", code: "append_review_required" },
			}),
		).toMatchObject({
			success: false,
			code: "append_review_required",
			error:
				"Your time history needs review before you can clock out. Please contact your administrator.",
		});
	});

	it("words every rejection in the timeTracking namespace, unknown codes included", () => {
		translated.length = 0;
		for (const code of ["target_not_active", "not_adopted", "not_allowed_at_time"]) {
			readResult({ state: "rejected", kind: "clock_out", lastOutcome: { kind: "rejected", code } });
		}

		expect(translated).toEqual([
			"timeTracking.errors.clockTargetNotActive",
			"timeTracking.errors.clockCommandRejected",
			"timeTracking.errors.clockNotAllowedAtTime",
		]);
	});

	it.each(["pending", "exhausted", "review_required"] as const)(
		"reports a saved but unconfirmed %s command as queued, never as a failed save",
		(state) => {
			expect(
				readResult({
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
		expect(readResult(null)).toEqual({
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

describe("offlineClockCaptureAllowed (#845)", () => {
	it("allows offline capture only where the last capabilities for this context say adopted", () => {
		expect(offlineClockCaptureAllowed(capabilities, session)).toBe(true);
		// Never read for this context: treated as not adopted.
		expect(offlineClockCaptureAllowed(null, session)).toBe(false);
		expect(offlineClockCaptureAllowed(undefined, session)).toBe(false);
		expect(offlineClockCaptureAllowed({ ...capabilities, submit: "unavailable" }, session)).toBe(
			false,
		);
		expect(offlineClockCaptureAllowed(capabilities, { ...session, organizationId: "org-2" })).toBe(
			false,
		);
		expect(offlineClockCaptureAllowed(capabilities, { ...session, userId: "user-2" })).toBe(false);
	});

	it("words the refusal as needing a connection, distinct from other failures", () => {
		const refused = clockConnectionRequired();
		expect(refused).toEqual({
			success: false,
			code: "connection_required",
			error: "Clocking needs a connection in this organization. Reconnect and try again.",
		});
		expect(isClockConnectionRequired(refused)).toBe(true);
		expect(isClockConnectionRequired({ success: false, code: "already_clocked_in" })).toBe(false);
		expect(isClockConnectionRequired({ success: true })).toBe(false);
	});
});
