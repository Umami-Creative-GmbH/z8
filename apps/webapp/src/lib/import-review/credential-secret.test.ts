import { describe, expect, it } from "vitest";
import { decryptImportCredential, encryptImportCredential } from "./credential-secret";

describe("import credential secrets", () => {
	const secret = "test-secret-that-is-long-enough-for-better-auth";
	const otherSecret = "different-test-secret-that-is-long-enough";

	it("encrypts credentials without storing plaintext", () => {
		const encrypted = encryptImportCredential("clockin-token", secret);

		expect(encrypted.ciphertext).not.toContain("clockin-token");
		expect(decryptImportCredential(encrypted, secret)).toBe("clockin-token");
	});

	it("rejects expired credentials", () => {
		const encrypted = encryptImportCredential("clockin-token", secret);

		expect(() =>
			decryptImportCredential(
				{ ...encrypted, expiresAt: new Date("2020-01-01T00:00:00.000Z") },
				secret,
				new Date("2026-01-01T00:00:00.000Z"),
			),
		).toThrow("Import credential has expired");
	});

	it("rejects secrets shorter than 32 characters", () => {
		expect(() => encryptImportCredential("clockin-token", "")).toThrow(
			"Import credential secret must be at least 32 characters",
		);
		expect(() => encryptImportCredential("clockin-token", "short-secret")).toThrow(
			"Import credential secret must be at least 32 characters",
		);
	});

	it("fails to decrypt with the wrong secret", () => {
		const encrypted = encryptImportCredential("clockin-token", secret);

		expect(() => decryptImportCredential(encrypted, otherSecret)).toThrow();
	});

	it("fails to decrypt when ciphertext, auth tag, or iv are tampered with", () => {
		const encrypted = encryptImportCredential("clockin-token", secret);

		expect(() => decryptImportCredential({ ...encrypted, ciphertext: "AAAA" }, secret)).toThrow();
		expect(() => decryptImportCredential({ ...encrypted, authTag: "AAAA" }, secret)).toThrow();
		expect(() =>
			decryptImportCredential({ ...encrypted, iv: "AAAAAAAAAAAAAAAA" }, secret),
		).toThrow();
	});

	it("uses a unique iv for each encryption", () => {
		const first = encryptImportCredential(
			"clockin-token",
			secret,
			new Date("2026-01-01T00:00:00.000Z"),
		);
		const second = encryptImportCredential(
			"clockin-token",
			secret,
			new Date("2026-01-01T00:00:00.000Z"),
		);

		expect(first.iv).not.toBe(second.iv);
		expect(first.ciphertext).not.toBe(second.ciphertext);
	});

	it("fails to decrypt when expiry is tampered with before it expires", () => {
		const encrypted = encryptImportCredential(
			"clockin-token",
			secret,
			new Date("2026-01-01T00:00:00.000Z"),
		);

		expect(() =>
			decryptImportCredential(
				{ ...encrypted, expiresAt: new Date("2026-01-02T00:00:00.000Z") },
				secret,
				new Date("2025-12-31T00:00:00.000Z"),
			),
		).toThrow();
	});
});
