import { describe, expect, it } from "vitest";
import {
	formatPairingCode,
	generateDeviceToken,
	generatePairingCode,
	hashKioskSecret,
	normalizePairingCode,
} from "./credentials";

describe("kiosk pairing codes", () => {
	it("shows a code as two groups of five unambiguous characters", () => {
		const code = generatePairingCode();

		expect(formatPairingCode(code)).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
		expect(normalizePairingCode(formatPairingCode(code))).toBe(code);
	});

	it("issues a different code each time", () => {
		const codes = new Set(Array.from({ length: 50 }, () => generatePairingCode()));

		expect(codes.size).toBe(50);
	});

	it("accepts a code typed in lower case, with spaces or dashes, or with look-alike letters", () => {
		expect(normalizePairingCode("abcde-fghjk")).toBe("ABCDEFGHJK");
		expect(normalizePairingCode(" ABCDE FGHJK ")).toBe("ABCDEFGHJK");
		expect(normalizePairingCode("O1I2L-3456Q")).toBe("011213456Q");
	});

	it("refuses input that cannot be a pairing code", () => {
		expect(normalizePairingCode("")).toBeNull();
		expect(normalizePairingCode("ABCDE")).toBeNull();
		expect(normalizePairingCode("ABCDE-FGHJKM")).toBeNull();
		expect(normalizePairingCode("ABCDE-FGHJ!")).toBeNull();
		expect(normalizePairingCode("ABCDE-FGHJU")).toBeNull();
		expect(normalizePairingCode(42)).toBeNull();
	});
});

describe("kiosk device tokens", () => {
	it("issues long random tokens that are never repeated", () => {
		const first = generateDeviceToken();
		const second = generateDeviceToken();

		expect(first).toMatch(/^z8k_[A-Za-z0-9_-]{43}$/);
		expect(second).not.toBe(first);
	});
});

describe("kiosk secret hashes", () => {
	it("stores the SHA-256 of a secret, never the secret", () => {
		expect(hashKioskSecret("abc")).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});
});
