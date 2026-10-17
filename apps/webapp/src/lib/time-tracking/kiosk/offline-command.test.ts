import { describe, expect, it } from "vitest";
import { parseKioskFrozenSubmission } from "./frozen-command";
import type { CachedKioskEmployee } from "./offline-cache";
import {
	buildKioskOfflineCommand,
	freezeKioskOfflineSubmission,
	type KioskOfflineEmployeeView,
	kioskOfflineEmployeeView,
} from "./offline-command";
import type { KioskVehicleUse } from "./protocol";

/**
 * #1292: what an employee sees and does at an offline kiosk. Their cached state
 * with the kiosk's own queued commands on top, and the frozen command each
 * action becomes (wire format v1, #1289).
 */
const kioskId = "22222222-2222-4222-8222-222222222222";
const employeeId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const workPeriodId = "99999999-9999-4999-8999-999999999999";
const vehicleId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const zone = "Europe/Berlin";

function cached(
	state: CachedKioskEmployee["state"],
	vehicleUse?: KioskVehicleUse,
): CachedKioskEmployee {
	return {
		id: employeeId,
		name: "Anna Berger",
		state,
		learnedAt: "2026-10-16T07:45:00Z",
		...(vehicleUse ? { vehicleUse } : {}),
	};
}

const vehicleContext: KioskVehicleUse = {
	mode: "asked",
	vehicles: [],
	suggestedVehicleIds: [],
	lastEndKmByVehicleId: { [vehicleId]: 1000 },
	vehiclesOnOtherLiveWork: [],
	live: null,
};

let operation = 0;
function nextOperationId() {
	operation += 1;
	return `00000000-0000-4000-8000-${String(operation).padStart(12, "0")}`;
}

/** Builds the action's command at `occurredAt` and returns it with the view after it. */
function act(
	view: KioskOfflineEmployeeView,
	action: Parameters<typeof buildKioskOfflineCommand>[0]["action"],
	occurredAt: string,
	vehicleUse?: Parameters<typeof buildKioskOfflineCommand>[0]["vehicleUse"],
) {
	const command = buildKioskOfflineCommand({
		view,
		action,
		operationId: nextOperationId(),
		kioskId,
		timezone: zone,
		occurredAt,
		timeSource: "server_anchor",
		vehicleUse,
	});
	if (!command) throw new Error(`${action} is not possible in ${view.state.status}`);
	return command;
}

function submissionOf(command: unknown) {
	return parseKioskFrozenSubmission({
		command,
		pin: { v: 1, kid: "k1", epk: "AA", iv: "AA", ct: "AA" },
		contact: { serverTime: "2026-10-16T07:45:00Z", proof: "AA" },
	});
}

describe("offline kiosk turn (#1292)", () => {
	it("shows the cached state while nothing is queued", () => {
		const view = kioskOfflineEmployeeView(
			cached({ status: "clocked_in", workPeriodId, since: "2026-10-16T06:30:00Z" }),
			[],
		);

		expect(view.state).toEqual({
			status: "clocked_in",
			workPeriodId,
			since: "2026-10-16T06:30:00Z",
		});
		expect(view.queued).toBe(0);
	});

	it("clocks in, starts a break, resumes and clocks out offline as frozen commands Z8 accepts", () => {
		let view = kioskOfflineEmployeeView(cached({ status: "clocked_out" }), []);
		const commands = [];

		const clockIn = act(view, "clock_in", "2026-10-16T08:00:00Z");
		commands.push(clockIn);
		view = kioskOfflineEmployeeView(cached({ status: "clocked_out" }), commands);
		expect(view.state).toMatchObject({ status: "clocked_in", since: "2026-10-16T08:00:00Z" });

		const startBreak = act(view, "start_break", "2026-10-16T10:00:00Z");
		commands.push(startBreak);
		view = kioskOfflineEmployeeView(cached({ status: "clocked_out" }), commands);
		expect(view.state).toMatchObject({
			status: "on_break",
			since: "2026-10-16T08:00:00Z",
			breakSince: "2026-10-16T10:00:00Z",
			breakZone: zone,
		});

		const resume = act(view, "resume_break", "2026-10-16T10:30:00Z");
		commands.push(resume);
		view = kioskOfflineEmployeeView(cached({ status: "clocked_out" }), commands);
		expect(view.state).toMatchObject({ status: "clocked_in", since: "2026-10-16T10:30:00Z" });

		const clockOut = act(view, "clock_out", "2026-10-16T16:00:00Z");
		commands.push(clockOut);
		view = kioskOfflineEmployeeView(cached({ status: "clocked_out" }), commands);
		expect(view.state).toEqual({ status: "clocked_out" });
		expect(view.queued).toBe(4);

		expect(clockIn).toEqual({
			version: 1,
			operationId: clockIn.operationId,
			kioskId,
			employeeId,
			action: "clock_in",
			occurredAt: "2026-10-16T08:00:00Z",
			timeSource: "server_anchor",
			timezone: zone,
			workLocationType: "office",
		});
		expect(startBreak).toMatchObject({ action: "start_break" });
		expect(resume).toMatchObject({
			action: "resume_break",
			breakStart: { at: "2026-10-16T10:00:00Z", timezone: zone },
		});
		// The clock-out closes the work its own queued resume started.
		expect(clockOut).toMatchObject({
			action: "clock_out",
			target: { clockInOperationId: resume.operationId },
			project: { kind: "preserve" },
			workCategory: { kind: "preserve" },
		});
		for (const command of commands) expect(submissionOf(command).ok).toBe(true);
	});

	it("closes the cached work and ends the day on a cached break at its start", () => {
		const onBreak = cached({
			status: "on_break",
			workPeriodId,
			since: "2026-10-16T05:00:00Z",
			breakSince: "2026-10-16T09:15:00Z",
			breakZone: "Europe/Lisbon",
		});
		const view = kioskOfflineEmployeeView(onBreak, []);

		const resume = act(view, "resume_break", "2026-10-16T09:40:00Z");
		const endDay = act(view, "end_day", "2026-10-16T09:41:00Z");

		expect(resume).toMatchObject({
			breakStart: { at: "2026-10-16T09:15:00Z", timezone: "Europe/Lisbon" },
		});
		expect(endDay).toMatchObject({ action: "clock_out", target: { workPeriodId } });
		expect(view.endsDayAt).toBe("2026-10-16T09:15:00Z");
		expect(submissionOf(endDay).ok).toBe(true);
	});

	it("offers no action the state does not allow", () => {
		const view = kioskOfflineEmployeeView(cached({ status: "clocked_out" }), []);

		expect(
			buildKioskOfflineCommand({
				view,
				action: "clock_out",
				operationId: nextOperationId(),
				kioskId,
				timezone: zone,
				occurredAt: "2026-10-16T08:00:00Z",
				timeSource: "device_clock",
			}),
		).toBeNull();
	});

	it("skips a queued command its state no longer allows, e.g. one the cache already shows", () => {
		const clockIn = act(
			kioskOfflineEmployeeView(cached({ status: "clocked_out" }), []),
			"clock_in",
			"2026-10-16T07:00:00Z",
		);

		const view = kioskOfflineEmployeeView(
			cached({ status: "clocked_in", workPeriodId, since: "2026-10-16T07:00:00Z" }),
			[clockIn],
		);

		expect(view.state).toEqual({
			status: "clocked_in",
			workPeriodId,
			since: "2026-10-16T07:00:00Z",
		});
	});

	it("carries the vehicle asked at clock-in into the live work the clock-out and resume ask about", () => {
		const clockIn = act(
			kioskOfflineEmployeeView(cached({ status: "clocked_out" }, vehicleContext), []),
			"clock_in",
			"2026-10-16T08:00:00Z",
			{ vehicle: { kind: "organization", vehicleId }, startKm: 1000 },
		);
		const afterClockIn = kioskOfflineEmployeeView(
			cached({ status: "clocked_out" }, vehicleContext),
			[clockIn],
		);
		expect(afterClockIn.vehicleUse?.live).toEqual({
			vehicle: { kind: "organization", vehicleId },
			startKm: 1000,
			endKm: null,
			distanceKm: null,
		});

		const startBreak = act(afterClockIn, "start_break", "2026-10-16T10:00:00Z");
		const resume = act(
			kioskOfflineEmployeeView(cached({ status: "clocked_out" }, vehicleContext), [
				clockIn,
				startBreak,
			]),
			"resume_break",
			"2026-10-16T10:30:00Z",
			{ readingKm: 1040 },
		);
		const afterResume = kioskOfflineEmployeeView(
			cached({ status: "clocked_out" }, vehicleContext),
			[clockIn, startBreak, resume],
		);

		expect(resume).toMatchObject({ vehicleUse: { readingKm: 1040 } });
		expect(afterResume.vehicleUse?.live).toEqual({
			vehicle: { kind: "organization", vehicleId },
			startKm: 1040,
			endKm: null,
			distanceKm: null,
		});
		expect(afterResume.vehicleUse?.lastEndKmByVehicleId[vehicleId]).toBe(1040);
	});

	it("asks no vehicle use offline for an employee whose context was not cached", () => {
		const view = kioskOfflineEmployeeView(cached({ status: "clocked_out" }), []);

		expect(view.vehicleUse).toBeUndefined();
	});

	it("counts only unconfirmed commands as queued, while applying confirmed ones to the state", () => {
		const start = cached({ status: "clocked_out" });
		const clockIn = act(kioskOfflineEmployeeView(start, []), "clock_in", "2026-10-16T08:00:00Z");

		const view = kioskOfflineEmployeeView(start, [clockIn], {
			confirmed: new Set([clockIn.operationId]),
		});

		expect(view.state.status).toBe("clocked_in");
		expect(view.queued).toBe(0);
	});

	it("offers, and freezes, only the actions the believed state allows", () => {
		const view = kioskOfflineEmployeeView(cached({ status: "clocked_out" }), []);

		for (const action of ["start_break", "clock_out", "resume_break", "end_day"] as const) {
			expect(
				buildKioskOfflineCommand({
					view,
					action,
					operationId: nextOperationId(),
					kioskId,
					timezone: zone,
					occurredAt: "2026-10-16T08:00:00Z",
					timeSource: "server_anchor",
				}),
			).toBeNull();
		}
	});
});

describe("freezeKioskOfflineSubmission (#885 review)", () => {
	const sealed = { v: 1 as const, kid: "k1", epk: "AA", iv: "AA", ct: "AA" };
	const contact = { serverTime: "2026-10-16T07:45:00Z", proof: "AA" };
	const base = {
		kioskId,
		timezone: zone,
		occurredAt: "2026-10-16T08:00:00Z",
		timeSource: "device_clock" as const,
		pin: sealed,
		contact,
	};

	it("freezes the action with the sealed PIN and the contact, exactly as Z8 parses it", () => {
		const operationId = nextOperationId();
		const frozen = freezeKioskOfflineSubmission({
			...base,
			view: kioskOfflineEmployeeView(cached({ status: "clocked_out" }), []),
			action: "clock_in",
			operationId,
		});

		expect(frozen).toEqual({
			submission: {
				command: {
					version: 1,
					operationId,
					kioskId,
					employeeId,
					occurredAt: "2026-10-16T08:00:00Z",
					timeSource: "device_clock",
					timezone: zone,
					action: "clock_in",
					workLocationType: "office",
				},
				pin: sealed,
				contact,
			},
			vehicleUseLeftOut: false,
		});
		expect(frozen && submissionOf(frozen.submission.command).ok).toBe(true);
	});

	it("leaves out vehicle use Z8 would not read, and says so, rather than losing the clocking", () => {
		const frozen = freezeKioskOfflineSubmission({
			...base,
			view: kioskOfflineEmployeeView(cached({ status: "clocked_out" }, vehicleContext), []),
			action: "clock_in",
			operationId: nextOperationId(),
			answer: { vehicleUse: { vehicle: { kind: "own" }, startKm: -5 }, leftOut: false },
		});

		expect(frozen?.vehicleUseLeftOut).toBe(true);
		expect(frozen?.submission.command).not.toHaveProperty("vehicleUse");
	});

	it("freezes nothing the state does not allow", () => {
		expect(
			freezeKioskOfflineSubmission({
				...base,
				view: kioskOfflineEmployeeView(cached({ status: "clocked_out" }), []),
				action: "resume_break",
				operationId: nextOperationId(),
			}),
		).toBeNull();
	});
});
