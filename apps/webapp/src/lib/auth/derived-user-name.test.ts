import { describe, expect, it } from "vitest";
import {
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
});
