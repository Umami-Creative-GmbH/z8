import { describe, expect, it } from "vitest";
import { pronounsSchema } from "./employee";

describe("pronounsSchema", () => {
	it("accepts and normalizes a trimmed 50-character value", () => {
		const value = `${"x".repeat(50)}   `;

		expect(pronounsSchema.parse(value)).toBe("x".repeat(50));
	});

	it("rejects values longer than 50 characters after trimming", () => {
		expect(() => pronounsSchema.parse("x".repeat(51))).toThrow(
			"Pronouns must be 50 characters or less",
		);
	});
});
