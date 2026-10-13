/**
 * Personnel file category of a personal data export (#811, #1169; Personnel
 * File ADRs 0001 and 0002).
 *
 * The employee's documents as original files, sick notes included (with the
 * days of the absence they cover), under `personnel_file/<category>/` with
 * the personnel file ZIP's collision-safe names. Each file is read and
 * verified against its recorded size and checksum only while the archive is
 * written; rows reference it by its path inside the ZIP (`file`). Storage
 * identity (key, bucket, version, checksum) is never exported.
 *
 * Withheld from the employee export: HR-only documents. The employee export
 * holds exactly the documents the employee sees in their own file (shared).
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import { absenceEntry, employeeDocument } from "@/db/schema";
import { readVerifiedDocumentObject } from "@/lib/personnel-file/document-object";
import { personnelFileZipEntryNames } from "@/lib/personnel-file/zip-entries";
import {
	type CollectedCategory,
	type PersonalDataCollector,
	type PersonalDataExportDatabase,
	type PersonalDataExportScope,
	type PersonalDataFile,
	tablePart,
} from "../collector";
import { instantText, loadUserNames, nameOf } from "../values";
import { personnelFileFieldGuide } from "./personnel-file-fields";

const CATEGORY = "personnel_file";

export const personnelFileCollector: PersonalDataCollector = {
	category: CATEGORY,
	collect: collectPersonnelFile,
	fields: personnelFileFieldGuide,
};

async function collectPersonnelFile(
	database: PersonalDataExportDatabase,
	scope: PersonalDataExportScope,
): Promise<CollectedCategory> {
	const { organizationId, employeeId } = scope;
	const documents = await database
		.select()
		.from(employeeDocument)
		.where(
			and(
				eq(employeeDocument.organizationId, organizationId),
				eq(employeeDocument.employeeId, employeeId),
				...(scope.kind === "employee" ? [eq(employeeDocument.visibility, "shared")] : []),
			),
		)
		.orderBy(
			asc(employeeDocument.category),
			asc(employeeDocument.documentDate),
			asc(employeeDocument.createdAt),
			asc(employeeDocument.id),
		);

	// The absences sick notes cover: always the employee's own (absence_entry's
	// organization column is nullable, so scope through the employee too).
	const absenceIds = [...new Set(documents.flatMap((document) => document.absenceEntryId ?? []))];
	const absences =
		absenceIds.length === 0
			? []
			: await database
					.select({
						id: absenceEntry.id,
						startDate: absenceEntry.startDate,
						endDate: absenceEntry.endDate,
					})
					.from(absenceEntry)
					.where(
						and(
							eq(absenceEntry.organizationId, organizationId),
							eq(absenceEntry.employeeId, employeeId),
							inArray(absenceEntry.id, absenceIds),
						),
					);
	const absenceDays = new Map(absences.map((absence) => [absence.id, absence]));
	const userNames = await loadUserNames(
		database,
		documents.flatMap((document) => [document.uploadedBy, document.updatedBy]),
	);

	const names = personnelFileZipEntryNames(documents);
	const files: PersonalDataFile[] = [];
	const rows = documents.map((document, index) => {
		const path = names[index] as string;
		files.push({ path, read: () => readVerifiedDocumentObject(document) });
		const absence = document.absenceEntryId ? absenceDays.get(document.absenceEntryId) : undefined;
		return {
			id: document.id,
			category: document.category,
			title: document.title,
			document_date: document.documentDate,
			pay_period_year: document.payPeriodYear,
			pay_period_month: document.payPeriodMonth,
			visibility: document.visibility,
			expiry_date: document.expiryDate,
			absence_id: document.absenceEntryId,
			absence_start_date: absence?.startDate ?? null,
			absence_end_date: absence?.endDate ?? null,
			file_name: document.fileName,
			mime_type: document.mimeType,
			size_bytes: document.sizeBytes,
			uploaded_by: nameOf(userNames, document.uploadedBy),
			updated_by: nameOf(userNames, document.updatedBy),
			created_at: instantText(document.createdAt),
			updated_at: instantText(document.updatedAt),
			file: `${CATEGORY}/${path}`,
		};
	});

	return {
		category: CATEGORY,
		parts: [
			tablePart(
				"documents",
				[
					"id",
					"category",
					"title",
					"document_date",
					"pay_period_year",
					"pay_period_month",
					"visibility",
					"expiry_date",
					"absence_id",
					"absence_start_date",
					"absence_end_date",
					"file_name",
					"mime_type",
					"size_bytes",
					"uploaded_by",
					"updated_by",
					"created_at",
					"updated_at",
					"file",
				],
				rows,
			),
		],
		files,
	};
}
