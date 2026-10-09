import {
	DEFAULT_VISIBILITY,
	type DocumentCategory,
	type DocumentVisibility,
	EXPIRY_DATE_CATEGORIES,
	type PayPeriod,
} from "@/lib/personnel-file/document.types";

/** The editable metadata of an employee document as the form holds it. */
export interface DocumentFormValues {
	category: DocumentCategory;
	title: string;
	documentDate: string;
	payPeriodYear: string;
	payPeriodMonth: string;
	visibility: DocumentVisibility;
	/** Once the uploader picks a visibility, changing the category keeps it. */
	visibilityChosen: boolean;
	expiryDate: string;
}

export interface DocumentMetadataPayload {
	category: DocumentCategory;
	title: string;
	documentDate: string;
	payPeriod: PayPeriod | null;
	visibility: DocumentVisibility;
	expiryDate: string | null;
}

function payPeriodFromDate(date: string): { year: string; month: string } {
	const [year = "", month = ""] = date.split("-");
	return { year, month: month ? String(Number(month)) : "" };
}

/** Clears what the category does not allow and follows its default visibility. */
export function applyCategoryChange(
	values: DocumentFormValues,
	category: DocumentCategory,
): DocumentFormValues {
	const payslip = category === "payslip";
	const period = payPeriodFromDate(values.documentDate);
	return {
		...values,
		category,
		payPeriodYear: payslip ? values.payPeriodYear || period.year : "",
		payPeriodMonth: payslip ? values.payPeriodMonth || period.month : "",
		expiryDate: EXPIRY_DATE_CATEGORIES.includes(category) ? values.expiryDate : "",
		visibility: values.visibilityChosen ? values.visibility : DEFAULT_VISIBILITY[category],
	};
}

export function defaultUploadValues(input: {
	today: string;
	category: DocumentCategory;
}): DocumentFormValues {
	return applyCategoryChange(
		{
			category: input.category,
			title: "",
			documentDate: input.today,
			payPeriodYear: "",
			payPeriodMonth: "",
			visibility: DEFAULT_VISIBILITY[input.category],
			visibilityChosen: false,
			expiryDate: "",
		},
		input.category,
	);
}

/** An employee's own upload (#867): a certificate by default, always shared. */
export function ownUploadValues(input: { today: string }): DocumentFormValues {
	return {
		...defaultUploadValues({ today: input.today, category: "certificate" }),
		visibility: "shared",
		visibilityChosen: true,
	};
}

export function valuesFromDocument(document: DocumentMetadataPayload): DocumentFormValues {
	return {
		category: document.category,
		title: document.title,
		documentDate: document.documentDate,
		payPeriodYear: document.payPeriod ? String(document.payPeriod.year) : "",
		payPeriodMonth: document.payPeriod ? String(document.payPeriod.month) : "",
		visibility: document.visibility,
		visibilityChosen: true,
		expiryDate: document.expiryDate ?? "",
	};
}

/** The server validates everything again; this only shapes the values. */
export function toDocumentMetadata(values: DocumentFormValues): DocumentMetadataPayload {
	const payslip = values.category === "payslip";
	return {
		category: values.category,
		title: values.title,
		documentDate: values.documentDate,
		payPeriod:
			payslip && values.payPeriodYear && values.payPeriodMonth
				? { year: Number(values.payPeriodYear), month: Number(values.payPeriodMonth) }
				: null,
		visibility: values.visibility,
		expiryDate: values.expiryDate ? values.expiryDate : null,
	};
}
