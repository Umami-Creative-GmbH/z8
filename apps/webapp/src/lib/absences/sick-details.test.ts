import { describe, expect, it } from "vitest";
import { getSickDetailLabel, validateSickDetailForCategory } from "./sick-details";

describe("validateSickDetailForCategory", () => {
	it("requires sick detail for sick categories", () => {
		expect(validateSickDetailForCategory({ categoryType: "sick", sickDetail: undefined })).toBe(
			"Sick detail is required for sick absences",
		);
	});

	it("accepts sick detail for sick categories", () => {
		expect(
			validateSickDetailForCategory({ categoryType: "sick", sickDetail: "with_certificate" }),
		).toBeNull();
	});

	it("rejects sick detail for non-sick categories", () => {
		expect(
			validateSickDetailForCategory({ categoryType: "vacation", sickDetail: "child_sick" }),
		).toBe("Sick detail can only be used for sick absences");
	});
});

describe("getSickDetailLabel", () => {
	it("returns stable display labels", () => {
		expect(getSickDetailLabel("child_sick")).toBe("Child sick");
		expect(getSickDetailLabel("with_certificate")).toBe("With certificate");
		expect(getSickDetailLabel("without_certificate")).toBe("Without certificate");
		expect(getSickDetailLabel("other")).toBe("Other");
	});
});
