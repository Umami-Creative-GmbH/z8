import { describe, expect, it } from "vitest";
import { clockOutCanPickTask } from "./task-choice";

const frozenPayload = { version: 2, operationId: "op-1" };

describe("clockOutCanPickTask (#884)", () => {
	it("lets an online web clock-out or a clock-out on behalf pick a task", () => {
		expect(clockOutCanPickTask({ channel: "web" })).toBe(true);
	});

	it.each([
		["a frozen command replayed later", { channel: "web" as const, payload: frozenPayload }],
		["a frozen API command", { channel: "api" as const, payload: frozenPayload }],
		["a legacy-route command", { channel: "api" as const, legacy: true as const }],
		["a kiosk", { channel: "kiosk" as const }],
		["an automatic clock-out", { channel: "automatic-clock-out" as const }],
		["a departure clock-out", { channel: "employee-offboarding" as const }],
		["a bot", { channel: "telegram-bot" as const }],
		["the native mobile channel", { channel: "mobile" as const }],
	])("lets nobody pick a task at %s", (_case, command) => {
		expect(clockOutCanPickTask(command)).toBe(false);
	});
});
