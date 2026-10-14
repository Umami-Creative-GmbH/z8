"use client";

import { IconDatabaseExport, IconLoader2 } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	getEmployeePersonalDataExportsAction,
	requestEmployeePersonalDataExportAction,
} from "@/app/[locale]/(app)/settings/employees/personal-data-export.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PersonalDataExportSummary } from "@/lib/personal-data-export/store";
import { queryKeys } from "@/lib/query";
import {
	PersonalDataExportList,
	type PersonalDataExportListLabels,
} from "./personal-data-export-list";
import { isBuilding, REFRESH_WHILE_BUILDING_MS } from "./personal-data-export-status";

type Translate = ReturnType<typeof useTranslate>["t"];

function statusLabel(t: Translate, status: PersonalDataExportSummary["status"]): string {
	switch (status) {
		case "pending":
		case "processing":
			return t("settings.employees.personalDataExport.statusPreparing", "Being prepared");
		case "completed":
			return t("settings.employees.personalDataExport.statusReady", "Ready");
		case "failed":
			return t("settings.employees.personalDataExport.statusFailed", "Failed");
	}
}

function listLabels(t: Translate): PersonalDataExportListLabels {
	return {
		list: t("settings.employees.personalDataExport.listLabel", "Past admin exports"),
		requestedAt: (date) =>
			t("settings.employees.personalDataExport.requestedAt", "Requested {date}", { date }),
		availableUntil: (date) =>
			t("settings.employees.personalDataExport.availableUntil", "Available until {date}", {
				date,
			}),
		status: (status) => statusLabel(t, status),
		download: t("settings.employees.personalDataExport.download", "Download"),
		downloadFailed: t(
			"settings.employees.personalDataExport.downloadFailed",
			"The download could not be started. Please try again.",
		),
	};
}

function refusalMessage(t: Translate, refusal: string | undefined): string {
	switch (refusal) {
		case "in_progress":
			return t(
				"settings.employees.personalDataExport.refusalInProgress",
				"An export of this employee's data is already being prepared.",
			);
		case "storage_unavailable":
			return t(
				"settings.employees.personalDataExport.refusalStorage",
				"File storage is not set up for this organization yet.",
			);
		default:
			return t(
				"settings.employees.personalDataExport.requestFailed",
				"The export could not be started. Please try again.",
			);
	}
}

interface EmployeePersonalDataExportCardProps {
	organizationId: string;
	employeeId: string;
	/** The signed-in admin's own employee record: they export their data from My data. */
	isOwnRecord: boolean;
}

/**
 * The admin export on the employee page (#811, #1166): an org admin requests
 * a personal data export of this employee, withheld data included, and
 * downloads past admin exports while signed in. On the admin's own record
 * nothing is loaded or offered: they export their data from My data.
 */
export function EmployeePersonalDataExportCard({
	organizationId,
	employeeId,
	isOwnRecord,
}: EmployeePersonalDataExportCardProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const queryKey = queryKeys.employees.personalDataExports(organizationId, employeeId);

	const exportsQuery = useQuery({
		queryKey,
		// Admin exports of one's own record are never listed or downloadable (withheld data).
		enabled: !isOwnRecord,
		queryFn: async () => {
			const result = await getEmployeePersonalDataExportsAction(employeeId);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		refetchInterval: (query) =>
			isBuilding(query.state.data ?? []) ? REFRESH_WHILE_BUILDING_MS : false,
	});
	const exports = exportsQuery.data ?? [];
	const building = isBuilding(exports);

	const requestExport = useMutation({
		mutationFn: () => requestEmployeePersonalDataExportAction(employeeId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(
					t(
						"settings.employees.personalDataExport.requested",
						"The export is being prepared. You'll get a notification and an email when it is ready.",
					),
				);
			} else {
				toast.error(refusalMessage(t, result.refusal));
			}
			void queryClient.invalidateQueries({ queryKey });
		},
		onError: () => {
			toast.error(refusalMessage(t, undefined));
		},
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconDatabaseExport className="size-5" aria-hidden="true" />
					{t("settings.employees.personalDataExport.title", "Personal data export")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.employees.personalDataExport.description",
						"A ZIP file with everything this organization keeps about this employee, including data the employee's own export leaves out. A current employee is notified when it is ready. Files are deleted after 7 days.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="space-y-2">
					<Button
						onClick={() => requestExport.mutate()}
						disabled={isOwnRecord || building || requestExport.isPending}
					>
						{requestExport.isPending ? (
							<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
						) : (
							<IconDatabaseExport className="size-4" aria-hidden="true" />
						)}
						{t("settings.employees.personalDataExport.request", "Request export")}
					</Button>
					{isOwnRecord ? (
						<p className="text-sm text-muted-foreground">
							{t(
								"settings.employees.personalDataExport.ownRecord",
								"You can't export your own data here. Use My data in your account settings.",
							)}
						</p>
					) : null}
				</div>

				{exportsQuery.isError ? (
					<p className="text-sm text-destructive">
						{t(
							"settings.employees.personalDataExport.loadFailed",
							"Past exports could not be loaded.",
						)}
					</p>
				) : null}

				<PersonalDataExportList exports={exports} labels={listLabels(t)} />
			</CardContent>
		</Card>
	);
}
