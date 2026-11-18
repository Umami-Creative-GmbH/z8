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
import { useReportTask } from "./use-report-task";

const MAX_RECEIPT_SIZE = 10 * 1024 * 1024;

type Translate = ReturnType<typeof useTranslate>["t"];
function uploadFailureMessage(
	t: Translate,
	status: number | null,
	maxReceiptBytes: number,
): string {
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
	refreshSubmission: () => Promise<unknown>;
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
					<p key={receipt.receiptId} className="break-words text-sm text-muted-foreground">
						{t(
							"travelExpenses.report.receipts.addedAfterSubmission",
							"{fileName}: Added after submission by {name} on {date}.",
							{
								fileName: receipt.fileName,
								name: receipt.uploadedByName ?? "—",
								date: receipt.uploadedAt ? formatRecordedInstant(locale, receipt.uploadedAt) : "—",
							},
						)}
					</p>
				))}
			{props.canAddReceipt && props.itemType === "receipt" && props.receipts.length === 0 ? (
				<MissingReceiptUpload
					key={`${props.reportId}:${props.itemId}:${props.submissionCycle}`}
					reportId={props.reportId}
					itemId={props.itemId}
					submissionCycle={props.submissionCycle}
					refreshSubmission={props.refreshSubmission}
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
	refreshSubmission,
	maxReceiptBytes = MAX_RECEIPT_SIZE,
}: Pick<
	Props,
	"reportId" | "itemId" | "submissionCycle" | "refreshSubmission" | "maxReceiptBytes"
>) {
	const { t } = useTranslate();
	const fileInput = useRef<HTMLInputElement>(null);
	const [error, setError] = useState<string | null>(null);
	const [attached, setAttached] = useState(false);
	const task = useReportTask(`${reportId}:${itemId}:${submissionCycle}`);
	const upload = useTravelExpenseFileUpload({
		process: async ({ tusFileKey, fileName }) => {
			const activation = task.reserve();
			if (!activation) return;
			try {
				const response = await fetch("/api/upload/travel-expense/report-receipt", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ reportId, itemId, submissionCycle, tusFileKey, fileName }),
				});
				if (response.ok) {
					setAttached(true);
					// The POST can settle after the upload widget's callbacks are disconnected.
					await refreshSubmission();
				} else if (task.isCurrent(activation)) {
					setError(uploadFailureMessage(t, response.status, maxReceiptBytes));
				}
			} catch {
				if (task.isCurrent(activation)) setError(uploadFailureMessage(t, null, maxReceiptBytes));
			}
			task.release(activation);
		},
		onError: () => {
			if (task.isActive() && !task.isPending()) {
				setError(uploadFailureMessage(t, null, maxReceiptBytes));
			}
		},
		maxFileSize: maxReceiptBytes,
	});
	function chooseFile(event: React.ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (!file || attached || upload.isUploading || task.isPending()) return;
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
	if (attached) return null;
	const processing = upload.isProcessing || task.working;
	const busy = upload.isUploading || processing;
	return (
		<div className="space-y-2">
			<input
				ref={fileInput}
				type="file"
				name="receipt"
				className="sr-only"
				tabIndex={-1}
				aria-label={t("travelExpenses.report.receipts.choose", "Choose receipt")}
				accept={ALLOWED_TRAVEL_EXPENSE_MIME_TYPES.join(",")}
				disabled={busy}
				onChange={chooseFile}
			/>
			<Button
				type="button"
				size="sm"
				variant="outline"
				disabled={busy}
				onClick={() => fileInput.current?.click()}
			>
				{busy ? (
					<IconLoader2
						aria-hidden="true"
						className="size-4 animate-spin motion-reduce:animate-none"
					/>
				) : (
					<IconPaperclip aria-hidden="true" className="size-4" />
				)}
				{t("travelExpenses.report.receipts.add", "Add receipt")}
			</Button>
			{busy ? (
				<div role="status" className="space-y-1 text-sm">
					{processing
						? t("travelExpenses.report.receipts.processing", "Attaching receipt…")
						: t("travelExpenses.report.receipts.uploading", "Uploading receipt…")}
					<Progress
						value={upload.progress}
						aria-label={t("travelExpenses.report.receipts.progress", "Upload progress")}
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
