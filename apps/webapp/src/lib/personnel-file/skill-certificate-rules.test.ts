import { describe, expect, it } from "vitest";
import { certificateSkillExpiryDate, skillCertificateRefusal } from "./skill-certificate-rules";

describe("certificateSkillExpiryDate (#1145, Scheduling ADR 0001)", () => {
	it("is the latest expiry date among the dated skill certificates", () => {
		expect(certificateSkillExpiryDate(["2027-03-31", "2028-03-31"])).toBe("2028-03-31");
		expect(certificateSkillExpiryDate(["2028-03-31", "2026-12-31", "2027-03-31"])).toBe(
			"2028-03-31",
		);
	});

	it("ignores undated skill certificates", () => {
		expect(certificateSkillExpiryDate([null, "2027-03-31", null])).toBe("2027-03-31");
	});

	it("is null without a dated skill certificate, so the skill keeps its date", () => {
		expect(certificateSkillExpiryDate([])).toBeNull();
		expect(certificateSkillExpiryDate([null, null])).toBeNull();
	});
});

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
