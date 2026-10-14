import { describe, expect, it } from "vitest";
import { ALL_LANGUAGES } from "@/tolgee/shared";
import {
	fallbackReadmeTranslator,
	loadReadmeTranslator,
	type PersonalDataReadmeAccess,
	renderPersonalDataExportReadme,
} from "./readme";

const nobody: PersonalDataReadmeAccess = {
	ownersAndAdmins: [],
	managers: [],
	personnelFileOfficers: [],
	payrollOfficers: [],
	expenseOfficers: [],
};

const base = {
	t: fallbackReadmeTranslator,
	organizationName: "Acme GmbH",
	employeeName: "Ada Lovelace",
	exportedAt: "2026-10-13T08:00:00Z",
	categories: ["employment"] as const,
	access: nobody,
	retention: { documentYears: {}, auditLogDays: 365 },
};

describe("renderPersonalDataExportReadme", () => {
	it("names the organization, the employee and the files of an employee export", () => {
		const readme = renderPersonalDataExportReadme({ ...base, kind: "employee" });

		expect(readme).toContain("Your personal data from Acme GmbH");
		expect(readme).toContain(
			"the personal data Acme GmbH keeps about Ada Lovelace, as read on 2026-10-13T08:00:00Z (UTC)",
		);
		expect(readme).toContain("You requested this export yourself.");
		expect(readme).toContain("employment.json");
		expect(readme).toContain("The folder employment/ holds the same tables as CSV files.");
		expect(readme).toContain("_manifest.json");
		expect(readme).not.toContain("time.json");
	});

	it("says an administrator created an admin export", () => {
		const readme = renderPersonalDataExportReadme({ ...base, kind: "admin" });

		expect(readme).toContain("An administrator of Acme GmbH created this export on your behalf.");
		expect(readme).not.toContain("You requested this export yourself.");
	});

	it("describes an admin export's account data as name and email only, without a CSV folder", () => {
		const readme = renderPersonalDataExportReadme({
			...base,
			kind: "admin",
			categories: ["employment", "account"],
			csvCategories: ["employment"],
		});

		expect(readme).toContain("account.json");
		expect(readme).toContain("The name and email address of your user account.");
		expect(readme).not.toContain("sessions, sign-in methods");
		expect(readme).toContain("The folder employment/ holds the same tables as CSV files.");
		expect(readme).not.toContain("The folder account/");
	});

	it("lists everyone who can access the data by name, with what each grant covers", () => {
		const readme = renderPersonalDataExportReadme({
			...base,
			kind: "employee",
			access: {
				ownersAndAdmins: [
					{ name: "Olga Owner", role: "owner" },
					{ name: "Adam Admin", role: "admin" },
				],
				managers: [
					{ name: "Max Manager", via: "direct" },
					{ name: "Tina Teamlead", via: "team" },
				],
				personnelFileOfficers: [{ name: "Petra Personnel", categories: ["contract", "payslip"] }],
				payrollOfficers: [
					{ name: "Paul Payroll", covers: ["employee"] },
					{ name: "Pia Paydesk", covers: ["all"] },
					{ name: "Pete Payteam", covers: ["employee", "team"] },
				],
				expenseOfficers: [
					{ name: "Erik Expense", canExport: true, canRecordReimbursements: false },
					{ name: "Rita Refund", canExport: false, canRecordReimbursements: true },
				],
			},
		});

		const section = sectionOf(readme, "Who can access your data");
		expect(section).toContain("Olga Owner (owner)");
		expect(section).toContain("Adam Admin (administrator)");
		expect(section).toContain("Max Manager (your manager)");
		expect(section).toContain("Tina Teamlead (team permissions for your team)");
		expect(section).toContain("Petra Personnel: Contracts, Payslips");
		expect(section).toContain("Paul Payroll (you by name)");
		expect(section).toContain("Pia Paydesk (all employees)");
		expect(section).toContain("Pete Payteam (you by name, your team)");
		expect(section).toContain("Erik Expense: read approved reports, export them");
		expect(section).toContain("Rita Refund: read approved reports, record reimbursements");
	});

	it("says so when nobody holds a kind of access", () => {
		const section = sectionOf(
			renderPersonalDataExportReadme({ ...base, kind: "employee" }),
			"Who can access your data",
		);

		expect(section).toContain("Personnel file officers");
		expect(section.match(/- Nobody\./g)).toHaveLength(5);
	});

	it("lists the configured retention period per document category and the audit log lifetime", () => {
		const section = sectionOf(
			renderPersonalDataExportReadme({
				...base,
				kind: "employee",
				retention: { documentYears: { contract: 10, payslip: 1 }, auditLogDays: 365 },
			}),
			"How long your data is kept",
		);

		expect(section).toContain("Contracts: 10 years");
		expect(section).toContain("Payslips: 1 year");
		expect(section).toContain("Certificates: no retention period set");
		expect(section).toContain("Sick notes: no retention period set");
		expect(section).toContain("Other documents: no retention period set");
		expect(section).toContain("Audit log entries are deleted after 365 days.");
	});

	it("explains the rights under Art. 15 to 21 and the right to complain", () => {
		const section = sectionOf(
			renderPersonalDataExportReadme({ ...base, kind: "admin" }),
			"Your rights",
		);

		for (const article of ["15", "16", "17", "18", "19", "20", "21", "77"]) {
			expect(section).toContain(`(Art. ${article} GDPR)`);
		}
		expect(section).toContain("supervisory authority");
		expect(section).toContain("privacy notice of Acme GmbH");
	});

	it("tells only the employee export that a complete copy can be requested from the admins", () => {
		const note = "You can ask the administrators of Acme GmbH for a complete copy";

		expect(renderPersonalDataExportReadme({ ...base, kind: "employee" })).toContain(note);
		expect(renderPersonalDataExportReadme({ ...base, kind: "admin" })).not.toContain(note);
	});

	it("explains every part and field of the archive with the collectors' field guides", () => {
		const readme = renderPersonalDataExportReadme({
			...base,
			kind: "employee",
			contents: {
				employment: {
					parts: [
						{ key: "employee", kind: "record", fields: ["first_name"] },
						{ key: "skills", kind: "table", fields: ["skill", "expires_on"] },
					],
					guide: (t) => ({
						employee: {
							summary: t("test.employee", "Your employee record."),
							fields: { first_name: t("test.firstName", "Your first name.") },
						},
						skills: {
							summary: t("test.skills", "Your skills."),
							fields: {
								skill: t("test.skill", "The skill."),
								expires_on: t("test.expiresOn", "The day it expires."),
							},
						},
						billable_rates: {
							summary: t("test.billable", "Billable rates."),
							fields: { hourly_rate: t("test.rate", "The rate.") },
						},
					}),
				},
			},
		});

		const section = sectionOf(readme, "Fields");
		expect(section).toContain("employment.json > employee: Your employee record.");
		expect(section).toContain("first_name: Your first name.");
		expect(section).toContain("employment.json > skills (employment/skills.csv): Your skills.");
		expect(section).toContain("expires_on: The day it expires.");
		// Only parts that are in the archive are explained.
		expect(readme).not.toContain("billable_rates");
		expect(readme).not.toContain("Billable rates.");
	});

	it("renders the Art. 15 sections in every supported UI language", async () => {
		for (const locale of ALL_LANGUAGES) {
			const t = await loadReadmeTranslator(locale);
			const readme = renderPersonalDataExportReadme({ ...base, t, kind: "employee" });
			// Article numbers survive translation; untranslated keys fall back to English.
			for (const article of ["15", "16", "17", "18", "19", "20", "21", "77"]) {
				expect(readme, `${locale} Art. ${article}`).toMatch(new RegExp(`\\b${article}\\b`));
			}
			expect(readme, locale).not.toMatch(/personalDataExport\.readme\./);
		}
	});
});

/** The text of one README section: from its heading to the next heading. */
function sectionOf(readme: string, heading: string): string {
	const lines = readme.split("\n");
	const start = lines.indexOf(heading);
	expect(start, heading).toBeGreaterThanOrEqual(0);
	const rest = lines.slice(start + 2);
	const end = rest.findIndex((line, index) => /^=+$/.test(rest[index + 1] ?? "") && line !== "");
	return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}
