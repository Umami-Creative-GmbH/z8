"use client";

import { IconDatabaseExport, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { requestMyPersonalDataExport } from "@/app/[locale]/(app)/settings/my-data/actions";
import {
	PersonalDataExportList,
	type PersonalDataExportListLabels,
} from "@/components/settings/personal-data-export/personal-data-export-list";
import {
	isBuilding,
	REFRESH_WHILE_BUILDING_MS,
} from "@/components/settings/personal-data-export/personal-data-export-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PersonalDataExportSummary } from "@/lib/personal-data-export/store";

type Translate = ReturnType<typeof useTranslate>["t"];

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

function listLabels(t: Translate): PersonalDataExportListLabels {
	return {
		list: t("settings.myData.listLabel", "Your exports"),
		requestedAt: (date) => t("settings.myData.requestedAt", "Requested {date}", { date }),
		availableUntil: (date) =>
			t("settings.myData.availableUntil", "Available until {date}", { date }),
		status: (status) => statusLabel(t, status),
		download: t("settings.myData.download", "Download"),
		downloadFailed: t(
			"settings.myData.downloadFailed",
			"The download could not be started. Please try again.",
		),
	};
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
	const [requesting, setRequesting] = useState(false);
	const building = isBuilding(exports);

	useEffect(() => {
		if (!building) return;
		const timer = window.setInterval(() => router.refresh(), REFRESH_WHILE_BUILDING_MS);
		return () => window.clearInterval(timer);
	}, [building, router]);

	const requestExport = async () => {
		setRequesting(true);
		try {
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
		} catch {
			toast.error(refusalMessage(t, undefined));
		}
		setRequesting(false);
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

				<PersonalDataExportList exports={exports} labels={listLabels(t)} />
			</CardContent>
		</Card>
	);
}
