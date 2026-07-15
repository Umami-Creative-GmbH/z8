import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
	return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("live clocking writers", () => {
	it("routes API, web actions, and bot commands through the canonical transactional writer", () => {
		const api = source("../../app/api/time-entries/route.ts");
		const mobileApi = source("../../app/api/mobile/time-clock/route.ts");
		const web = source("../../app/[locale]/(app)/time-tracking/actions/clocking.ts");
		const legacyWeb = source("../../app/[locale]/(app)/time-tracking/actions.ts");
		const onBehalf = source("../../app/api/time-entries/clock-out-on-behalf/route.ts");
		const clockInBot = source("../teams/commands/clock-in.ts");
		const clockOutBot = source("../teams/commands/clock-out.ts");

		for (const writer of [api, web, onBehalf, clockInBot, clockOutBot]) {
			expect(writer).toContain("clockingService");
		}
		expect(api).not.toContain(".insert(timeEntry)");
		expect(clockInBot).not.toContain(".insert(timeEntry)");
		expect(clockOutBot).not.toContain(".insert(timeEntry)");

		const clockInAction = web.slice(web.indexOf("export async function clockIn"), web.indexOf("export async function clockOut"));
		const clockOutAction = web.slice(web.indexOf("export async function clockOut"), web.indexOf("export async function addBreakToActiveSession"));
		expect(clockInAction).toContain("clockingService.clockIn");
		expect(clockInAction).not.toContain("createTimeEntry(");
		expect(clockOutAction).toContain("clockingService.clockOut");
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
		expect(onBehalf).toContain("clockingService.clockOut");
		expect(onBehalf).not.toContain("createTimeEntry(");
	});
});
