/**
 * The README's explanation of every part and field of the Personnel file
 * category (#811, #1172). See "Field guide" in `../collector.ts`.
 */

import { commonFieldExplanations, type PersonalDataFieldGuide } from "../collector";

export const personnelFileFieldGuide: PersonalDataFieldGuide = (t) => ({
	documents: {
		summary: t(
			"personalDataExport.readme.fields.personnelFile.documents.summary",
			"The documents in your personnel file. The files themselves are in the personnel_file folder, by category.",
		),
		fields: {
			...commonFieldExplanations(t, ["id", "created_at", "updated_at", "updated_by"]),
			category: t(
				"personalDataExport.readme.fields.personnelFile.documents.category",
				"The document category: contract, payslip, certificate, sick_note or other.",
			),
			title: t(
				"personalDataExport.readme.fields.personnelFile.documents.title",
				"The document's title.",
			),
			document_date: t(
				"personalDataExport.readme.fields.personnelFile.documents.documentDate",
				"The date of the document (YYYY-MM-DD).",
			),
			pay_period_year: t(
				"personalDataExport.readme.fields.personnelFile.documents.payPeriodYear",
				"For a payslip: the year it is for.",
			),
			pay_period_month: t(
				"personalDataExport.readme.fields.personnelFile.documents.payPeriodMonth",
				"For a payslip: the month (1 to 12) it is for.",
			),
			visibility: t(
				"personalDataExport.readme.fields.personnelFile.documents.visibility",
				"Who can see the document; shared means you can see it in your file.",
			),
			expiry_date: t(
				"personalDataExport.readme.fields.personnelFile.documents.expiryDate",
				"The day the document expires (YYYY-MM-DD), for example a certificate's.",
			),
			absence_id: t(
				"personalDataExport.readme.fields.personnelFile.documents.absenceId",
				"For a sick note: the ID of the absence it covers, in absences.json.",
			),
			absence_start_date: t(
				"personalDataExport.readme.fields.personnelFile.documents.absenceStartDate",
				"For a sick note: the first day of the absence (YYYY-MM-DD).",
			),
			absence_end_date: t(
				"personalDataExport.readme.fields.personnelFile.documents.absenceEndDate",
				"For a sick note: the last day of the absence (YYYY-MM-DD).",
			),
			file_name: t(
				"personalDataExport.readme.fields.personnelFile.documents.fileName",
				"The file name as uploaded.",
			),
			mime_type: t(
				"personalDataExport.readme.fields.personnelFile.documents.mimeType",
				"The file type, for example application/pdf.",
			),
			size_bytes: t(
				"personalDataExport.readme.fields.personnelFile.documents.sizeBytes",
				"The file size, in bytes.",
			),
			uploaded_by: t(
				"personalDataExport.readme.fields.personnelFile.documents.uploadedBy",
				"Who uploaded the document.",
			),
			file: t(
				"personalDataExport.readme.fields.personnelFile.documents.file",
				"Where the original file is inside this archive.",
			),
		},
	},
});
