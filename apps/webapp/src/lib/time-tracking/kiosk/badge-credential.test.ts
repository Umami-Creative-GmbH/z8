import { describe, expect, it } from "vitest";
import { normalizeKioskBadgeCredential } from "./badge-credential";

const valid = `K8B${"0123456789ABCDEFGHJKMNPQRSTVWX".repeat(2).slice(0, 53)}`;

describe("normalizeKioskBadgeCredential", () => {
	it("accepts a badge credential as printed in its QR code", () => {
		expect(normalizeKioskBadgeCredential(valid)).toBe(valid);
	});

	it("reads a scan typed with caps lock off or with surrounding whitespace as the same credential", () => {
		expect(normalizeKioskBadgeCredential(`  ${valid.toLowerCase()}\r\n`)).toBe(valid);
	});

	it("refuses anything that cannot be a badge credential without guessing", () => {
		for (const input of [
			undefined,
			42,
			"",
			"Ada Lovelace",
			valid.slice(0, -1),
			`${valid}0`,
			`K8K${valid.slice(3)}`,
			// Y and Z are never part of a credential: keyboard layouts swap them.
			`${valid.slice(0, -1)}Y`,
			`${valid.slice(0, -1)}Z`,
			`https://example.test/${valid}`,
			"x".repeat(10_000),
		]) {
			expect(normalizeKioskBadgeCredential(input)).toBeNull();
		}
	});
});
