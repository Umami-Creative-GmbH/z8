import { describe, expect, it } from "vitest";
import { decryptImportCredential, encryptImportCredential } from "./credential-secret";

describe("import credential secrets", () => {
	it("encrypts credentials without storing plaintext", () => {
		const encrypted = encryptImportCredential("clockin-token", "test-secret-that-is-long-enough-for-better-auth");

		expect(encrypted.ciphertext).not.toContain("clockin-token");
		expect(decryptImportCredential(encrypted, "test-secret-that-is-long-enough-for-better-auth")).toBe("clockin-token");
	});

	it("rejects expired credentials", () => {
		const encrypted = encryptImportCredential("clockin-token", "test-secret-that-is-long-enough-for-better-auth");

		expect(() =>
			decryptImportCredential(
				{ ...encrypted, expiresAt: new Date("2020-01-01T00:00:00.000Z") },
				"test-secret-that-is-long-enough-for-better-auth",
				new Date("2026-01-01T00:00:00.000Z"),
			),
		).toThrow("Import credential has expired");
	});
});
