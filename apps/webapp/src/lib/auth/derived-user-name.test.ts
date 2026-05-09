import { describe, expect, it } from "vitest";
import {
	buildAuthUserDisplayName,
	buildDerivedUserName,
	toAuthStructuredName,
	trimStructuredNamePart,
} from "./derived-user-name";

describe("structured auth user name derivation", () => {
	it("trims name parts before combining them", () => {
		expect(buildDerivedUserName("  Ada ", " Lovelace  ")).toBe("Ada Lovelace");
	});

	it("returns the available structured name part when only one exists", () => {
		expect(buildDerivedUserName("  Prince ", "   ")).toBe("Prince");
	});

	it("returns a structured auth payload with trimmed names and derived name", () => {
		expect(
			toAuthStructuredName({
				firstName: "  ",
				lastName: " Lovelace  ",
			}),
		).toEqual({
			firstName: undefined,
			lastName: "Lovelace",
			name: "Lovelace",
		});
	});

	it("omits blank structured parts and returns an empty derived name when both are blank", () => {
		expect(
			toAuthStructuredName({
				firstName: "  ",
				lastName: " ",
			}),
		).toEqual({
			firstName: undefined,
			lastName: undefined,
			name: "",
		});
	});

	it("preserves a fallback name when deriving a write-safe structured payload", () => {
		expect(
			toAuthStructuredName({
				firstName: " ",
				lastName: " ",
				fallbackName: " Existing Name ",
			}),
		).toEqual({
			firstName: undefined,
			lastName: undefined,
			name: "Existing Name",
		});
	});

	it("prefers trimmed structured parts over the fallback name when both exist", () => {
		expect(
			toAuthStructuredName({
				firstName: " Ada ",
				lastName: " Lovelace ",
				fallbackName: " Existing Name ",
			}),
		).toEqual({
			firstName: "Ada",
			lastName: "Lovelace",
			name: "Ada Lovelace",
		});
	});

	it("normalizes blank structured name parts to undefined", () => {
		expect(trimStructuredNamePart("  ")).toBeUndefined();
		expect(trimStructuredNamePart("  Hopper ")).toBe("Hopper");
		expect(trimStructuredNamePart(undefined)).toBeUndefined();
	});

	it("prefers and trims structured auth names over fallback auth name and email", () => {
		expect(
			buildAuthUserDisplayName({
				firstName: " Ada ",
				lastName: " Lovelace ",
				name: "Countess",
				email: "ada@example.com",
			}),
		).toBe("Ada Lovelace");
	});

	it("falls back to auth name when structured auth names are null", () => {
		expect(
			buildAuthUserDisplayName({
				firstName: null,
				lastName: null,
				name: " Countess ",
				email: "ada@example.com",
			}),
		).toBe("Countess");
	});

	it("falls back to email when structured auth names and auth name are empty", () => {
		expect(
			buildAuthUserDisplayName({
				firstName: " ",
				lastName: "",
				name: " ",
				email: " ada@example.com ",
			}),
		).toBe("ada@example.com");
	});
});
