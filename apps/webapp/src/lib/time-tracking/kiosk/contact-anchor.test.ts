import { describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";

vi.mock("server-only", () => ({}));

const { signKioskContact, verifyKioskContact } = await import("./contact-anchor");

const SECRET = "t1289-contact-secret-with-at-least-32-characters";
const kiosk = {
	organizationId: "t1289-org",
	kioskId: "a1289000-0000-4000-8000-000000000001",
	tokenHash: "a".repeat(64),
};

describe("signed kiosk contact anchors", () => {
	it("carry Z8's time at the contact, verifiable for the same kiosk and token", () => {
		const anchor = signKioskContact(kiosk, parseInstant("2026-07-22T06:00:00.123Z"), SECRET);

		expect(anchor.serverTime).toBe("2026-07-22T06:00:00.123Z");
		expect(verifyKioskContact(anchor, kiosk, SECRET)?.toString()).toBe("2026-07-22T06:00:00.123Z");
	});

	it("verify for no other kiosk, token, organization, instant or secret", () => {
		const anchor = signKioskContact(kiosk, parseInstant("2026-07-22T06:00:00Z"), SECRET);

		expect(verifyKioskContact(anchor, { ...kiosk, tokenHash: "b".repeat(64) }, SECRET)).toBeNull();
		expect(
			verifyKioskContact(
				anchor,
				{ ...kiosk, kioskId: "a1289000-0000-4000-8000-000000000009" },
				SECRET,
			),
		).toBeNull();
		expect(verifyKioskContact(anchor, { ...kiosk, organizationId: "other" }, SECRET)).toBeNull();
		expect(
			verifyKioskContact({ ...anchor, serverTime: "2026-07-21T06:00:00Z" }, kiosk, SECRET),
		).toBeNull();
		expect(
			verifyKioskContact(anchor, kiosk, "t1289-another-secret-with-at-least-32-chars"),
		).toBeNull();
	});
});
