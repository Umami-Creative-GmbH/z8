import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	admitClockCommandAge,
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

	it("reports other versions as unsupported rather than invalid", () => {
		expect(parseClockCommand({ ...clockIn, version: 3 })).toEqual({
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
	])("rejects %s", (_label, body) => {
		expect(parseClockCommand(body)).toEqual({ ok: false, code: "invalid_command" });
	});
});

describe("admitClockCommandAge", () => {
	const now = parseInstant("2026-09-25T12:00:00Z");
	const at = (offset: { minutes?: number; days?: number; milliseconds?: number }) =>
		now.add({
			minutes: offset.minutes ?? 0,
			hours: (offset.days ?? 0) * 24,
			milliseconds: offset.milliseconds ?? 0,
		});

	it("admits immediate commands up to five minutes past or future, inclusive", () => {
		expect(admitClockCommandAge("immediate", at({ minutes: -5 }), now)).toEqual({ admitted: true });
		expect(admitClockCommandAge("immediate", at({ minutes: 5 }), now)).toEqual({ admitted: true });
		expect(admitClockCommandAge("immediate", at({ minutes: -5, milliseconds: -1 }), now)).toEqual({
			admitted: false,
			reason: "too_old",
		});
		expect(admitClockCommandAge("immediate", at({ minutes: 5, milliseconds: 1 }), now)).toEqual({
			admitted: false,
			reason: "in_future",
		});
	});

	it("admits delayed commands up to seven elapsed days past and five minutes future", () => {
		expect(admitClockCommandAge("delayed", at({ days: -7 }), now)).toEqual({ admitted: true });
		expect(admitClockCommandAge("delayed", at({ minutes: 5 }), now)).toEqual({ admitted: true });
		expect(admitClockCommandAge("delayed", at({ days: -7, milliseconds: -1 }), now)).toEqual({
			admitted: false,
			reason: "too_old",
		});
		expect(admitClockCommandAge("delayed", at({ minutes: 5, milliseconds: 1 }), now)).toEqual({
			admitted: false,
			reason: "in_future",
		});
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

	it.each(["desktop-v2-clock-in.json", "desktop-v2-clock-out.json"])(
		"accepts the exact bytes the desktop sends: %s",
		(name) => {
			const sent = JSON.parse(fixture(name));
			const parsed = parseClockCommand(sent);
			expect(parsed).toEqual({ ok: true, command: sent });
		},
	);
});
