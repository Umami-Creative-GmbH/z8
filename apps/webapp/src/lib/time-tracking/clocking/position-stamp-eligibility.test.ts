import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { stampablePosition } from "./position-stamp-eligibility";
import type { ClockCommand } from "./types";

const position = {
	latitude: 48.137154,
	longitude: 11.576124,
	accuracyMeters: 12,
	fixedAt: parseInstant("2026-09-25T07:59:30Z"),
};
const operationId = "b0000000-0000-4000-8000-000000000001";

function command(patch: Partial<ClockCommand> = {}): ClockCommand {
	return {
		organizationId: "org-1",
		principal: { kind: "user", userId: "user-1" },
		subject: { employeeId: "a0000000-0000-4000-8000-000000000001" },
		identity: { origin: "client", id: operationId },
		channel: "web",
		at: { kind: "now" },
		zone: { device: "Europe/Berlin", fallback: "UTC" },
		position,
		body: { kind: "clock_in", workLocationType: "office" },
		...patch,
	} as ClockCommand;
}

const stampedPayload = { version: 3, operationId, position: {} };

describe("stampablePosition", () => {
	it("keeps the position of the employee's own web command", () => {
		expect(stampablePosition(command())).toBe(position);
	});

	it("keeps the position of a stamped version 3 frozen command", () => {
		expect(stampablePosition(command({ channel: "api", payload: stampedPayload }))).toBe(position);
	});

	it("is null without a position", () => {
		expect(stampablePosition(command({ position: undefined }))).toBeNull();
	});

	it.each<[string, Partial<ClockCommand>]>([
		["an on-behalf clock-out", { subject: { employeeId: "e", onBehalf: true } }],
		["a departure", { principal: { kind: "departure", departureId: "d", userId: "user-1" } }],
		[
			"an automatic clock-out",
			{
				principal: {
					kind: "automatic_clock_out",
					userId: "user-1",
					operationId,
					workPeriodId: "w",
				},
				channel: "automatic-clock-out",
			},
		],
		["a legacy route command", { channel: "api", legacy: true }],
		["the native mobile app", { channel: "mobile" }],
		["a chat bot", { channel: "teams-bot" }],
		["a version 2 frozen command", { channel: "api", payload: { version: 2, operationId } }],
		["a direct command without frozen bytes", { channel: "api" }],
	])("never stamps %s", (_label, patch) => {
		expect(stampablePosition(command(patch))).toBeNull();
	});
});
