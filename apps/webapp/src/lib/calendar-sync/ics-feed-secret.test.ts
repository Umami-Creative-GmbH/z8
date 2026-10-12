import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/app-url", () => ({
	getDefaultAppBaseUrl: () => "https://app.example.test",
}));

const {
	ICS_FEED_SECRET_HASH_VERSION,
	digestIcsFeedSecret,
	generateIcsFeedSecret,
	isWellFormedIcsFeedSecret,
	issueIcsFeedSecret,
} = await import("./ics-feed-secret");

describe("ICS feed secrets", () => {
	it("generates 64-char lowercase hex secrets", () => {
		const secret = generateIcsFeedSecret();
		expect(secret).toMatch(/^[0-9a-f]{64}$/);
		expect(generateIcsFeedSecret()).not.toBe(secret);
	});

	it("digests with hex SHA-256", () => {
		// FIPS 180-2 test vector. The migration 0176 match is covered by ics-feed.integration.test.ts.
		expect(digestIcsFeedSecret("abc")).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});

	it("only accepts path segments shaped like a generated secret", () => {
		expect(isWellFormedIcsFeedSecret("ab".repeat(32))).toBe(true);
		expect(isWellFormedIcsFeedSecret("AB".repeat(32))).toBe(false);
		expect(isWellFormedIcsFeedSecret("ab".repeat(31))).toBe(false);
		expect(isWellFormedIcsFeedSecret("secret")).toBe(false);
	});

	it("issues a URL carrying the secret and stores only its digest", () => {
		const issued = issueIcsFeedSecret();
		const secret = issued.url.replace("https://app.example.test/api/calendar/ics/", "");
		expect(secret).toMatch(/^[0-9a-f]{64}$/);
		expect(issued.secretDigest).toBe(digestIcsFeedSecret(secret));
		expect(issued.secretDigest).not.toBe(secret);
		expect(issued.secretHashVersion).toBe(ICS_FEED_SECRET_HASH_VERSION);
	});
});
