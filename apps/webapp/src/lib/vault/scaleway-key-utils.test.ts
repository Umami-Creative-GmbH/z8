import { describe, expect, test } from "vitest";
import { isEnabledScalewayKey } from "./scaleway-key-utils";

describe("Scaleway key utilities", () => {
	test("enabled key check returns false for nullish and non-object inputs", () => {
		expect(isEnabledScalewayKey(null)).toBe(false);
		expect(isEnabledScalewayKey(undefined)).toBe(false);
		expect(isEnabledScalewayKey("key-id")).toBe(false);
	});
});
