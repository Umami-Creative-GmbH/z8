import { describe, expect, it } from "vitest";
import { generateReservedEmail, isReservedEmail, RESERVED_EMAIL_DOMAIN } from "./reserved-email";

describe("reserved emails (ADR 0006)", () => {
	it("recognizes the kiosk-only domain regardless of case and padding", () => {
		expect(isReservedEmail("kiosk-abc@kiosk.invalid")).toBe(true);
		expect(isReservedEmail("  Kiosk-ABC@KIOSK.Invalid ")).toBe(true);
	});

	it("does not reserve demo, look-alike or ordinary addresses", () => {
		expect(isReservedEmail("demo-abc@demo.invalid")).toBe(false);
		expect(isReservedEmail("someone@kiosk.invalid.example.com")).toBe(false);
		expect(isReservedEmail("someone@notkiosk.invalid")).toBe(false);
		expect(isReservedEmail("kiosk.invalid@example.com")).toBe(false);
		expect(isReservedEmail("alex@example.com")).toBe(false);
	});

	it("treats missing or malformed values as not reserved", () => {
		expect(isReservedEmail(undefined)).toBe(false);
		expect(isReservedEmail(null)).toBe(false);
		expect(isReservedEmail("")).toBe(false);
		expect(isReservedEmail("kiosk.invalid")).toBe(false);
	});

	it("generates a distinct reserved address for every user", () => {
		const first = generateReservedEmail();
		const second = generateReservedEmail();
		expect(first).not.toBe(second);
		expect(isReservedEmail(first)).toBe(true);
		expect(first.endsWith(`@${RESERVED_EMAIL_DOMAIN}`)).toBe(true);
		expect(first).toBe(first.toLowerCase());
	});
});
