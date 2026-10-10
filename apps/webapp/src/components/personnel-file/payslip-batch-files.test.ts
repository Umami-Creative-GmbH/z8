import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { collectPayslipFiles } from "./payslip-batch-files";

const pdf = (name: string) => new File(["%PDF-1.4\n%%EOF"], name, { type: "application/pdf" });

async function zipOf(entries: Record<string, string>, name = "payslips.zip"): Promise<File> {
	const zip = new JSZip();
	for (const [path, content] of Object.entries(entries)) zip.file(path, content);
	const bytes = await zip.generateAsync({ type: "uint8array" });
	return new File([bytes], name, { type: "application/zip" });
}

describe("collectPayslipFiles", () => {
	it("takes selected PDF files as they are", async () => {
		const files = [pdf("0042.pdf"), pdf("0043.pdf")];
		await expect(collectPayslipFiles(files, { alreadyStaged: 0 })).resolves.toEqual({
			ok: true,
			files,
			skipped: 0,
		});
	});

	it("refuses files that are not PDF or ZIP", async () => {
		const result = await collectPayslipFiles(
			[pdf("0042.pdf"), new File(["x"], "photo.png", { type: "image/png" })],
			{ alreadyStaged: 0 },
		);
		expect(result).toEqual({ ok: false, error: "unsupported" });
	});

	it("refuses more than 500 files counting those already staged", async () => {
		const result = await collectPayslipFiles([pdf("a.pdf"), pdf("b.pdf")], { alreadyStaged: 499 });
		expect(result).toEqual({ ok: false, error: "too_many" });
	});

	it("unpacks the PDFs of one ZIP and skips other entries and system files", async () => {
		const zip = await zipOf({
			"2026-09/0042_payslip.pdf": "%PDF-1.4",
			"0043.PDF": "%PDF-1.4",
			"readme.txt": "hello",
			"__MACOSX/2026-09/._0042_payslip.pdf": "junk",
			".DS_Store": "junk",
		});
		const result = await collectPayslipFiles([zip], { alreadyStaged: 0 });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.files.map((file) => file.name).sort()).toEqual(["0042_payslip.pdf", "0043.PDF"]);
		expect(result.files.every((file) => file.type === "application/pdf")).toBe(true);
		expect(result.skipped).toBe(1);
	});

	it("takes one ZIP only, never mixed with other files", async () => {
		const zip = await zipOf({ "0042.pdf": "%PDF-1.4" });
		await expect(
			collectPayslipFiles([zip, pdf("0043.pdf")], { alreadyStaged: 0 }),
		).resolves.toEqual({
			ok: false,
			error: "one_zip",
		});
	});

	it("refuses a ZIP larger than 500 MB without reading it", async () => {
		const huge = { name: "huge.zip", type: "application/zip", size: 500 * 1024 * 1024 + 1 } as File;
		await expect(collectPayslipFiles([huge], { alreadyStaged: 0 })).resolves.toEqual({
			ok: false,
			error: "zip_too_large",
		});
	});

	it("reports a ZIP without PDFs and one that cannot be read", async () => {
		await expect(
			collectPayslipFiles([await zipOf({ "a.txt": "x" })], { alreadyStaged: 0 }),
		).resolves.toEqual({ ok: false, error: "empty" });
		await expect(
			collectPayslipFiles([new File(["not a zip"], "broken.zip")], { alreadyStaged: 0 }),
		).resolves.toEqual({ ok: false, error: "unreadable" });
	});
});
