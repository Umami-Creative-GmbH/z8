import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { clockSource, liveClockOutWriter } from "./close-active-work";

function source(relativePath: string) {
	return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("live clocking writers", () => {
	it("records the automatic closure as its own writer and source", () => {
		expect(liveClockOutWriter("automatic-clock-out")).toEqual({
			writer: "automatic_clock_out",
			writerVersion: 1,
			deviceInfo: "automatic-clock-out",
			ipAddress: null,
		});
		expect(clockSource("automatic-clock-out")).toEqual({
			deviceInfo: "automatic-clock-out",
			ipAddress: null,
		});
	});
	it("routes API, web actions, and bot commands through the canonical transactional writer", () => {
		const api = source("../../app/api/time-entries/route.ts");
		const mobileApi = source("../../app/api/mobile/time-clock/route.ts");
		const web = source("../../app/[locale]/(app)/time-tracking/actions/clocking.ts");
		const legacyWeb = source("../../app/[locale]/(app)/time-tracking/actions.ts");
		const onBehalfRoute = source("../../app/api/time-entries/clock-out-on-behalf/route.ts");
		const onBehalf = source("../../app/[locale]/(app)/time-tracking/actions/clock-out-on-behalf.ts");
		const clockInBot = source("../teams/commands/clock-in.ts");
		const clockOutBot = source("../teams/commands/clock-out.ts");

		// The legacy route is a legacy command adapter over the Clocking module (#483).
		expect(api).toContain("clocking.run(");
		expect(api).toContain("legacy: true");
		expect(api).not.toContain("clockingService.clockIn");
		expect(api).not.toContain("clockingService.clockOut");
		// Bots reach the web's shared live clock core (#277), never the raw service.
		expect(clockInBot).toContain("clockInAs(");
		expect(clockOutBot).toContain("clockOutAs(");
		for (const bot of [clockInBot, clockOutBot]) {
			expect(bot).toContain('time-tracking/actions/clocking"');
			expect(bot).not.toContain("clockingService");
		}
		expect(api).not.toContain(".insert(timeEntry)");
		expect(clockInBot).not.toContain(".insert(timeEntry)");
		expect(clockOutBot).not.toContain(".insert(timeEntry)");

		const clockInAction = web.slice(web.indexOf("export async function clockIn"), web.indexOf("export async function clockOut"));
		const clockOutAction = web.slice(web.indexOf("export async function clockOut"), web.indexOf("export async function addBreakToActiveSession"));
		// Clock-in and clock-out run through the Clocking module, which owns both
		// admissions (#478, #479).
		expect(clockInAction).toContain("clocking.run(");
		expect(clockInAction).not.toContain("clockingService");
		expect(clockInAction).not.toContain("createTimeEntry(");
		expect(clockOutAction).toContain("clocking.run(");
		expect(clockOutAction).not.toContain("clockingService");
		expect(clockOutAction).not.toContain("createTimeEntry(");

		const legacyClockIn = legacyWeb.slice(legacyWeb.indexOf("export async function clockIn"), legacyWeb.indexOf("export interface BreakAdjustmentInfo"));
		const legacyClockOut = legacyWeb.slice(legacyWeb.indexOf("export async function clockOut"), legacyWeb.indexOf("async function validateProjectAssignment"));
		expect(legacyClockIn).toContain("clockInAction(");
		expect(legacyClockIn).not.toContain("clockingService.clockIn");
		expect(legacyClockIn).not.toContain("createTimeEntry(");
		expect(legacyClockOut).toContain("clockOutAction(");
		expect(legacyClockOut).not.toContain("clockingService.clockOut");
		expect(legacyClockOut).not.toContain("createTimeEntry(");
		expect(mobileApi).toContain('time-tracking/actions/clocking"');
		expect(mobileApi).toContain("await clockIn(");
		expect(mobileApi).toContain("await clockOut(");
		expect(mobileApi).not.toContain("clockingService");
		// On-behalf is a Clocking clock-out on behalf of the period's owner (#482):
		// the module owns authorization, both admissions and the follow-ups.
		expect(onBehalf).toContain(".run(");
		expect(onBehalf).toContain("onBehalf: true");
		expect(onBehalf).not.toContain("clockingService");
		expect(onBehalf).not.toContain("closeActiveWork");
		expect(onBehalf).not.toContain("resolveManualEntryTarget(");
		expect(onBehalf).not.toContain("createTimeEntry(");
		expect(onBehalf).not.toContain("@/db");
		expect(onBehalfRoute).toContain("closeWorkOnBehalf(");
		expect(onBehalfRoute).not.toContain("clockingService");
		expect(onBehalfRoute).not.toContain("@/db");
	});
});
