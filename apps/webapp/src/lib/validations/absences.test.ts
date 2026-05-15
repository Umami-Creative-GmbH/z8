import { describe, expect, it } from "vitest";
import { absenceRequestSchema } from "./absences";

describe("absenceRequestSchema sickDetail", () => {
	const baseRequest = {
		categoryId: "11111111-1111-4111-8111-111111111111",
		startDate: "2026-05-18",
		endDate: "2026-05-18",
		notes: "Called in sick",
	};

	it("accepts controlled sick detail values", () => {
		expect(
			absenceRequestSchema.parse({
				...baseRequest,
				sickDetail: "with_certificate",
			}),
		).toMatchObject({ sickDetail: "with_certificate" });
	});

	it("rejects unknown sick detail values", () => {
		expect(() =>
			absenceRequestSchema.parse({
				...baseRequest,
				sickDetail: "doctor_note",
			}),
		).toThrow();
	});
});
