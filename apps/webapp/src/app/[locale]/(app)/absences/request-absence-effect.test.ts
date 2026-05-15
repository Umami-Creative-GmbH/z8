import { describe, expect, it, vi } from "vitest";
import { validateAbsenceSickDetail } from "./request-absence-effect";

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: vi.fn(),
		},
	},
}));

describe("validateAbsenceSickDetail", () => {
	it("requires sick detail for sick requests", () => {
		expect(validateAbsenceSickDetail({ categoryType: "sick", sickDetail: undefined })).toBe(
			"Sick detail is required for sick absences",
		);
	});

	it("rejects sick detail for vacation requests", () => {
		expect(validateAbsenceSickDetail({ categoryType: "vacation", sickDetail: "child_sick" })).toBe(
			"Sick detail can only be used for sick absences",
		);
	});

	it("accepts sick detail for sick requests", () => {
		expect(
			validateAbsenceSickDetail({ categoryType: "sick", sickDetail: "without_certificate" }),
		).toBeNull();
	});
});
