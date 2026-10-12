"use client";

import { IconFileText, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveEmployeeSickNoteUploadAction } from "@/app/[locale]/(app)/settings/vacation/sick-note-setting-actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Link } from "@/navigation";

/**
 * The "Employees can attach sick notes" absence setting (#982). Sick notes are
 * personnel file documents (ADR 0002), so it can be turned on only while
 * personnel files are on; otherwise it is shown disabled with a hint.
 */
export function EmployeeSickNoteSetting({
	enabled,
	personnelFilesEnabled,
}: {
	enabled: boolean;
	personnelFilesEnabled: boolean;
}) {
	const { t } = useTranslate();
	const [checked, setChecked] = useState(enabled && personnelFilesEnabled);
	const [isPending, startTransition] = useTransition();

	function change(next: boolean) {
		setChecked(next);
		startTransition(async () => {
			const result = await saveEmployeeSickNoteUploadAction({ enabled: next });
			if (!result.success) {
				setChecked(!next);
				toast.error(result.error);
				return;
			}
			toast.success(
				next
					? t("settings.vacation.sickNotes.enabled", "Employees can now attach sick notes")
					: t("settings.vacation.sickNotes.disabled", "Employees can no longer attach sick notes"),
			);
		});
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconFileText aria-hidden="true" className="size-5" />
					{t("settings.vacation.sickNotes.title", "Sick notes")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.vacation.sickNotes.description",
						"Sick notes are kept in the employee's personnel file. Approvers and managers only see that one is attached.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="flex items-start justify-between gap-4">
					<div className="space-y-1">
						<Label htmlFor="employee-sick-note-upload" className="text-sm font-medium">
							{t("settings.vacation.sickNotes.toggle", "Employees can attach sick notes")}
						</Label>
						<p className="text-sm text-muted-foreground">
							{t(
								"settings.vacation.sickNotes.help",
								"Employees attach photos or PDFs of their sick notes to their own sick leave. In Germany, employers fetch the electronic sick note (eAU) from health insurers, so photos matter mainly for private insurance, mini-jobs, Austria and Switzerland, and child-sick notes.",
							)}
						</p>
					</div>
					<div className="flex items-center gap-2">
						{isPending ? (
							<IconLoader2
								aria-hidden="true"
								className="size-4 animate-spin text-muted-foreground"
							/>
						) : null}
						<Switch
							id="employee-sick-note-upload"
							checked={checked}
							onCheckedChange={change}
							disabled={!personnelFilesEnabled || isPending}
						/>
					</div>
				</div>
				{personnelFilesEnabled ? null : (
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.vacation.sickNotes.personnelFilesRequired",
							"Sick notes are stored in personnel files. Turn on personnel files in the organization settings first.",
						)}{" "}
						<Link
							href="/settings/organizations"
							className="font-medium underline underline-offset-4"
						>
							{t(
								"settings.vacation.sickNotes.openOrganizationSettings",
								"Open organization settings",
							)}
						</Link>
					</p>
				)}
			</CardContent>
		</Card>
	);
}
