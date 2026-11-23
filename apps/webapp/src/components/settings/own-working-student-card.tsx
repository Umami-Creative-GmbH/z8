"use client";

import { IconSchool } from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import type { OwnWorkingStudentStatus } from "@/lib/statutory/working-student/views";

/**
 * The employee's own working-student status on their profile (#1991): the remaining 26-week
 * balance and the lecture-free periods HR recorded. Nothing else (no prior employers, notes or
 * other employees) reaches it.
 */
export function OwnWorkingStudentCard({ status }: { status: OwnWorkingStudentStatus }) {
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() ?? "en";
	const formatDate = (date: string) => formatPlainDate(parsePlainDate(date), locale, "dateMedium");
	const { rolling } = status;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconSchool className="size-5 text-primary" aria-hidden="true" />
					{t("settings.profile.workingStudent.title", "Working student status")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.profile.workingStudent.description",
						"As a working student, you may work more than 20 hours in at most 26 weeks within 12 months.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-sm">
					{rolling.limitWeeks === null
						? t(
								"settings.profile.workingStudent.noBaseline",
								"No statutory limit applies to this week.",
							)
						: t(
								"settings.profile.workingStudent.balance",
								"{remaining} of {limit} weeks above 20 hours remaining ({used} used in the last 12 months).",
								{
									remaining: rolling.remainingWeeks ?? 0,
									limit: rolling.limitWeeks,
									used: rolling.usedWeeks,
								},
							)}
				</p>
				<div className="space-y-2">
					<h3 className="font-medium text-sm">
						{t("settings.profile.workingStudent.lectureFree", "Recorded lecture-free periods")}
					</h3>
					{status.lectureFreePeriods.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							{t(
								"settings.profile.workingStudent.lectureFreeEmpty",
								"No lecture-free periods recorded. Ask HR to record your semester breaks.",
							)}
						</p>
					) : (
						<ul className="space-y-1 text-sm tabular-nums">
							{status.lectureFreePeriods.map((period) => (
								<li key={`${period.startsOn}:${period.endsOn}`}>
									{formatDate(period.startsOn)} – {formatDate(period.endsOn)}
								</li>
							))}
						</ul>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
