"use client";

import {
	IconAlertTriangle,
	IconCamera,
	IconFileTypePdf,
	IconLoader2,
	IconPaperclip,
	IconTrash,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
import { removeReportReceiptAction } from "@/app/[locale]/(app)/travel-expenses/report-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useTravelExpenseFileUpload } from "@/hooks/use-travel-expense-file-upload";
import { ALLOWED_TRAVEL_EXPENSE_MIME_TYPES } from "@/lib/travel-expenses/attachment-validation";
import type { ReportReceiptView } from "@/lib/travel-expenses/report-store";

async function processReportReceipt(input: {
	reportId: string;
	itemId: string;
	tusFileKey: string;
	fileName: string | undefined;
}): Promise<ReportReceiptView> {
	const response = await fetch("/api/upload/travel-expense/report-receipt", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(typeof body.error === "string" ? body.error : "Upload failed");
	}
	return body.receipt as ReportReceiptView;
}

export function receiptHref(reportId: string, receiptId: string, download = false) {
	return `/api/travel-expenses/reports/${encodeURIComponent(reportId)}/receipts/${encodeURIComponent(receiptId)}${download ? "?download=1" : ""}`;
}

/**
 * Receipt files of one report item: phone camera capture or file choice,
 * upload progress, previews and removal. Failures stay visible until the
 * next attempt.
 */
export function ReceiptAttachments({
	reportId,
	itemId,
	receipts,
	onChanged,
	onBusyChange,
}: {
	reportId: string;
	itemId: string;
	receipts: ReportReceiptView[];
	/** Called after a receipt was attached or removed, to reload the item. */
	onChanged: () => void | Promise<void>;
	onBusyChange?: (busy: boolean) => void;
}) {
	const { t } = useTranslate();
	const cameraInput = useRef<HTMLInputElement>(null);
	const fileInput = useRef<HTMLInputElement>(null);
	const [error, setError] = useState<string | null>(null);
	const [removingId, setRemovingId] = useState<string | null>(null);

	const upload = useTravelExpenseFileUpload({
		process: ({ tusFileKey, fileName }) =>
			processReportReceipt({ reportId, itemId, tusFileKey, fileName }),
		onSuccess: () => {
			onBusyChange?.(false);
			void onChanged();
		},
		onError: (uploadError) => {
			onBusyChange?.(false);
			setError(uploadError.message);
		},
	});

	function chooseFile(event: React.ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		// Allows choosing the same file again after a failure.
		event.target.value = "";
		if (!file) return;
		setError(null);
		onBusyChange?.(true);
		upload.addFile(file);
	}

	async function remove(receipt: ReportReceiptView) {
		setError(null);
		setRemovingId(receipt.id);
		try {
			const result = await removeReportReceiptAction({ reportId, itemId, receiptId: receipt.id });
			if (!result.success) {
				setError(result.error);
				return;
			}
			await onChanged();
		} catch {
			setError(
				t("travelExpenses.report.receipts.removeFailed", "The receipt could not be removed."),
			);
		} finally {
			setRemovingId(null);
		}
	}

	const busy = upload.isUploading;

	return (
		<section aria-labelledby={`${itemId}-receipts`} className="space-y-3">
			<div>
				<h3 id={`${itemId}-receipts`} className="text-base font-semibold">
					{t("travelExpenses.report.receipts.title", "Receipt")}
				</h3>
				<p className="text-sm text-muted-foreground">
					{t(
						"travelExpenses.report.receipts.description",
						"Take a photo or attach a PDF or image of the receipt.",
					)}
				</p>
			</div>

			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					variant="outline"
					disabled={busy}
					onClick={() => cameraInput.current?.click()}
				>
					<IconCamera aria-hidden="true" className="mr-2 size-4" />
					{t("travelExpenses.report.receipts.takePhoto", "Take photo")}
				</Button>
				<Button
					type="button"
					variant="outline"
					disabled={busy}
					onClick={() => fileInput.current?.click()}
				>
					<IconPaperclip aria-hidden="true" className="mr-2 size-4" />
					{t("travelExpenses.report.receipts.chooseFile", "Choose file")}
				</Button>
				<input
					ref={cameraInput}
					type="file"
					accept="image/*"
					capture="environment"
					className="sr-only"
					tabIndex={-1}
					aria-hidden="true"
					onChange={chooseFile}
				/>
				<input
					ref={fileInput}
					type="file"
					accept={ALLOWED_TRAVEL_EXPENSE_MIME_TYPES.join(",")}
					className="sr-only"
					tabIndex={-1}
					aria-hidden="true"
					data-testid="receipt-file-input"
					onChange={chooseFile}
				/>
			</div>

			{busy && (
				<div role="status" className="space-y-1">
					<p className="flex items-center gap-2 text-sm text-muted-foreground">
						<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
						{upload.isProcessing
							? t("travelExpenses.report.receipts.verifying", "Checking the receipt…")
							: t("travelExpenses.report.receipts.uploading", "Uploading receipt…")}
					</p>
					<Progress
						value={upload.progress}
						aria-label={t("travelExpenses.report.receipts.progress", "Upload progress")}
					/>
				</div>
			)}

			{error && (
				<Alert variant="destructive">
					<IconAlertTriangle aria-hidden="true" className="size-4" />
					<AlertDescription>
						<p>
							{t("travelExpenses.report.receipts.uploadFailed", "The receipt was not attached.")}{" "}
							{error}
						</p>
					</AlertDescription>
				</Alert>
			)}

			{receipts.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t("travelExpenses.report.receipts.none", "No receipt attached yet.")}
				</p>
			) : (
				<ul className="grid gap-3 sm:grid-cols-2">
					{receipts.map((receipt) => {
						const href = receiptHref(reportId, receipt.id);
						const isImage = receipt.mimeType.startsWith("image/");
						return (
							<li key={receipt.id} className="flex gap-3 rounded-lg border p-3">
								<a
									href={href}
									target="_blank"
									rel="noopener noreferrer"
									className="shrink-0 rounded-md focus-visible:outline-2"
									aria-label={`${t("travelExpenses.actions.preview", "Preview")} ${receipt.fileName}`}
								>
									{isImage ? (
										// biome-ignore lint/performance/noImgElement: private, authenticated receipt preview
										<img
											src={href}
											alt=""
											loading="lazy"
											className="size-16 rounded-md object-cover"
										/>
									) : (
										<span className="flex size-16 items-center justify-center rounded-md bg-muted">
											<IconFileTypePdf aria-hidden="true" className="size-8" />
										</span>
									)}
								</a>
								<div className="min-w-0 flex-1 space-y-2">
									<p className="break-all text-sm font-medium">{receipt.fileName}</p>
									<div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
										<a
											className="rounded-sm text-primary underline underline-offset-4 hover:text-primary/80 focus-visible:outline-2"
											href={receiptHref(reportId, receipt.id, true)}
											target="_blank"
											rel="noopener noreferrer"
											aria-label={`${t("travelExpenses.actions.download", "Download")} ${receipt.fileName}`}
										>
											{t("travelExpenses.actions.download", "Download")}
										</a>
										<Button
											type="button"
											variant="link"
											size="sm"
											className="h-auto p-0 text-destructive"
											disabled={removingId !== null || busy}
											onClick={() => void remove(receipt)}
											aria-label={`${t("travelExpenses.report.receipts.remove", "Remove")} ${receipt.fileName}`}
										>
											{removingId === receipt.id ? (
												<IconLoader2 aria-hidden="true" className="mr-1 size-4 animate-spin" />
											) : (
												<IconTrash aria-hidden="true" className="mr-1 size-4" />
											)}
											{t("travelExpenses.report.receipts.remove", "Remove")}
										</Button>
									</div>
								</div>
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}
