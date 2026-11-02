import { describe, expect, it } from "vitest";
import {
	KIOSK_FOB_SERIAL_MAX_INPUT_LENGTH,
	kioskFobLastFour,
	normalizeKioskFobSerial,
} from "./fob-serial";

describe("normalizeKioskFobSerial", () => {
	it("accepts 4, 7 and 10-byte hexadecimal serial numbers as the reader types them", () => {
		expect(normalizeKioskFobSerial("04A1B2C3")).toBe("04A1B2C3");
		expect(normalizeKioskFobSerial("04A1B2C3D4E5F6")).toBe("04A1B2C3D4E5F6");
		expect(normalizeKioskFobSerial("04A1B2C3D4E5F60718AB")).toBe("04A1B2C3D4E5F60718AB");
	});

	it("reads any case, the reader's Enter and byte separators as the same serial number", () => {
		expect(normalizeKioskFobSerial("  04a1b2c3\r\n")).toBe("04A1B2C3");
		expect(normalizeKioskFobSerial("04:a1:B2:c3")).toBe("04A1B2C3");
		expect(normalizeKioskFobSerial("04-A1-B2-C3-D4-E5-F6")).toBe("04A1B2C3D4E5F6");
		expect(normalizeKioskFobSerial("04 A1 B2 C3")).toBe("04A1B2C3");
	});

	it("never swaps byte order", () => {
		expect(normalizeKioskFobSerial("C3B2A104")).toBe("C3B2A104");
		expect(normalizeKioskFobSerial("C3:B2:A1:04")).not.toBe(normalizeKioskFobSerial("04A1B2C3"));
	});

	it("refuses decimal output, other lengths, kiosk badges and overlong input without guessing", () => {
		for (const input of [
			undefined,
			42,
			"",
			"   ",
			// A 4-byte serial number printed in decimal (10 digits), and a 7-byte one (17 digits).
			"0078234179",
			"12345678901234567",
			"04A1B2",
			"04A1B2C3D4",
			"04A1B2C3D4E5F6071",
			"04A1B2C3D4E5F60718ABCD",
			"04A1B2G3",
			"04_A1_B2_C3",
			"04.A1.B2.C3",
			`K8B${"0123456789ABCDEFGHJKMNPQRSTVWX".repeat(2).slice(0, 53)}`,
			`04A1B2C3${" ".repeat(KIOSK_FOB_SERIAL_MAX_INPUT_LENGTH)}`,
			"x".repeat(10_000),
		]) {
			expect(normalizeKioskFobSerial(input)).toBeNull();
		}
	});
});

describe("kioskFobLastFour", () => {
	it("shows only the last four hex digits of a stored serial number", () => {
		expect(kioskFobLastFour("04A1B2C3D4E5F6")).toBe("E5F6");
	});
});
