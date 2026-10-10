import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	checkBreakClockContinuity,
	parseClockCommand,
	verifyClockCommandContext,
} from "./clock-command";

const context = {
	userId: "user-1",
	organizationId: "org-1",
	employeeId: "a0000000-0000-4000-8000-000000000001",
	server: "https://app.example.test",
};

const clockIn = {
	version: 2,
	operationId: "b0000000-0000-4000-8000-000000000001",
	kind: "clock_in",
	admission: "immediate",
	occurredAt: "2026-09-25T08:00:00.000Z",
	timezone: "Europe/Berlin",
	context,
	workLocationType: "office",
};

const clockOut = {
	version: 2,
	operationId: "b0000000-0000-4000-8000-000000000002",
	kind: "clock_out",
	admission: "delayed",
	occurredAt: "2026-09-25T16:00:00Z",
	timezone: "Europe/Berlin",
	context,
	target: { clockInOperationId: clockIn.operationId },
	project: { kind: "preserve" },
	workCategory: { kind: "replace", id: "c0000000-0000-4000-8000-000000000001" },
};

describe("parseClockCommand", () => {
	it("accepts an explicit billable choice on a clock-out and keeps it out otherwise (#900)", () => {
		const billable = { ...clockOut, billable: false };
		expect(parseClockCommand(billable)).toEqual({ ok: true, command: billable });
		const parsed = parseClockCommand(clockOut);
		expect(parsed.ok && Object.hasOwn(parsed.command, "billable")).toBe(false);
		expect(parseClockCommand({ ...clockOut, billable: "yes" })).toEqual({
			ok: false,
			code: "invalid_command",
		});
	});

	it("accepts frozen version 2 clock-in and clock-out commands verbatim", () => {
		expect(parseClockCommand(clockIn)).toEqual({ ok: true, command: clockIn });
		expect(parseClockCommand(clockOut)).toEqual({ ok: true, command: clockOut });
		expect(
			parseClockCommand({
				...clockOut,
				target: { workPeriodId: "d0000000-0000-4000-8000-000000000001" },
				project: { kind: "clear" },
			}),
		).toMatchObject({ ok: true });
	});

	it("accepts an optional task intent on a clock-out verbatim (#875)", () => {
		for (const task of [
			{ kind: "replace", id: "e0000000-0000-4000-8000-000000000001" },
			{ kind: "clear" },
			{ kind: "preserve" },
		]) {
			const withTask = { ...clockOut, task };
			expect(parseClockCommand(withTask)).toEqual({ ok: true, command: withTask });
		}
		// A command without a task stays exactly as frozen: no `task` key appears.
		const parsed = parseClockCommand(clockOut);
		expect(parsed.ok && Object.keys(parsed.command).sort()).toEqual(Object.keys(clockOut).sort());
	});

	it("reports other versions as unsupported rather than invalid", () => {
		expect(parseClockCommand({ ...clockIn, version: 4 })).toEqual({
			ok: false,
			code: "unsupported_version",
		});
		expect(parseClockCommand({ ...clockIn, version: undefined })).toEqual({
			ok: false,
			code: "unsupported_version",
		});
	});

	it.each([
		["an unknown field", { ...clockIn, organizationId: "org-1" }],
		["a missing context field", { ...clockIn, context: { ...context, server: undefined } }],
		[
			"a server with a path",
			{ ...clockIn, context: { ...context, server: "https://app.example.test/" } },
		],
		["an uppercase operation id", { ...clockIn, operationId: clockIn.operationId.toUpperCase() }],
		["an offset instant", { ...clockIn, occurredAt: "2026-09-25T10:00:00+02:00" }],
		["sub-millisecond precision", { ...clockIn, occurredAt: "2026-09-25T08:00:00.0001Z" }],
		["an invalid zone", { ...clockIn, timezone: "Mars/Olympus" }],
		["a client offset", { ...clockIn, utcOffsetMinutes: 120 }],
		["an unknown admission", { ...clockIn, admission: "replay" }],
		["a work-location alias", { ...clockIn, workLocationType: "homeoffice" }],
		["an omitted clock-in location", { ...clockIn, workLocationType: undefined }],
		["a clock-out without target", { ...clockOut, target: undefined }],
		[
			"a clock-out with both targets",
			{
				...clockOut,
				target: { workPeriodId: context.employeeId, clockInOperationId: clockIn.operationId },
			},
		],
		["an omitted attribution intent", { ...clockOut, project: undefined }],
		["a replacement without id", { ...clockOut, project: { kind: "replace" } }],
		["clock-out fields on a clock-in", { ...clockIn, target: clockOut.target }],
		["a task on a clock-in", { ...clockIn, task: { kind: "clear" } }],
		["a task replacement without id", { ...clockOut, task: { kind: "replace" } }],
		["a task as a bare id", { ...clockOut, task: "e0000000-0000-4000-8000-000000000001" }],
		["a null task", { ...clockOut, task: null }],
	])("rejects %s", (_label, body) => {
		expect(parseClockCommand(body)).toEqual({ ok: false, code: "invalid_command" });
	});
});

describe("position-stamped version 3 commands (#826)", () => {
	const position = {
		latitude: 52.520008,
		longitude: 13.404954,
		accuracyMeters: 18.5,
		fixedAt: "2026-09-25T07:59:30.250Z",
	};
	const stampedIn = { ...clockIn, version: 3, position };
	const stampedOut = { ...clockOut, version: 3, position };

	it("accepts a clock-in or clock-out carrying the device position verbatim", () => {
		expect(parseClockCommand(stampedIn)).toEqual({ ok: true, command: stampedIn });
		expect(parseClockCommand(stampedOut)).toEqual({ ok: true, command: stampedOut });
	});

	it("still accepts version 2 commands, which never carry a position", () => {
		expect(parseClockCommand(clockIn)).toEqual({ ok: true, command: clockIn });
		expect(parseClockCommand({ ...clockIn, position })).toEqual({
			ok: false,
			code: "invalid_command",
		});
	});

	it.each([
		["a version 3 command without a position", { ...stampedIn, position: undefined }],
		["a latitude beyond the pole", { ...stampedIn, position: { ...position, latitude: 90.1 } }],
		[
			"a longitude beyond the antimeridian",
			{ ...stampedIn, position: { ...position, longitude: -180.5 } },
		],
		["a negative accuracy", { ...stampedIn, position: { ...position, accuracyMeters: -1 } }],
		["a textual latitude", { ...stampedIn, position: { ...position, latitude: "52.5" } }],
		[
			"a fix time with an offset",
			{ ...stampedIn, position: { ...position, fixedAt: "2026-09-25T09:59:30+02:00" } },
		],
		["an altitude", { ...stampedIn, position: { ...position, altitude: 34 } }],
		["a desktop break", { ...breakFixture(), version: 3, position }],
	])("rejects %s", (_label, body) => {
		expect(parseClockCommand(body)).toEqual({ ok: false, code: "invalid_command" });
	});
});

function breakFixture() {
	return JSON.parse(
		readFileSync(
			new URL(
				"../../../../desktop/src-tauri/tests/clock-core/fixtures/desktop-v2-break.json",
				import.meta.url,
			),
			"utf8",
		),
	) as Record<string, unknown>;
}

describe("break commands (#281)", () => {
	// Idle from the last input at 10:00:05.123 until the detected return at
	// 10:30:00.456; the employee confirmed five minutes after returning.
	const breakCommand = {
		version: 2,
		operationId: "b0000000-0000-4000-8000-000000000003",
		kind: "break",
		admission: "delayed",
		occurredAt: "2026-09-25T10:30:00.456Z",
		timezone: "Europe/Berlin",
		context,
		target: { workPeriodId: "d0000000-0000-4000-8000-000000000001" },
		workLocationType: "home",
		breakStart: { at: "2026-09-25T10:00:05.123Z", timezone: "Europe/Lisbon" },
		observations: {
			lastActivity: { utc: "2026-09-25T10:00:05.123Z", monotonicMs: 7_200_000 },
			idleDetected: {
				utc: "2026-09-25T10:05:08.123Z",
				monotonicMs: 7_503_000,
				timezone: "Europe/Lisbon",
			},
			returnDetected: {
				utc: "2026-09-25T10:30:00.456Z",
				monotonicMs: 8_995_333,
				timezone: "Europe/Berlin",
			},
			confirmed: { utc: "2026-09-25T10:35:00.456Z", monotonicMs: 9_295_333 },
		},
	};
	type BreakBody = typeof breakCommand;
	const observed = (
		patch: (observations: BreakBody["observations"]) => void,
		command: Partial<BreakBody> = {},
	) => {
		const observations = structuredClone(breakCommand.observations);
		patch(observations);
		return { ...breakCommand, ...command, observations };
	};

	it("accepts the source-bound break with separate endpoint evidence verbatim", () => {
		expect(parseClockCommand(breakCommand)).toEqual({ ok: true, command: breakCommand });
		expect(
			parseClockCommand({
				...breakCommand,
				target: { clockInOperationId: clockIn.operationId },
			}),
		).toMatchObject({ ok: true });
	});

	it.each([
		["a break without target", { ...breakCommand, target: undefined }],
		["a break without start", { ...breakCommand, breakStart: undefined }],
		["a break without observations", { ...breakCommand, observations: undefined }],
		["a break without resume location", { ...breakCommand, workLocationType: undefined }],
		["attribution on a break", { ...breakCommand, project: { kind: "preserve" } }],
		[
			"a start that is not the last observed input",
			{ ...breakCommand, breakStart: { ...breakCommand.breakStart, at: "2026-09-25T10:00:00Z" } },
		],
		[
			"a start zone that was not observed at idle detection",
			{ ...breakCommand, breakStart: { ...breakCommand.breakStart, timezone: "Europe/Berlin" } },
		],
		[
			"a resume that is not the detected return",
			{ ...breakCommand, occurredAt: "2026-09-25T10:35:00.456Z" },
		],
		["a resume zone that was not observed at return", { ...breakCommand, timezone: "UTC" }],
		[
			"a return zone that does not exist",
			observed((o) => {
				o.returnDetected.timezone = "Mars/Olympus";
			}),
		],
		[
			"monotonic time running backwards",
			observed((o) => {
				o.confirmed.monotonicMs = o.returnDetected.monotonicMs - 1;
			}),
		],
		[
			"a fractional monotonic reading",
			observed((o) => {
				o.lastActivity.monotonicMs = 0.5;
			}),
		],
	])("rejects %s", (_label, body) => {
		expect(parseClockCommand(body)).toEqual({ ok: false, code: "invalid_command" });
	});

	it("keeps observations whose wall and monotonic elapsed times agree", () => {
		const parsed = parseClockCommand(breakCommand);
		if (!parsed.ok || parsed.command.kind !== "break") throw new Error("expected a break");
		expect(checkBreakClockContinuity(parsed.command)).toBeNull();
	});

	it.each([
		[
			"the wall clock jumped forward while idle",
			(o: BreakBody["observations"]) => {
				o.lastActivity.utc = "2026-09-25T09:00:05.123Z";
			},
			"lastActivity",
		],
		[
			"the wall clock was set back while idle",
			(o: BreakBody["observations"]) => {
				o.returnDetected.monotonicMs += 600_000;
				o.confirmed.monotonicMs += 600_000;
			},
			"idleDetected",
		],
		[
			"the wall clock changed between return and confirmation",
			(o: BreakBody["observations"]) => {
				o.confirmed.utc = "2026-09-25T10:45:00.456Z";
			},
			"returnDetected",
		],
	])("requires review when %s", (_label, patch, from) => {
		const body = observed(patch);
		body.breakStart = { ...body.breakStart, at: body.observations.lastActivity.utc };
		const parsed = parseClockCommand(body);
		if (!parsed.ok || parsed.command.kind !== "break") throw new Error("expected a break");
		expect(checkBreakClockContinuity(parsed.command)).toEqual({
			code: "clock_discontinuity",
			from,
		});
	});

	it("tolerates two seconds plus one millisecond per monotonic second of drift", () => {
		// 303 s of wall time against 305.305 s of monotonic time: 2 s + 305 ms allowed.
		const shifted = (drift: number) =>
			observed((o) => {
				o.idleDetected.monotonicMs += drift;
				o.returnDetected.monotonicMs += drift;
				o.confirmed.monotonicMs += drift;
			});
		const within = shifted(2_305);
		const beyond = shifted(2_306);
		const assess = (body: unknown) => {
			const parsed = parseClockCommand(body);
			if (!parsed.ok || parsed.command.kind !== "break") throw new Error("expected a break");
			return checkBreakClockContinuity(parsed.command);
		};
		expect(assess(within)).toBeNull();
		expect(assess(beyond)).toEqual({ code: "clock_discontinuity", from: "lastActivity" });
	});
});

describe("verifyClockCommandContext", () => {
	it("accepts assertions that equal the server-derived authority", () => {
		expect(verifyClockCommandContext(context, context)).toEqual([]);
	});

	it("names every asserted field that disagrees, never substituting authority", () => {
		expect(
			verifyClockCommandContext(context, {
				userId: "user-2",
				organizationId: "org-2",
				employeeId: "a0000000-0000-4000-8000-000000000002",
				server: "https://other.example.test",
			}),
		).toEqual(["userId", "organizationId", "employeeId", "server"]);
		expect(verifyClockCommandContext(context, { ...context, server: null })).toEqual(["server"]);
	});
});

describe("desktop frozen commands (#280)", () => {
	// Byte-exact commands pinned by the desktop's frozen_command_tests.rs.
	const fixture = (name: string) =>
		readFileSync(
			new URL(`../../../../desktop/src-tauri/tests/clock-core/fixtures/${name}`, import.meta.url),
			"utf8",
		).trimEnd();

	it.each([
		"desktop-v2-clock-in.json",
		"desktop-v2-clock-out.json",
		"desktop-v2-clock-out-task.json",
		"desktop-v2-break.json",
	])("accepts the exact bytes the desktop sends: %s", (name) => {
		const sent = JSON.parse(fixture(name));
		const parsed = parseClockCommand(sent);
		expect(parsed).toEqual({ ok: true, command: sent });
	});
});
