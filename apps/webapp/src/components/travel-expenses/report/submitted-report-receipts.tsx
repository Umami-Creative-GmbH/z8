"use client";

import { IconLoader2, IconPaperclip } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { TravelExpenseReportItemType } from "@/db/schema/travel-expense";
import { useTravelExpenseFileUpload } from "@/hooks/use-travel-expense-file-upload";
import {
	ALLOWED_TRAVEL_EXPENSE_MIME_TYPES,
	isAllowedTravelExpenseMime,
} from "@/lib/travel-expenses/attachment-validation";
import type { SubmittedReportItemView } from "@/lib/travel-expenses/report-read";
import { formatRecordedInstant } from "./format";

const MAX_RECEIPT_SIZE = 10 * 1024 * 1024;

type Translate = ReturnType<typeof useTranslate>["t"];
class ReceiptUploadError extends Error {
	constructor(readonly status: number) {
		super("Receipt upload refused");
	}
}
function uploadFailureMessage(
	t: Translate,
	error: Error,
	maxReceiptBytes: number,
): string {
	const status = error instanceof ReceiptUploadError ? error.status : null;
	if (status === 409)
		return t(
			"travelExpenses.report.receipts.supplementConflict",
			"A receipt was already supplied or the report changed. Reload the report before trying again.",
		);
	if (status === 400)
		return t(
			"travelExpenses.report.receipts.errors.unsupportedType",
			"Attach a PDF or an image (JPEG, PNG, WebP, GIF, BMP or TIFF).",
		);
	if (status === 413)
		return t(
			"travelExpenses.report.receipts.errors.tooLarge",
			"The file is too large. Attach a file of at most {size} MB.",
			{ size: maxReceiptBytes / (1024 * 1024) },
		);
	return t(
		"travelExpenses.report.receipts.supplementFailed",
		"The receipt was not attached. Reload the report and try again.",
	);
}

type Props = {
	reportId: string;
	itemId: string;
	itemType: TravelExpenseReportItemType;
	submissionCycle: number;
	canAddReceipt: boolean;
	receipts: SubmittedReportItemView["receipts"];
	onChanged: () => void;
	maxReceiptBytes?: number;
};

/** Supplemental evidence is visibly separate from the frozen submission facts. */
export function SubmittedReportReceipts(props: Props) {
	const { t } = useTranslate();
	const locale = useLocale();
	return (
		<div className="mt-2 space-y-2">
			{props.receipts
				.filter((receipt) => receipt.addedAfterSubmission)
				.map((receipt) => (
					<p
						key={receipt.receiptId}
						className="break-words text-sm text-muted-foreground"
					>
						{t(
							"travelExpenses.report.receipts.addedAfterSubmission",
							"{fileName}: Added after submission by {name} on {date}.",
							{
								fileName: receipt.fileName,
								name: receipt.uploadedByName ?? "—",
								date: receipt.uploadedAt
									? formatRecordedInstant(locale, receipt.uploadedAt)
									: "—",
							},
						)}
					</p>
				))}
			{props.canAddReceipt &&
			props.itemType === "receipt" &&
			props.receipts.length === 0 ? (
				<MissingReceiptUpload
					reportId={props.reportId}
					itemId={props.itemId}
					submissionCycle={props.submissionCycle}
					onChanged={props.onChanged}
					maxReceiptBytes={props.maxReceiptBytes}
				/>
			) : null}
		</div>
	);
}

function MissingReceiptUpload({
	reportId,
	itemId,
	submissionCycle,
	onChanged,
	maxReceiptBytes = MAX_RECEIPT_SIZE,
}: Pick<
	Props,
	"reportId" | "itemId" | "submissionCycle" | "onChanged" | "maxReceiptBytes"
>) {
	const { t } = useTranslate();
	const fileInput = useRef<HTMLInputElement>(null);
	const [error, setError] = useState<string | null>(null);
	const upload = useTravelExpenseFileUpload({
		process: async ({ tusFileKey, fileName }) => {
			const response = await fetch(
				"/api/upload/travel-expense/report-receipt",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						reportId,
						itemId,
						submissionCycle,
						tusFileKey,
						fileName,
					}),
				},
			);
			if (!response.ok) throw new ReceiptUploadError(response.status);
		},
		onSuccess: onChanged,
		onError: (error) =>
			setError(uploadFailureMessage(t, error, maxReceiptBytes)),
		maxFileSize: maxReceiptBytes,
	});
	function chooseFile(event: React.ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (!file) return;
		if (file.size > maxReceiptBytes) {
			setError(
				t(
					"travelExpenses.report.receipts.errors.tooLarge",
					"The file is too large. Attach a file of at most {size} MB.",
					{ size: maxReceiptBytes / (1024 * 1024) },
				),
			);
			return;
		}
		if (file.type && !isAllowedTravelExpenseMime(file.type)) {
			setError(
				t(
					"travelExpenses.report.receipts.errors.unsupportedType",
					"Attach a PDF or an image (JPEG, PNG, WebP, GIF, BMP or TIFF).",
				),
			);
			return;
		}
		setError(null);
		upload.addFile(file);
	}
	return (
		<div className="space-y-2">
			<input
				ref={fileInput}
				type="file"
				name="receipt"
				className="sr-only"
				tabIndex={-1}
				aria-label={t(
					"travelExpenses.report.receipts.choose",
					"Choose receipt",
				)}
				accept={ALLOWED_TRAVEL_EXPENSE_MIME_TYPES.join(",")}
				disabled={upload.isUploading}
				onChange={chooseFile}
			/>
			<Button
				type="button"
				size="sm"
				variant="outline"
				disabled={upload.isUploading}
				onClick={() => fileInput.current?.click()}
			>
				{upload.isUploading ? (
					<IconLoader2
						aria-hidden="true"
						className="size-4 animate-spin motion-reduce:animate-none"
					/>
				) : (
					<IconPaperclip aria-hidden="true" className="size-4" />
				)}
				{t("travelExpenses.report.receipts.add", "Add receipt")}
			</Button>
			{upload.isUploading ? (
				<div role="status" className="space-y-1 text-sm">
					{upload.isProcessing
						? t(
								"travelExpenses.report.receipts.processing",
								"Attaching receipt…",
							)
						: t(
								"travelExpenses.report.receipts.uploading",
								"Uploading receipt…",
							)}
					<Progress
						value={upload.progress}
						aria-label={t(
							"travelExpenses.report.receipts.progress",
							"Upload progress",
						)}
					/>
				</div>
			) : null}
			{error ? (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			) : null}
		</div>
	);
}
