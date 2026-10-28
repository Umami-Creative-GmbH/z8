import { afterEach, describe, expect, it, vi } from "vitest";
import {
	parseWebClockStatus,
	serializeWebClockStatus,
	WEB_CLOCK_STATUS_UNAVAILABLE,
	type WebClockStatus,
} from "./web-clock-status";
import { getWebClockStatus } from "./web-clock-status-client";
const OUT: WebClockStatus = {
	hasEmployee: true,
	employeeId: "employee",
	isClockedIn: false,
	activeWorkPeriod: null,
};
const IN: WebClockStatus = {
	...OUT,
	isClockedIn: true,
	activeWorkPeriod: {
		id: "period",
		startTime: new Date("2026-10-28T08:00:00.123Z"),
		currentTask: {
			id: "task",
			name: "Work",
			state: "done",
			projectId: "project",
		},
		breakStartedAt: new Date("2026-10-28T10:00:00.456Z"),
		breakStartedZone: "Europe/Berlin",
	},
};
afterEach(() => vi.unstubAllGlobals());
it("roundtrips the complete web reader including task, open break and UTC instants", () => {
	const wire = serializeWebClockStatus(IN);
	expect(wire.activeWorkPeriod).toEqual({
		...IN.activeWorkPeriod,
		startTime: "2026-10-28T08:00:00.123Z",
		breakStartedAt: "2026-10-28T10:00:00.456Z",
	});
	expect(parseWebClockStatus(JSON.parse(JSON.stringify(wire)))).toEqual(IN);
	expect(parseWebClockStatus(serializeWebClockStatus(OUT))).toEqual(OUT);
	const absent = { ...OUT, hasEmployee: false, employeeId: null };
	expect(parseWebClockStatus(serializeWebClockStatus(absent))).toEqual(absent);
});
it.each([
	(v: any) => (v.activeWorkPeriod.startTime = "2026-02-30T08:00:00.123Z"),
	(v: any) => (v.activeWorkPeriod.startTime = "2026-10-28T09:00:00+01:00"),
	(v: any) => (v.activeWorkPeriod.breakStartedAt = "PRIVATE_BAD_DATE"),
	(v: any) => delete v.activeWorkPeriod.breakStartedZone,
	(v: any) => (v.activeWorkPeriod.breakStartedZone = 42),
	(v: any) => (v.activeWorkPeriod.currentTask.state = "PRIVATE_BAD_STATE"),
	(v: any) => delete v.activeWorkPeriod.currentTask.projectId,
	(v: any) => (v.activeWorkPeriod.currentTask.extra = "PRIVATE_EXTRA"),
	(v: any) => (v.hasEmployee = false),
	(v: any) => (v.isClockedIn = false),
	(v: any) => (v.extra = "PRIVATE_EXTRA"),
])(
	"rejects malformed dates/task/break/visibility without inventing OUT or leaking input",
	(edit) => {
		const wire = serializeWebClockStatus(IN);
		edit(wire);
		expect(() => parseWebClockStatus(wire)).toThrow(
			WEB_CLOCK_STATUS_UNAVAILABLE,
		);
		try {
			parseWebClockStatus(wire);
		} catch (error) {
			expect(String(error)).not.toMatch(/PRIVATE|projectId|breakStarted/);
		}
	},
);
it("rejects an invalid server Date rather than emitting a misleading JSON status", () => {
	expect(() =>
		serializeWebClockStatus({
			...IN,
			activeWorkPeriod: {
				...IN.activeWorkPeriod!,
				breakStartedAt: new Date("invalid"),
			},
		}),
	).toThrow(WEB_CLOCK_STATUS_UNAVAILABLE);
});
it("reads the private no-store endpoint with credentials and no cancellation signal", async () => {
	const fetch = vi.fn(async () => Response.json(serializeWebClockStatus(IN)));
	vi.stubGlobal("fetch", fetch);
	expect(await getWebClockStatus()).toEqual(IN);
	expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/time-clock/status", {
		credentials: "same-origin",
		cache: "no-store",
	});
});
it.each([
	() =>
		new Response(JSON.stringify(OUT), {
			status: 401,
			headers: { "content-type": "application/json" },
		}),
	() => new Response("PRIVATE_SERVER_ERROR", { status: 500 }),
	() =>
		new Response("PRIVATE_HTML", {
			status: 200,
			headers: { "content-type": "text/html" },
		}),
	() =>
		new Response("PRIVATE_NOT_JSON", {
			status: 200,
			headers: { "content-type": "application/json" },
		}),
	() => Response.json({ hasEmployee: false }),
])(
	"rejects HTTP/serialization failures as unavailable, never false successful OUT",
	async (response) => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => response()),
		);
		await expect(getWebClockStatus()).rejects.toThrow(
			WEB_CLOCK_STATUS_UNAVAILABLE,
		);
	},
);
