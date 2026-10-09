import { describe, expect, it } from "vitest";
import {
	applyCategoryChange,
	defaultUploadValues,
	ownUploadValues,
	toDocumentMetadata,
	valuesFromDocument,
} from "./document-form-values";

describe("personnel document form values", () => {
	it("starts an upload as a shared contract dated today", () => {
		expect(defaultUploadValues({ today: "2026-10-09", category: "contract" })).toEqual({
			category: "contract",
			title: "",
			documentDate: "2026-10-09",
			payPeriodYear: "",
			payPeriodMonth: "",
			visibility: "shared",
			visibilityChosen: false,
			expiryDate: "",
		});
	});

	it("prefills a payslip's pay period with the month of the document date", () => {
		expect(defaultUploadValues({ today: "2026-10-09", category: "payslip" })).toMatchObject({
			payPeriodYear: "2026",
			payPeriodMonth: "10",
		});
	});

	it("follows the category's default visibility until the uploader picks one", () => {
		const start = defaultUploadValues({ today: "2026-10-09", category: "contract" });
		expect(applyCategoryChange(start, "sick_note").visibility).toBe("hr_only");
		expect(
			applyCategoryChange({ ...start, visibility: "shared", visibilityChosen: true }, "sick_note")
				.visibility,
		).toBe("shared");
	});

	it("drops a pay period and an expiry date the new category does not allow", () => {
		const certificate = {
			...defaultUploadValues({ today: "2026-10-09", category: "certificate" }),
			expiryDate: "2027-01-31",
		};
		expect(applyCategoryChange(certificate, "contract").expiryDate).toBe("");
		const payslip = defaultUploadValues({ today: "2026-10-09", category: "payslip" });
		expect(applyCategoryChange(payslip, "other")).toMatchObject({
			payPeriodYear: "",
			payPeriodMonth: "",
		});
	});

	it("builds the metadata a server action receives", () => {
		expect(
			toDocumentMetadata({
				...defaultUploadValues({ today: "2026-10-09", category: "payslip" }),
				title: " Payslip ",
			}),
		).toEqual({
			category: "payslip",
			title: " Payslip ",
			documentDate: "2026-10-09",
			payPeriod: { year: 2026, month: 10 },
			visibility: "shared",
			expiryDate: null,
		});
	});

	it("starts an employee's own upload as a shared certificate that stays shared as other", () => {
		const start = ownUploadValues({ today: "2026-10-09" });
		expect(start).toMatchObject({
			category: "certificate",
			documentDate: "2026-10-09",
			visibility: "shared",
		});
		const other = applyCategoryChange({ ...start, expiryDate: "2027-12-31" }, "other");
		expect(toDocumentMetadata(other)).toMatchObject({
			category: "other",
			visibility: "shared",
			expiryDate: "2027-12-31",
		});
	});

	it("edits an existing document's metadata as it is", () => {
		expect(
			valuesFromDocument({
				category: "certificate",
				title: "First aid",
				documentDate: "2026-01-05",
				payPeriod: null,
				visibility: "hr_only",
				expiryDate: "2028-01-04",
			}),
		).toEqual({
			category: "certificate",
			title: "First aid",
			documentDate: "2026-01-05",
			payPeriodYear: "",
			payPeriodMonth: "",
			visibility: "hr_only",
			visibilityChosen: true,
			expiryDate: "2028-01-04",
		});
	});
});
