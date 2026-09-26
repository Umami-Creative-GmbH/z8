import { describe, expect, it } from "vitest";
import { isCanonicalUuid } from "./canonical-uuid";

describe("isCanonicalUuid", () => {
	it("accepts a lowercase hyphenated UUID", () => {
		expect(isCanonicalUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
	});

	it("rejects other shapes and non-strings", () => {
		expect(isCanonicalUuid("11111111-1111-4111-8111-11111111111A")).toBe(false);
		expect(isCanonicalUuid("111111111111411181111111111111111")).toBe(false);
		expect(isCanonicalUuid(" 11111111-1111-4111-8111-111111111111")).toBe(false);
		expect(isCanonicalUuid(null)).toBe(false);
		expect(isCanonicalUuid(42)).toBe(false);
	});
});
