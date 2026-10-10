import {
	PAYSLIP_BATCH_MAX_FILES,
	PAYSLIP_BATCH_MAX_ZIP_BYTES,
} from "@/lib/personnel-file/payslip-batch.types";

/**
 * Turns what an officer picked for a payslip batch (#868) into the PDF files
 * to upload: up to 500 PDF files, or the PDFs inside one ZIP of at most
 * 500 MB. The ZIP is unpacked in the browser, so the server only ever sees
 * single PDFs. Folders inside the ZIP are dropped from the names; system
 * entries (`__MACOSX`, dot files) are ignored and other entries skipped.
 */

export type CollectPayslipFilesResult =
	/** `skipped`: non-PDF entries of a ZIP that were left out. */
	| { ok: true; files: File[]; skipped: number }
	| {
			ok: false;
			error: "unsupported" | "too_many" | "one_zip" | "zip_too_large" | "empty" | "unreadable";
	  };

const ZIP_TYPES = new Set(["application/zip", "application/x-zip-compressed", "multipart/x-zip"]);

function isPdf(file: { name: string; type: string }): boolean {
	return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function isZip(file: { name: string; type: string }): boolean {
	return ZIP_TYPES.has(file.type) || /\.zip$/i.test(file.name);
}

function isSystemEntry(path: string): boolean {
	return path.split("/").some((part) => part === "__MACOSX" || part.startsWith("."));
}

export async function collectPayslipFiles(
	selected: readonly File[],
	options: { alreadyStaged: number },
): Promise<CollectPayslipFilesResult> {
	const room = PAYSLIP_BATCH_MAX_FILES - options.alreadyStaged;
	const zips = selected.filter(isZip);
	if (zips.length === 0) {
		if (selected.some((file) => !isPdf(file))) return { ok: false, error: "unsupported" };
		if (selected.length === 0) return { ok: false, error: "empty" };
		if (selected.length > room) return { ok: false, error: "too_many" };
		return { ok: true, files: [...selected], skipped: 0 };
	}
	const [zipFile] = zips;
	if (!zipFile || selected.length > 1) return { ok: false, error: "one_zip" };
	if (zipFile.size > PAYSLIP_BATCH_MAX_ZIP_BYTES) return { ok: false, error: "zip_too_large" };

	const { default: JSZip } = await import("jszip");
	let zip: InstanceType<typeof JSZip>;
	try {
		zip = await JSZip.loadAsync(await zipFile.arrayBuffer());
	} catch {
		return { ok: false, error: "unreadable" };
	}
	const entries = Object.values(zip.files).filter(
		(entry) => !entry.dir && !isSystemEntry(entry.name),
	);
	const pdfEntries = entries.filter((entry) => /\.pdf$/i.test(entry.name));
	if (pdfEntries.length === 0) return { ok: false, error: "empty" };
	if (pdfEntries.length > room) return { ok: false, error: "too_many" };
	const files: File[] = [];
	try {
		// Decompress one PDF at a time to bound peak ZIP expansion memory (the batch may contain 500 MB).
		// react-doctor-disable-next-line react-doctor/async-await-in-loop
		for (const entry of pdfEntries) {
			const bytes = await entry.async("arraybuffer");
			const name = entry.name.split("/").pop() || entry.name;
			files.push(new File([bytes], name, { type: "application/pdf" }));
		}
	} catch {
		return { ok: false, error: "unreadable" };
	}
	return { ok: true, files, skipped: entries.length - pdfEntries.length };
}
