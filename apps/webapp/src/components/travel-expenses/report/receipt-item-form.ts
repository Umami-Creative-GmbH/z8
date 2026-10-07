import type {
	FormAsyncValidateOrFn,
	FormValidateOrFn,
	ReactFormExtendedApi,
} from "@tanstack/react-form";
import type { ReceiptItemDraft } from "@/lib/travel-expenses/receipt-report";

/** The receipt expense form's values: every draft field as entered text. */
export type ReceiptItemFormValues = { [K in keyof ReceiptItemDraft]: string };
export type ReceiptItemFieldName = keyof ReceiptItemDraft;

type Sync = FormValidateOrFn<ReceiptItemFormValues> | undefined;
type Async = FormAsyncValidateOrFn<ReceiptItemFormValues> | undefined;
export type ReceiptItemFormApi = ReactFormExtendedApi<
	ReceiptItemFormValues,
	Sync,
	Sync,
	Async,
	Sync,
	Async,
	Sync,
	Async,
	Sync,
	Async,
	Async,
	unknown
>;
