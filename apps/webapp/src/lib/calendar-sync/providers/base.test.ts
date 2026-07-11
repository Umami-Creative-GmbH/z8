import { describe, expect, it } from "vitest";
import { generateZ8EventId } from "./base";

const input = {
	organizationId: "organization-1",
	calendarConnectionId: "connection-1",
	absenceId: "absence-1",
};

describe("generateZ8EventId", () => {
	it("returns the stable key for the same input", () => {
		expect(generateZ8EventId(input)).toBe(
			"bb5323ac962552e35caf982cccd1aed26bb041c9c0f2e53bece6f50c06525bf0",
		);
	});

	it("returns a 64-character lowercase hexadecimal key", () => {
		expect(generateZ8EventId(input)).toMatch(/^[a-f0-9]{64}$/);
	});

	it.each([
		"organizationId",
		"calendarConnectionId",
		"absenceId",
	] as const)("changes when %s changes", (field) => {
		expect(generateZ8EventId({ ...input, [field]: "different" })).not.toBe(
			generateZ8EventId(input),
		);
	});
});
