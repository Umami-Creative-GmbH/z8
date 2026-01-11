import JSZip from "jszip";
import { createLogger } from "@/lib/logger";
import type { ExportCategory } from "./data-fetchers";
import { CSV_COLUMNS, isCSVCategory, toCSV } from "./formatters/csv-formatter";
import {
	CATEGORY_DESCRIPTIONS,
	countRecords,
	isJSONCategory,
	toJSON,
} from "./formatters/json-formatter";

const logger = createLogger("ZipBuilder");

export interface ExportFile {
	name: string;
	content: string;
	type: "json" | "csv";
}

/**
 * Build export files for each category's data
 */
export function buildExportFiles(
	organizationId: string,
	data: Record<string, unknown>,
): ExportFile[] {
	const files: ExportFile[] = [];

	for (const [category, categoryData] of Object.entries(data)) {
		if (isCSVCategory(category)) {
			// Handle CSV categories - may have nested data
			const csvFiles = buildCSVFiles(category as ExportCategory, categoryData);
			files.push(...csvFiles);
		} else if (isJSONCategory(category)) {
			// Handle JSON categories
			const jsonFile = buildJSONFile(category as ExportCategory, categoryData, organizationId);
			files.push(jsonFile);
		}
	}

	return files;
}

/**
 * Build CSV file(s) for a category
 */
function buildCSVFiles(category: ExportCategory, data: unknown): ExportFile[] {
	const files: ExportFile[] = [];

	// Some categories have nested data (e.g., absences has both absences and categories)
	if (typeof data === "object" && data !== null && !Array.isArray(data)) {
		const dataObj = data as Record<string, unknown[]>;

		// Main data array
		if (category === "absences" && dataObj.absences) {
			files.push({
				name: `${category}.csv`,
				content: toCSV(dataObj.absences as Record<string, unknown>[], CSV_COLUMNS.absences),
				type: "csv",
			});
			// Also export categories as JSON since it's config data
			if (dataObj.categories && (dataObj.categories as unknown[]).length > 0) {
				files.push({
					name: `${category}_categories.json`,
					content: toJSON(dataObj.categories, {
						category: `${category}_categories`,
						recordCount: (dataObj.categories as unknown[]).length,
					}),
					type: "json",
				});
			}
		} else if (category === "shifts") {
			// Shifts has templates, shifts, and requests
			if (dataObj.shifts && (dataObj.shifts as unknown[]).length > 0) {
				files.push({
					name: `${category}.csv`,
					content: toCSV(dataObj.shifts as Record<string, unknown>[], CSV_COLUMNS.shifts),
					type: "csv",
				});
			}
			if (dataObj.templates && (dataObj.templates as unknown[]).length > 0) {
				files.push({
					name: `${category}_templates.json`,
					content: toJSON(dataObj.templates, {
						category: `${category}_templates`,
						recordCount: (dataObj.templates as unknown[]).length,
					}),
					type: "json",
				});
			}
			if (dataObj.requests && (dataObj.requests as unknown[]).length > 0) {
				files.push({
					name: `${category}_requests.csv`,
					content: toCSV(dataObj.requests as Record<string, unknown>[]),
					type: "csv",
				});
			}
		} else {
			// Generic handling for other nested structures
			for (const [key, value] of Object.entries(dataObj)) {
				if (Array.isArray(value) && value.length > 0) {
					const columns = CSV_COLUMNS[category as keyof typeof CSV_COLUMNS];
					files.push({
						name: key === category ? `${category}.csv` : `${category}_${key}.csv`,
						content: toCSV(value as Record<string, unknown>[], columns),
						type: "csv",
					});
				}
			}
		}
	} else if (Array.isArray(data)) {
		// Simple array data
		const columns = CSV_COLUMNS[category as keyof typeof CSV_COLUMNS];
		files.push({
			name: `${category}.csv`,
			content: toCSV(data as Record<string, unknown>[], columns),
			type: "csv",
		});
	}

	return files;
}

/**
 * Build JSON file for a category
 */
function buildJSONFile(
	category: ExportCategory,
	data: unknown,
	organizationId: string,
): ExportFile {
	return {
		name: `${category}.json`,
		content: toJSON(data, {
			organizationId,
			category,
			recordCount: countRecords(data),
		}),
		type: "json",
	};
}

/**
 * Create a ZIP archive from export files
 * @param files - Array of export files
 * @param organizationId - Organization ID for the export
 * @returns Buffer containing the ZIP file
 */
export async function createZipArchive(
	files: ExportFile[],
	organizationId: string,
): Promise<Buffer> {
	logger.info({ fileCount: files.length, organizationId }, "Creating ZIP archive");

	const zip = new JSZip();

	// Add each file to the archive
	for (const file of files) {
		zip.file(file.name, file.content);
	}

	// Add a manifest file
	const manifest = {
		exportedAt: new Date().toISOString(),
		organizationId,
		files: files.map((f) => ({
			name: f.name,
			type: f.type,
			sizeBytes: Buffer.byteLength(f.content, "utf8"),
		})),
		version: "1.0",
	};

	zip.file("_manifest.json", JSON.stringify(manifest, null, 2));

	// Generate the ZIP buffer
	const buffer = await zip.generateAsync({
		type: "nodebuffer",
		compression: "DEFLATE",
		compressionOptions: { level: 6 },
	});

	logger.info({ sizeBytes: buffer.length, fileCount: files.length }, "ZIP archive created");

	return buffer;
}

/**
 * Build and create a complete export ZIP
 */
export async function buildExportZip(
	organizationId: string,
	data: Record<string, unknown>,
): Promise<Buffer> {
	const files = buildExportFiles(organizationId, data);
	return createZipArchive(files, organizationId);
}
