"use client";

import { IconDatabaseExport, IconDownload, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
	getPersonalDataExportDownloadUrl,
	requestMyPersonalDataExport,
} from "@/app/[locale]/(app)/settings/my-data/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useDisplayContext } from "@/hooks/use-display-context";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { formatInstant } from "@/lib/datetime/temporal-format";
import type { PersonalDataExportSummary } from "@/lib/personal-data-export/store";

type Translate = ReturnType<typeof useTranslate>["t"];

/** A file size in B, KB, MB or GB, in `locale`. Shared with the employee page's admin exports. */
export function formatFileSize(bytes: number, locale: string): string {
	const units = ["B", "KB", "MB", "GB"] as const;
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	const amount = new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 });
	return `${amount.format(value)} ${units[unit]}`;
}

/** How often the page looks for a finished build while one is in progress. */
const REFRESH_WHILE_BUILDING_MS = 15_000;

function statusLabel(t: Translate, status: PersonalDataExportSummary["status"]): string {
	switch (status) {
		case "pending":
		case "processing":
			return t("settings.myData.statusPreparing", "Being prepared");
		case "completed":
			return t("settings.myData.statusReady", "Ready");
		case "failed":
			return t("settings.myData.statusFailed", "Failed");
	}
}

function refusalMessage(t: Translate, refusal: string | undefined): string {
	switch (refusal) {
		case "in_progress":
			return t(
				"settings.myData.refusalInProgress",
				"An export of your data is already being prepared. You'll be notified when it is ready.",
			);
		case "daily_limit":
			return t(
				"settings.myData.refusalDailyLimit",
				"You can request one export of your data every 24 hours. Please try again later.",
			);
		case "storage_unavailable":
			return t(
				"settings.myData.refusalStorage",
				"File storage is not set up for this organization yet. Please contact its admins.",
			);
		default:
			return t(
				"settings.myData.requestFailed",
				"Your export could not be started. Please try again.",
			);
	}
}

interface MyDataPanelProps {
	exports: PersonalDataExportSummary[];
}

/**
 * The employee export on My data (#811): request a copy of one's own data in
 * the active organization, and download finished exports while signed in.
 */
export function MyDataPanel({ exports }: MyDataPanelProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const display = useDisplayContext();
	const [requesting, setRequesting] = useState(false);
	const [downloading, setDownloading] = useState<string | null>(null);
	const building = exports.some(
		(entry) => entry.status === "pending" || entry.status === "processing",
	);
	const at = (iso: string) => formatInstant(parseInstant(iso), display, "dateTimeMedium");

	useEffect(() => {
		if (!building) return;
		const timer = window.setInterval(() => router.refresh(), REFRESH_WHILE_BUILDING_MS);
		return () => window.clearInterval(timer);
	}, [building, router]);

	const requestExport = async () => {
		setRequesting(true);
		await (async () => {
			const result = await requestMyPersonalDataExport();
			if (result.success) {
				toast.success(
					t(
						"settings.myData.requested",
						"Your export is being prepared. You'll get a notification and an email when it is ready.",
					),
				);
				router.refresh();
			} else {
				toast.error(refusalMessage(t, result.refusal));
			}
		})().finally(() => {
			setRequesting(false);
		});
	};

	const download = async (exportId: string) => {
		setDownloading(exportId);
		await (async () => {
			const result = await getPersonalDataExportDownloadUrl(exportId);
			if (result.success) {
				window.location.assign(result.data.url);
			} else {
				toast.error(
					t(
						"settings.myData.downloadFailed",
						"The download could not be started. Please try again.",
					),
				);
			}
		})().finally(() => {
			setDownloading(null);
		});
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconDatabaseExport className="size-5" aria-hidden="true" />
					{t("settings.myData.exportTitle", "Personal data export")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.myData.exportDescription",
						"A ZIP file with everything this organization keeps about you, as JSON and CSV files with an explanation. It covers this organization only.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
					<li>
						{t(
							"settings.myData.aboutNotification",
							"Preparing the file can take a few minutes. You'll get a notification and an email when it is ready.",
						)}
					</li>
					<li>
						{t(
							"settings.myData.aboutDownload",
							"Download it here while signed in. Files are deleted after 7 days.",
						)}
					</li>
					<li>{t("settings.myData.aboutLimit", "You can request one export every 24 hours.")}</li>
				</ul>
				<Button onClick={requestExport} disabled={requesting || building}>
					{requesting ? (
						<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
					) : (
						<IconDatabaseExport className="size-4" aria-hidden="true" />
					)}
					{t("settings.myData.requestExport", "Request export")}
				</Button>

				{exports.length > 0 ? (
					<ul
						className="divide-y rounded-md border"
						aria-label={t("settings.myData.listLabel", "Your exports")}
					>
						{exports.map((entry) => (
							<li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
								<div className="min-w-0 space-y-1">
									<p className="text-sm font-medium">
										{t("settings.myData.requestedAt", "Requested {date}", {
											date: at(entry.createdAt),
										})}
									</p>
									<p className="text-xs text-muted-foreground">
										{entry.status === "completed"
											? t("settings.myData.availableUntil", "Available until {date}", {
													date: at(entry.expiresAt),
												})
											: null}
										{entry.status === "completed" && entry.sizeBytes !== null
											? ` · ${formatFileSize(entry.sizeBytes, display.locale)}`
											: null}
									</p>
								</div>
								<div className="flex items-center gap-2">
									<Badge variant={entry.status === "failed" ? "destructive" : "secondary"}>
										{statusLabel(t, entry.status)}
									</Badge>
									{entry.status === "completed" ? (
										<Button
											size="sm"
											variant="outline"
											onClick={() => download(entry.id)}
											disabled={downloading === entry.id}
										>
											{downloading === entry.id ? (
												<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
											) : (
												<IconDownload className="size-4" aria-hidden="true" />
											)}
											{t("settings.myData.download", "Download")}
										</Button>
									) : null}
								</div>
							</li>
						))}
					</ul>
				) : null}
			</CardContent>
		</Card>
	);
}
