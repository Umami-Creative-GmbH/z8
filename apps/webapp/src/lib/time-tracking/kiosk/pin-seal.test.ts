import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { sealKioskPin } = await import("./pin-seal");
const { kioskSealingKey, openSealedKioskPin } = await import("./pin-seal.server");

const SECRET = "t1289-sealing-secret-with-at-least-32-characters";
const OTHER_SECRET = "t1289-another-secret-with-at-least-32-characters";
const binding = {
	kioskId: "a1289000-0000-4000-8000-000000000001",
	employeeId: "a1289000-0000-4000-8000-000000000002",
	operationId: "a1289000-0000-4000-8000-000000000003",
};

describe("sealed kiosk PINs (ADR 0011)", () => {
	it("are opened by Z8 to the PIN the kiosk sealed with the published key", async () => {
		const sealed = await sealKioskPin("4711", { sealingKey: kioskSealingKey(SECRET), ...binding });

		expect(sealed.v).toBe(1);
		expect(JSON.stringify(sealed)).not.toContain("4711");
		expect(openSealedKioskPin(sealed, binding, SECRET)).toBe("4711");
	});

	it("open only for the kiosk, employee and operation they were sealed for", async () => {
		const sealed = await sealKioskPin("4711", { sealingKey: kioskSealingKey(SECRET), ...binding });

		for (const other of [
			{ ...binding, kioskId: "a1289000-0000-4000-8000-000000000009" },
			{ ...binding, employeeId: "a1289000-0000-4000-8000-000000000009" },
			{ ...binding, operationId: "a1289000-0000-4000-8000-000000000009" },
		]) {
			expect(openSealedKioskPin(sealed, other, SECRET)).toBeNull();
		}
	});

	it("do not open under another server secret, or tampered", async () => {
		const sealed = await sealKioskPin("4711", { sealingKey: kioskSealingKey(SECRET), ...binding });
		const flipped = sealed.ct.startsWith("A") ? `B${sealed.ct.slice(1)}` : `A${sealed.ct.slice(1)}`;

		expect(openSealedKioskPin(sealed, binding, OTHER_SECRET)).toBeNull();
		expect(openSealedKioskPin({ ...sealed, ct: flipped }, binding, SECRET)).toBeNull();
		expect(openSealedKioskPin({ ...sealed, epk: "AAAA" }, binding, SECRET)).toBeNull();
	});

	it("publish one stable P-256 public key per server secret", () => {
		const key = kioskSealingKey(SECRET);

		expect(key).toEqual(kioskSealingKey(SECRET));
		expect(key.kid).not.toBe(kioskSealingKey(OTHER_SECRET).kid);
		expect(key).toMatchObject({
			alg: "ECDH-P256+HKDF-SHA256+A256GCM",
			jwk: { kty: "EC", crv: "P-256", x: expect.any(String), y: expect.any(String) },
		});
		expect(JSON.stringify(key)).not.toMatch(/"d"/);
	});
});
