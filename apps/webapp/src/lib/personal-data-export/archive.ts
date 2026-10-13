/**
 * The personal data export archive (#811): one ZIP holding
 *
 * - `<category>.json` per category, the authoritative machine-readable copy
 *   (Art. 20): `_metadata` plus one property per part;
 * - `<category>/<part>.csv` next to it for every table part, the same rows
 *   with exactly the part's columns (header only when there are none);
 * - `<category>/<path>` for every original file the category brings;
 * - `README.txt` in the employee's language, and `_manifest.json` listing
 *   every file with its category, format, record count and size.
 *
 * The archive is written through `PersonalDataArchiveWriter`, so the in-memory
 * JSZip writer can be swapped for a streaming one (stored ZIP) once
 * categories bring large original files.
 */

import JSZip from "jszip";
import { type CsvTable, csvTableToCSV } from "@/lib/export/formatters/csv-formatter";
import type {
	CollectedCategory,
	PersonalDataExportScope,
	PersonalDataTablePart,
} from "./collector";

/** Where the archive's entries go. `finish` returns the complete ZIP. */
export interface PersonalDataArchiveWriter {
	add(path: string, content: Uint8Array): Promise<void>;
	finish(): Promise<Uint8Array>;
}

/** Builds the whole ZIP in memory (DEFLATE). Fine for JSON and CSV only archives. */
export function createInMemoryZipWriter(): PersonalDataArchiveWriter {
	const zip = new JSZip();
	return {
		async add(path, content) {
			zip.file(path, content);
		},
		finish: () =>
			zip.generateAsync({
				type: "uint8array",
				compression: "DEFLATE",
				compressionOptions: { level: 6 },
			}),
	};
}

export const PERSONAL_DATA_ARCHIVE_README = "README.txt";
export const PERSONAL_DATA_ARCHIVE_MANIFEST = "_manifest.json";
export const PERSONAL_DATA_ARCHIVE_VERSION = 1;

export interface PersonalDataArchiveInput {
	exportId: string;
	scope: PersonalDataExportScope;
	/** UTC ISO instant the data was read. */
	exportedAt: string;
	/** The README's language. */
	locale: string;
	readme: string;
	categories: readonly CollectedCategory[];
}

export interface PersonalDataManifestFile {
	path: string;
	category: string | null;
	format: "json" | "csv" | "text" | "file";
	/** Rows plus records in a JSON or CSV file; null for other files. */
	records: number | null;
	sizeBytes: number;
}

const encoder = new TextEncoder();

function csvOf(part: PersonalDataTablePart): string {
	const table: CsvTable = {
		format: "csv-table",
		columns: part.columns.map((column) => ({ key: column, header: column })),
		rows: part.rows,
	};
	return csvTableToCSV(table);
}

function categoryDocument(
	input: PersonalDataArchiveInput,
	category: CollectedCategory,
): { json: string; records: number } {
	const document: Record<string, unknown> = {
		_metadata: {
			category: category.category,
			kind: input.scope.kind,
			organizationId: input.scope.organizationId,
			employeeId: input.scope.employeeId,
			exportedAt: input.exportedAt,
		},
	};
	let records = 0;
	for (const part of category.parts) {
		if (part.kind === "table") {
			document[part.key] = part.rows;
			records += part.rows.length;
		} else {
			document[part.key] = part.record;
			if (part.record) records += 1;
		}
	}
	return { json: JSON.stringify(document, null, 2), records };
}

/** Writes every entry of one personal data export and returns the finished ZIP. */
export async function writePersonalDataArchive(
	writer: PersonalDataArchiveWriter,
	input: PersonalDataArchiveInput,
): Promise<Uint8Array> {
	const files: PersonalDataManifestFile[] = [];
	const add = async (
		path: string,
		content: Uint8Array,
		entry: Omit<PersonalDataManifestFile, "path" | "sizeBytes">,
	) => {
		await writer.add(path, content);
		files.push({ path, ...entry, sizeBytes: content.byteLength });
	};

	await add(PERSONAL_DATA_ARCHIVE_README, encoder.encode(input.readme), {
		category: null,
		format: "text",
		records: null,
	});
	for (const category of input.categories) {
		const { json, records } = categoryDocument(input, category);
		await add(`${category.category}.json`, encoder.encode(json), {
			category: category.category,
			format: "json",
			records,
		});
		for (const part of category.parts) {
			if (part.kind !== "table") continue;
			await add(`${category.category}/${part.key}.csv`, encoder.encode(csvOf(part)), {
				category: category.category,
				format: "csv",
				records: part.rows.length,
			});
		}
		for (const file of category.files ?? []) {
			await add(`${category.category}/${file.path}`, await file.read(), {
				category: category.category,
				format: "file",
				records: null,
			});
		}
	}

	const manifest = {
		version: PERSONAL_DATA_ARCHIVE_VERSION,
		exportId: input.exportId,
		kind: input.scope.kind,
		organizationId: input.scope.organizationId,
		employeeId: input.scope.employeeId,
		exportedAt: input.exportedAt,
		locale: input.locale,
		categories: input.categories.map((category) => category.category),
		files,
	};
	await writer.add(
		PERSONAL_DATA_ARCHIVE_MANIFEST,
		encoder.encode(JSON.stringify(manifest, null, 2)),
	);
	return writer.finish();
}
