"use client";

import { IconFileText } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import type { LinkableSickLeave } from "@/app/[locale]/(app)/personnel-files/sick-note-actions";
import { AbsenceSickNotesPanel } from "@/components/absences/sick-notes/absence-sick-notes-panel";
import { useAppLocale } from "@/components/providers/app-locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatAbsenceDateRange } from "@/lib/personnel-file/sick-note-labels";
import { useSickLeaveLabels } from "./sick-leave-overview";
import { useEmployeeSickLeave } from "./sick-note-links";

/**
 * The employee's pending and approved sick leave in their personnel file
 * (#984), for whoever manages the employee's sick notes: how many notes each
 * absence has, and its sick notes to attach, link and unlink. Team absence
 * views list no single absences, so this is where officers work on them.
 */
export function EmployeeSickLeaveCard({ employeeId }: { employeeId: string }) {
	const { t } = useTranslate();
	const locale = useAppLocale();
	const labels = useSickLeaveLabels();
	const query = useEmployeeSickLeave(employeeId);
	const [selected, setSelected] = useState<LinkableSickLeave | null>(null);

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.personnelFiles.sickNotes.cardTitle", "Sick leave")}</CardTitle>
				<CardDescription>
					{t(
						"settings.personnelFiles.sickNotes.cardDescription",
						"Pending and approved sick leave of this employee. Attach a new sick note, or link one that is already in the personnel file.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{query.isPending ? (
					<div className="space-y-2" aria-busy="true">
						<Skeleton className="h-12 w-full" />
						<Skeleton className="h-12 w-full" />
					</div>
				) : query.isError ? (
					<p role="alert" className="text-sm text-destructive">
						{t("settings.personnelFiles.sickNotes.loadFailed", "The list could not be loaded.")}
					</p>
				) : query.data.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.personnelFiles.sickNotes.noSickLeave",
							"This employee has no pending or approved sick leave.",
						)}
					</p>
				) : (
					<ul className="divide-y rounded-md border">
						{query.data.map((absence) => {
							const dateRange = formatAbsenceDateRange(absence.startDate, absence.endDate, locale);
							return (
								<li
									key={absence.id}
									className="flex flex-wrap items-center gap-3 p-3 sm:flex-nowrap"
								>
									<div className="min-w-0 flex-1 space-y-1">
										<div className="flex flex-wrap items-center gap-2">
											<span className="font-medium">{dateRange}</span>
											<Badge variant={absence.status === "approved" ? "outline" : "secondary"}>
												{labels.statuses[absence.status]}
											</Badge>
											{absence.sickDetail ? (
												<Badge variant="secondary">{labels.sickDetails[absence.sickDetail]}</Badge>
											) : null}
										</div>
										<p className="text-sm text-muted-foreground tabular-nums">
											{absence.sickNoteCount === 0
												? t("settings.personnelFiles.sickLeave.notes.none", "No note")
												: t(
														"settings.personnelFiles.sickLeave.notes.count",
														"{count, plural, one {# note} other {# notes}}",
														{ count: absence.sickNoteCount },
													)}
										</p>
									</div>
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={() => setSelected(absence)}
										aria-label={t(
											"settings.personnelFiles.sickNotes.openNotes",
											"Sick notes for {dateRange}",
											{ dateRange },
										)}
									>
										<IconFileText aria-hidden="true" className="size-4" />
										{t("settings.personnelFiles.sickNotes.notes", "Sick notes")}
									</Button>
								</li>
							);
						})}
					</ul>
				)}
			</CardContent>
			{selected ? (
				<AbsenceSickNotesPanel
					key={selected.id}
					absence={{ ...selected, employeeId }}
					open
					onOpenChange={(open) => {
						if (!open) setSelected(null);
					}}
					canAttach={false}
					manage
					onChanged={() => undefined}
				/>
			) : null}
		</Card>
	);
}
