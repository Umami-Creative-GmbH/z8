import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	describeManualWallTime,
	evaluateManualApprovalIntent,
	interpretManualInterval,
	type ManualTimeEntryCommand,
	manualCalendarDaysBack,
	manualOccupiedLocalDates,
	parseManualTimeEntryCommand,
	resolveManualInterpretationZone,
} from "./manual-command";

const command = {
	version: 2,
	submissionId: "b0000000-0000-4000-8000-000000000001",
	targetEmployeeId: "a0000000-0000-4000-8000-000000000001",
	date: "2026-09-24",
	clockIn: { time: "08:00", occurrence: null, displayedOffsetMinutes: 120 },
	clockOut: { time: "12:30", occurrence: null, displayedOffsetMinutes: 120 },
	zone: { basis: "target", timezone: "Europe/Berlin" },
	browserTimezone: "Europe/Berlin",
	reason: "Forgot to clock in",
	projectId: null,
	workCategoryId: null,
};

describe("parseManualTimeEntryCommand", () => {
	it("accepts a complete version-2 command unchanged", () => {
		expect(parseManualTimeEntryCommand(structuredClone(command))).toEqual({
			ok: true,
			command,
		});
	});

	it.each([
		["version", { ...command, version: 1 }],
		["submissionId", { ...command, submissionId: "not-a-uuid" }],
		["targetEmployeeId", { ...command, targetEmployeeId: "" }],
		["date", { ...command, date: "2026-02-30" }],
		["date", { ...command, date: "2026-9-24" }],
		["clockIn.time", { ...command, clockIn: { ...command.clockIn, time: "8:00" } }],
		["clockIn.time", { ...command, clockIn: { ...command.clockIn, time: "24:00" } }],
		["clockOut.time", { ...command, clockOut: { ...command.clockOut, time: "12:3" } }],
		["clockIn.occurrence", { ...command, clockIn: { ...command.clockIn, occurrence: "first" } }],
		[
			"clockOut.displayedOffsetMinutes",
			{ ...command, clockOut: { ...command.clockOut, displayedOffsetMinutes: 1.5 } },
		],
		["clockIn", { ...command, clockIn: { ...command.clockIn, extra: true } }],
		["zone.timezone", { ...command, zone: { basis: "target", timezone: "Mars/Base" } }],
		["zone.timezone", { ...command, zone: { basis: "target", timezone: "+02:00" } }],
		["zone.basis", { ...command, zone: { basis: "server", timezone: "Europe/Berlin" } }],
		[
			"zone.basis",
			{
				...command,
				zone: { basis: "browser", timezone: "America/New_York" },
				browserTimezone: "Europe/Berlin",
			},
		],
		["browserTimezone", { ...command, browserTimezone: "Nowhere" }],
		["reason", { ...command, reason: "   " }],
		["reason", { ...command, reason: undefined }],
		["projectId", { ...command, projectId: "" }],
		["workCategoryId", { ...command, workCategoryId: 7 }],
		["command", { ...command, timezone: "Europe/Berlin" }],
		["command", null],
	])("rejects an invalid %s", (field, value) => {
		expect(parseManualTimeEntryCommand(value)).toEqual({
			ok: false,
			rejection: { reason: "invalid_command", field },
		});
	});
});

describe("describeManualWallTime", () => {
	it("classifies ordinary, spring-forward and repeated wall-clock times in Europe/Berlin", () => {
		expect(describeManualWallTime("2026-09-25", "08:00", "Europe/Berlin")).toEqual({
			kind: "unique",
			offsetMinutes: 120,
		});
		expect(describeManualWallTime("2026-03-29", "02:30", "Europe/Berlin")).toEqual({
			kind: "gap",
		});
		expect(describeManualWallTime("2026-10-25", "02:30", "Europe/Berlin")).toEqual({
			kind: "ambiguous",
			earlierOffsetMinutes: 120,
			laterOffsetMinutes: 60,
		});
	});
});

describe("resolveManualInterpretationZone", () => {
	const target = { timezone: "Europe/Berlin", source: "employee" as const };
	const typed = command as ManualTimeEntryCommand;

	it("interprets a confirmed target zone, capturing the browser only when it agrees", () => {
		expect(
			resolveManualInterpretationZone({ command: typed, isOwnEntry: true, targetZone: target }),
		).toEqual({ ok: true, timezone: "Europe/Berlin", captureSource: "browser" });
		expect(
			resolveManualInterpretationZone({
				command: { ...typed, browserTimezone: null },
				isOwnEntry: true,
				targetZone: target,
			}),
		).toEqual({ ok: true, timezone: "Europe/Berlin", captureSource: "user_setting" });
		expect(
			resolveManualInterpretationZone({ command: typed, isOwnEntry: false, targetZone: target }),
		).toEqual({
			ok: true,
			timezone: "Europe/Berlin",
			captureSource: "manager_target_user_setting",
		});
	});

	it("keeps a same-zone fallback-source change without reconfirmation", () => {
		expect(
			resolveManualInterpretationZone({
				command: typed,
				isOwnEntry: false,
				targetZone: { timezone: "Europe/Berlin", source: "organization" },
			}),
		).toEqual({
			ok: true,
			timezone: "Europe/Berlin",
			captureSource: "manager_target_user_setting",
		});
	});

	it("requires reconfirmation when the target's effective zone changed, even at an equal offset", () => {
		expect(
			resolveManualInterpretationZone({
				command: typed,
				isOwnEntry: true,
				targetZone: { timezone: "Europe/Paris", source: "employee" },
			}),
		).toEqual({
			ok: false,
			rejection: {
				reason: "reconfirmation_required",
				detail: "zone_changed",
				timezone: "Europe/Paris",
			},
		});
	});

	it("continues a self entry once in the browser zone, never an on-behalf entry", () => {
		const browser = {
			...typed,
			zone: { basis: "browser" as const, timezone: "America/New_York" },
			browserTimezone: "America/New_York",
		};
		expect(
			resolveManualInterpretationZone({ command: browser, isOwnEntry: true, targetZone: target }),
		).toEqual({ ok: true, timezone: "America/New_York", captureSource: "browser" });
		expect(
			resolveManualInterpretationZone({ command: browser, isOwnEntry: false, targetZone: target }),
		).toEqual({ ok: false, rejection: { reason: "invalid_command", field: "zone.basis" } });
	});
});

describe("interpretManualInterval", () => {
	const now = parseInstant("2026-11-01T12:00:00Z");
	const at = (
		date: string,
		clockIn: ManualTimeEntryCommand["clockIn"],
		clockOut: ManualTimeEntryCommand["clockOut"],
	) => ({ ...(command as ManualTimeEntryCommand), date, clockIn, clockOut });

	it("derives exact UTC endpoints, separate offsets and whole minutes", () => {
		const result = interpretManualInterval({
			command: command as ManualTimeEntryCommand,
			timezone: "Europe/Berlin",
			now,
		});
		expect(result).toMatchObject({
			ok: true,
			startOffsetMinutes: 120,
			endOffsetMinutes: 120,
			durationMinutes: 270,
		});
		if (!result.ok) throw new Error("expected an interval");
		expect(result.start.toString()).toBe("2026-09-24T06:00:00Z");
		expect(result.end.toString()).toBe("2026-09-24T10:30:00Z");
	});

	it("rejects a spring-forward time instead of normalizing it", () => {
		expect(
			interpretManualInterval({
				command: at(
					"2026-03-29",
					{ time: "02:30", occurrence: null, displayedOffsetMinutes: 60 },
					{ time: "05:00", occurrence: null, displayedOffsetMinutes: 120 },
				),
				timezone: "Europe/Berlin",
				now,
			}),
		).toEqual({ ok: false, rejection: { reason: "nonexistent_time", endpoint: "clockIn" } });
	});

	it("requires an explicit occurrence for a repeated time and reports both offsets", () => {
		expect(
			interpretManualInterval({
				command: at(
					"2026-10-25",
					{ time: "01:00", occurrence: null, displayedOffsetMinutes: 120 },
					{ time: "02:30", occurrence: null, displayedOffsetMinutes: 60 },
				),
				timezone: "Europe/Berlin",
				now,
			}),
		).toEqual({
			ok: false,
			rejection: {
				reason: "occurrence_required",
				endpoint: "clockOut",
				earlierOffsetMinutes: 120,
				laterOffsetMinutes: 60,
			},
		});
	});

	it("orders repeated-hour endpoints by UTC, not by their wall-clock labels", () => {
		const result = interpretManualInterval({
			command: at(
				"2026-10-25",
				{ time: "02:40", occurrence: "earlier", displayedOffsetMinutes: 120 },
				{ time: "02:10", occurrence: "later", displayedOffsetMinutes: 60 },
			),
			timezone: "Europe/Berlin",
			now,
		});
		expect(result).toMatchObject({
			ok: true,
			startOffsetMinutes: 120,
			endOffsetMinutes: 60,
			durationMinutes: 30,
		});
		if (!result.ok) throw new Error("expected an interval");
		expect(result.start.toString()).toBe("2026-10-25T00:40:00Z");
		expect(result.end.toString()).toBe("2026-10-25T01:10:00Z");
	});

	it("requires reconfirmation when ambiguity or a displayed offset disagrees", () => {
		expect(
			interpretManualInterval({
				command: at(
					"2026-09-24",
					{ time: "08:00", occurrence: "later", displayedOffsetMinutes: 120 },
					{ time: "12:00", occurrence: null, displayedOffsetMinutes: 120 },
				),
				timezone: "Europe/Berlin",
				now,
			}),
		).toEqual({
			ok: false,
			rejection: {
				reason: "reconfirmation_required",
				detail: "ambiguity_changed",
				endpoint: "clockIn",
			},
		});
		expect(
			interpretManualInterval({
				command: at(
					"2026-10-25",
					{ time: "01:00", occurrence: null, displayedOffsetMinutes: 120 },
					{ time: "02:30", occurrence: "later", displayedOffsetMinutes: 120 },
				),
				timezone: "Europe/Berlin",
				now,
			}),
		).toEqual({
			ok: false,
			rejection: {
				reason: "reconfirmation_required",
				detail: "offset_mismatch",
				endpoint: "clockOut",
			},
		});
	});

	it.each([
		["nonpositive_interval", "12:00", "12:00", "2026-09-24"],
		["nonpositive_interval", "12:00", "11:59", "2026-09-24"],
		["future_endpoint", "11:00", "13:01", "2026-11-01"],
	])("rejects %s (%s–%s)", (reason, start, end, date) => {
		const offset = date === "2026-11-01" ? 60 : 120;
		expect(
			interpretManualInterval({
				command: at(
					date,
					{ time: start, occurrence: null, displayedOffsetMinutes: offset },
					{ time: end, occurrence: null, displayedOffsetMinutes: offset },
				),
				timezone: "Europe/Berlin",
				now,
			}),
		).toEqual({ ok: false, rejection: { reason } });
	});

	it("allows an end exactly at the evaluation instant", () => {
		expect(
			interpretManualInterval({
				command: at(
					"2026-11-01",
					{ time: "11:00", occurrence: null, displayedOffsetMinutes: 60 },
					{ time: "13:00", occurrence: null, displayedOffsetMinutes: 60 },
				),
				timezone: "Europe/Berlin",
				now,
			}),
		).toMatchObject({ ok: true, durationMinutes: 120 });
	});

	it("caps elapsed time at 24 hours on a repeated-hour day", () => {
		const day = (clockOut: string) =>
			interpretManualInterval({
				command: at(
					"2026-10-25",
					{ time: "00:00", occurrence: null, displayedOffsetMinutes: 120 },
					{ time: clockOut, occurrence: null, displayedOffsetMinutes: 60 },
				),
				timezone: "Europe/Berlin",
				now,
			});
		expect(day("23:00")).toMatchObject({ ok: true, durationMinutes: 24 * 60 });
		expect(day("23:01")).toEqual({ ok: false, rejection: { reason: "interval_too_long" } });
	});
});

describe("manualOccupiedLocalDates", () => {
	it("lists dates with positive half-open intersection; a midnight end excludes the next date", () => {
		const dates = (start: string, end: string) =>
			manualOccupiedLocalDates(parseInstant(start), parseInstant(end), "Europe/Berlin").map(String);
		expect(dates("2026-09-24T20:00:00Z", "2026-09-24T22:00:00Z")).toEqual(["2026-09-24"]);
		expect(dates("2026-09-24T20:00:00Z", "2026-09-24T22:01:00Z")).toEqual([
			"2026-09-24",
			"2026-09-25",
		]);
		// Interpreted in the effective zone, not UTC: 23:30Z is already the 25th in Berlin.
		expect(dates("2026-09-24T23:30:00Z", "2026-09-25T01:00:00Z")).toEqual(["2026-09-25"]);
	});
});

describe("manualCalendarDaysBack", () => {
	it("counts calendar days from the end's local date to today's local date in the zone", () => {
		const back = (end: string, now: string, zone = "Europe/Berlin") =>
			manualCalendarDaysBack(parseInstant(end), parseInstant(now), zone);
		expect(back("2026-09-24T21:00:00Z", "2026-09-24T21:59:00Z")).toBe(0);
		expect(back("2026-09-24T21:00:00Z", "2026-09-24T22:00:00Z")).toBe(1);
		expect(back("2026-09-24T21:00:00Z", "2026-09-25T21:59:00Z")).toBe(1);
		expect(back("2026-09-24T21:00:00Z", "2026-09-25T22:00:00Z")).toBe(2);
		expect(back("2026-09-24T21:00:00Z", "2026-09-25T22:00:00Z", "UTC")).toBe(1);
	});
});

describe("evaluateManualApprovalIntent", () => {
	const policy = { selfServiceDays: 2, approvalDays: 3, noApprovalRequired: false };

	it("creates approved work within the inclusive self-service window, without policy, in trust mode and for exemptions", () => {
		expect(evaluateManualApprovalIntent({ exemption: null, policy, daysBack: 2 })).toEqual({
			intent: "direct",
			reason: "within_self_service",
		});
		expect(evaluateManualApprovalIntent({ exemption: null, policy: null, daysBack: 90 })).toEqual({
			intent: "direct",
			reason: "no_policy",
		});
		expect(
			evaluateManualApprovalIntent({
				exemption: null,
				policy: { ...policy, noApprovalRequired: true },
				daysBack: 90,
			}),
		).toEqual({ intent: "direct", reason: "trust_mode" });
		expect(
			evaluateManualApprovalIntent({ exemption: "owner_admin_self", policy, daysBack: 90 }),
		).toEqual({
			intent: "direct",
			reason: "owner_admin_self",
		});
		expect(evaluateManualApprovalIntent({ exemption: "on_behalf", policy, daysBack: 90 })).toEqual({
			intent: "direct",
			reason: "on_behalf",
		});
	});

	it("routes approval inside the inclusive approval window and converts only age-forbidden work beyond it", () => {
		expect(evaluateManualApprovalIntent({ exemption: null, policy, daysBack: 3 })).toEqual({
			intent: "approval",
			reason: "within_approval_window",
		});
		expect(evaluateManualApprovalIntent({ exemption: null, policy, daysBack: 5 })).toEqual({
			intent: "approval",
			reason: "within_approval_window",
		});
		expect(evaluateManualApprovalIntent({ exemption: null, policy, daysBack: 6 })).toEqual({
			intent: "approval",
			reason: "beyond_approval_window",
		});
	});
});
