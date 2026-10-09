import { parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	type DocumentCategory,
	type DocumentVisibility,
	EXPIRY_DATE_CATEGORIES,
	isDocumentCategory,
	isDocumentVisibility,
	type PayPeriod,
} from "./document.types";

/**
 * The rules every employee document's metadata follows, whoever writes it
 * (CONTEXT.md): a fixed document category, a title, a document date that is a
 * plain calendar day, a pay period exactly for payslips, and an expiry date
 * only for certificates and other documents. The database enforces the same
 * rules with CHECK constraints (migration 0142).
 */

export const DOCUMENT_TITLE_MAX_LENGTH = 200;

export interface DocumentMetadata {
	category: DocumentCategory;
	title: string;
	/** YYYY-MM-DD, a plain day. */
	documentDate: string;
	payPeriod: PayPeriod | null;
	visibility: DocumentVisibility;
	/** YYYY-MM-DD, a plain day. */
	expiryDate: string | null;
}

export type DocumentMetadataField = keyof DocumentMetadata;

export type DocumentMetadataValidation =
	| { ok: true; value: DocumentMetadata }
	| { ok: false; field: DocumentMetadataField; message: string };

function plainDay(value: unknown): string | null {
	if (typeof value !== "string") return null;
	try {
		return parsePlainDate(value).toString();
	} catch {
		return null;
	}
}

function payPeriodOf(value: unknown): PayPeriod | null | "invalid" {
	if (value === null || value === undefined) return null;
	if (typeof value !== "object") return "invalid";
	const { year, month } = value as Record<string, unknown>;
	if (
		typeof year !== "number" ||
		typeof month !== "number" ||
		!Number.isInteger(year) ||
		!Number.isInteger(month) ||
		year < 1900 ||
		year > 2999 ||
		month < 1 ||
		month > 12
	) {
		return "invalid";
	}
	return { year, month };
}

/** Validates metadata as a client sent it; never trust the shape. */
export function validateDocumentMetadata(input: {
	category: unknown;
	title: unknown;
	documentDate: unknown;
	payPeriod: unknown;
	visibility: unknown;
	expiryDate: unknown;
}): DocumentMetadataValidation {
	if (!isDocumentCategory(input.category)) {
		return { ok: false, field: "category", message: "Choose a document category." };
	}
	const category = input.category;
	const title = typeof input.title === "string" ? input.title.trim() : "";
	if (title.length === 0) {
		return { ok: false, field: "title", message: "Enter a title." };
	}
	if (title.length > DOCUMENT_TITLE_MAX_LENGTH) {
		return {
			ok: false,
			field: "title",
			message: `The title can have at most ${DOCUMENT_TITLE_MAX_LENGTH} characters.`,
		};
	}
	const documentDate = plainDay(input.documentDate);
	if (!documentDate) {
		return { ok: false, field: "documentDate", message: "Enter a valid document date." };
	}
	const payPeriod = payPeriodOf(input.payPeriod);
	if (payPeriod === "invalid") {
		return { ok: false, field: "payPeriod", message: "Enter a valid pay period." };
	}
	if (category === "payslip" && !payPeriod) {
		return { ok: false, field: "payPeriod", message: "A payslip needs a pay period." };
	}
	if (category !== "payslip" && payPeriod) {
		return { ok: false, field: "payPeriod", message: "Only payslips have a pay period." };
	}
	if (!isDocumentVisibility(input.visibility)) {
		return { ok: false, field: "visibility", message: "Choose who can see the document." };
	}
	let expiryDate: string | null = null;
	if (input.expiryDate !== null && input.expiryDate !== undefined && input.expiryDate !== "") {
		if (!EXPIRY_DATE_CATEGORIES.includes(category)) {
			return {
				ok: false,
				field: "expiryDate",
				message: "Only certificates and other documents have an expiry date.",
			};
		}
		expiryDate = plainDay(input.expiryDate);
		if (!expiryDate) {
			return { ok: false, field: "expiryDate", message: "Enter a valid expiry date." };
		}
	}
	return {
		ok: true,
		value: {
			category,
			title,
			documentDate,
			payPeriod,
			visibility: input.visibility,
			expiryDate,
		},
	};
}
