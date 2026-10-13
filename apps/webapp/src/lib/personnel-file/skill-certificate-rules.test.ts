import { describe, expect, it } from "vitest";
import { skillCertificateRefusal } from "./skill-certificate-rules";

describe("skillCertificateRefusal (#1144, Scheduling ADR 0001)", () => {
	it("lets a dated certificate name a skill that requires an expiry date", () => {
		expect(
			skillCertificateRefusal(
				{ category: "certificate", expiryDate: "2027-03-31" },
				{ requiresExpiry: true },
			),
		).toBeNull();
	});

	it("lets an undated certificate name a skill that never expires", () => {
		expect(
			skillCertificateRefusal(
				{ category: "certificate", expiryDate: null },
				{ requiresExpiry: false },
			),
		).toBeNull();
	});

	it("refuses an undated certificate for a skill that requires an expiry date", () => {
		expect(
			skillCertificateRefusal(
				{ category: "certificate", expiryDate: null },
				{ requiresExpiry: true },
			),
		).toBe("undated_requires_expiry");
	});

	it("refuses every other document category", () => {
		for (const category of ["contract", "payslip", "sick_note", "other"] as const) {
			expect(
				skillCertificateRefusal({ category, expiryDate: "2027-03-31" }, { requiresExpiry: false }),
			).toBe("not_certificate");
		}
	});
});
