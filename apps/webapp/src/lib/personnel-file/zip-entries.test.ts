import { describe, expect, it } from "vitest";
import { personnelFileZipEntryNames, personnelFileZipFileName } from "./zip-entries";

const doc = (
	overrides: Partial<Parameters<typeof personnelFileZipEntryNames>[0][number]> = {},
) => ({
	id: "d1",
	category: "contract" as const,
	title: "Employment contract",
	documentDate: "2026-03-01",
	mimeType: "application/pdf",
	fileName: "contract.pdf",
	...overrides,
});

describe("personnelFileZipEntryNames", () => {
	it("arranges files as <category>/<document date>_<title>.<ext>", () => {
		expect(
			personnelFileZipEntryNames([
				doc(),
				doc({
					id: "d2",
					category: "payslip",
					title: "Payslip March",
					documentDate: "2026-03-31",
					mimeType: "image/jpeg",
					fileName: "scan.jpeg",
				}),
				doc({ id: "d3", category: "sick_note", title: "AU", mimeType: "image/png" }),
			]),
		).toEqual([
			"contract/2026-03-01_Employment contract.pdf",
			"payslip/2026-03-31_Payslip March.jpg",
			"sick_note/2026-03-01_AU.png",
		]);
	});

	it("makes name collisions unique, ignoring letter case", () => {
		expect(
			personnelFileZipEntryNames([
				doc({ id: "a", title: "Payslip" }),
				doc({ id: "b", title: "payslip" }),
				doc({ id: "c", title: "Payslip" }),
				doc({ id: "d", title: "Payslip (2)" }),
			]),
		).toEqual([
			"contract/2026-03-01_Payslip.pdf",
			"contract/2026-03-01_payslip (2).pdf",
			"contract/2026-03-01_Payslip (3).pdf",
			"contract/2026-03-01_Payslip (2) (2).pdf",
		]);
	});

	it("keeps titles from escaping their folder or breaking file systems", () => {
		expect(
			personnelFileZipEntryNames([
				doc({ id: "a", title: "../../etc/passwd" }),
				doc({ id: "b", title: 'Zeugnis: "gut" <A|B>?*\\' }),
				doc({ id: "c", title: "  ...  " }),
				doc({ id: "d", title: "Line\nbreak\ttab" }),
				doc({ id: "e", title: "x".repeat(300) }),
			]),
		).toEqual([
			"contract/2026-03-01_.._.._etc_passwd.pdf",
			"contract/2026-03-01_Zeugnis_ _gut_ _A_B____.pdf",
			"contract/2026-03-01_document.pdf",
			"contract/2026-03-01_Line break tab.pdf",
			`contract/2026-03-01_${"x".repeat(120)}.pdf`,
		]);
	});

	it("names the archive after the employee", () => {
		expect(personnelFileZipFileName("Anna Früh")).toBe("personnel-file_Anna Früh.zip");
		expect(personnelFileZipFileName("a/b")).toBe("personnel-file_a_b.zip");
	});

	it("falls back to the original file extension for unknown file types", () => {
		expect(
			personnelFileZipEntryNames([
				doc({ mimeType: "application/octet-stream", fileName: "legacy.TIFF" }),
				doc({ id: "b", mimeType: "application/octet-stream", fileName: "no-extension" }),
			]),
		).toEqual([
			"contract/2026-03-01_Employment contract.tiff",
			"contract/2026-03-01_Employment contract",
		]);
	});
});
