import { describe, expect, it } from "vitest";
import { formatEmployeeIdentityName, normalizePronouns } from "./employee-identity";

describe("employee identity helpers", () => {
	const fallbackUser = { name: "Ada Lovelace", email: "ada@example.com" };

	it("formats names with pronouns when present", () => {
		expect(
			formatEmployeeIdentityName({
				firstName: "Ada",
				lastName: "Lovelace",
				pronouns: "she/her",
				user: fallbackUser,
			}),
		).toBe("Ada Lovelace (she/her)");
	});

	it("preserves the current display name when pronouns are absent", () => {
		expect(
			formatEmployeeIdentityName({
				firstName: null,
				lastName: null,
				pronouns: null,
				user: fallbackUser,
			}),
		).toBe("Ada Lovelace");
	});

	it("falls back to email local part when no display name exists", () => {
		expect(
			formatEmployeeIdentityName({
				firstName: null,
				lastName: null,
				pronouns: "they/them",
				user: { name: "", email: "sam@example.com" },
			}),
		).toBe("sam (they/them)");
	});

	it("normalizes empty and whitespace pronouns to null", () => {
		expect(normalizePronouns("   ")).toBeNull();
		expect(normalizePronouns(null)).toBeNull();
		expect(normalizePronouns(undefined)).toBeNull();
	});

	it("trims custom pronouns", () => {
		expect(normalizePronouns("  xe/xem  ")).toBe("xe/xem");
	});
});
