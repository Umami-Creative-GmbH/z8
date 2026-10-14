import { describe, expect, it } from "vitest";
import { pickAcceptLanguage } from "./accept-language";

const SUPPORTED = ["en", "de", "fr", "it"];

describe("pickAcceptLanguage", () => {
	it("picks the best supported language by quality, then order", () => {
		expect(pickAcceptLanguage("zz, it-CH;q=0.9, de;q=0.8", SUPPORTED)).toBe("it");
		expect(pickAcceptLanguage("de;q=0.5, fr;q=0.5", SUPPORTED)).toBe("de");
		expect(pickAcceptLanguage("en;q=0.1, fr", SUPPORTED)).toBe("fr");
	});

	it("is null without a header or a supported language", () => {
		expect(pickAcceptLanguage(null, SUPPORTED)).toBeNull();
		expect(pickAcceptLanguage("zz, xx-YY", SUPPORTED)).toBeNull();
		expect(pickAcceptLanguage("de;q=0", SUPPORTED)).toBeNull();
	});
});
