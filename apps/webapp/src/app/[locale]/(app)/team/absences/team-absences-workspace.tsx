"use client";

import { useTranslate } from "@tolgee/react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useOrganization } from "@/hooks/use-organization";
import type { ServerActionResult } from "@/lib/effect/result";
import { useRouter } from "@/navigation";
import { usePersonnelFilesEnabled } from "@/stores/organization-settings-store";
import type {
	ManagerAbsenceCalendarResult,
	ManagerAbsenceListResult,
} from "./manager-absence-types";
import type { RecordAbsenceDialog } from "./record-absence-dialog";
import { TeamAbsenceYearCalendar } from "./team-absence-year-calendar";
import { TeamAbsencesTable } from "./team-absences-table";

type Props = {
	actor: { userId: string; organizationId: string; employeeId: string; role: string };
	requestKey: string;
	search: string;
	listResult: ServerActionResult<ManagerAbsenceListResult>;
	calendarResult: ServerActionResult<ManagerAbsenceCalendarResult>;
	categories: React.ComponentProps<typeof RecordAbsenceDialog>["categories"];
	sickNotesEnabled: boolean;
	recordingSetupUnavailable?: boolean;
};

export function TeamAbsencesHeading() {
	const { t } = useTranslate();
	return (
		<h1 className="text-pretty text-2xl font-semibold">
			{t("team.absences.title", "Team absences")}
		</h1>
	);
}

export function AbsenceReadFailure({
	title,
	retained = false,
	onRetry,
}: {
	title: string;
	retained?: boolean;
	onRetry?: () => unknown;
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	return (
		<div
			role="alert"
			className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4"
		>
			<div>
				<h2 className="font-semibold">{title}</h2>
				<p className="text-sm text-muted-foreground">
					{retained
						? t(
								"team.absences.retained",
								"Previously loaded data is shown. Retry to get current records.",
							)
						: t("team.absences.error.description", "Please try again in a moment.")}
				</p>
			</div>
			<Button
				variant="outline"
				disabled={pending}
				onClick={() =>
					startTransition(async () => {
						if (onRetry) await onRetry();
						else router.refresh();
					})
				}
			>
				{pending ? t("common.loading", "Loading…") : t("common.retry", "Retry")}
			</Button>
		</div>
	);
}

/** Match every server arrival to the current actor, organization and authority. */
export function TeamAbsencesWorkspace(props: Props) {
	const scope = useOrganization();
	const personnelFilesEnabled = usePersonnelFilesEnabled();
	const { t } = useTranslate();
	if (scope.error)
		return (
			<AbsenceReadFailure
				title={t("team.absences.scopeUnavailable", "Unable to load the current team scope")}
				onRetry={scope.refetch}
			/>
		);
	if (
		scope.userId !== props.actor.userId ||
		scope.activeOrganizationId !== props.actor.organizationId ||
		scope.employeeId !== props.actor.employeeId ||
		scope.role !== props.actor.role
	) {
		if (!scope.isLoading)
			return (
				<AbsenceReadFailure
					title={t("team.absences.scopeChanged", "Team scope changed. Reload to continue.")}
				/>
			);
		return (
			<p role="status">{t("team.absences.scopeLoading", "Loading the current team scope…")}</p>
		);
	}
	return (
		<TeamAbsencesRecords
			key={JSON.stringify([props.actor, personnelFilesEnabled, props.sickNotesEnabled])}
			{...props}
			sickNotesEnabled={props.sickNotesEnabled && personnelFilesEnabled}
		/>
	);
}

/** Retain successful reads only within the exact requested period/filter scope. */
function useRetainedRead<T>(source: ServerActionResult<T>, requestKey: string) {
	const [snapshot, setSnapshot] = useState({
		source,
		requestKey,
		data: source.success ? source.data : null,
	});
	if (snapshot.source !== source || snapshot.requestKey !== requestKey) {
		const data = source.success
			? source.data
			: snapshot.requestKey === requestKey
				? snapshot.data
				: null;
		setSnapshot({ source, requestKey, data });
		return data;
	}
	return snapshot.data;
}

function TeamAbsencesRecords(props: Props) {
	const { t } = useTranslate();
	const list = useRetainedRead(props.listResult, props.requestKey);
	const calendar = useRetainedRead(props.calendarResult, props.requestKey);
	const calendarContent = (
		<>
			{!props.calendarResult.success ? (
				<AbsenceReadFailure
					title={t("team.absences.calendar.error.title", "Unable to load calendar")}
					retained={Boolean(calendar)}
				/>
			) : null}
			{calendar ? (
				<TeamAbsenceYearCalendar
					key={props.requestKey}
					data={calendar}
					allowActions={props.calendarResult.success}
				/>
			) : null}
		</>
	);
	const listError = !props.listResult.success ? (
		<AbsenceReadFailure
			title={t("team.absences.error.title", "Unable to load absences")}
			retained={Boolean(list)}
		/>
	) : null;
	return list ? (
		<TeamAbsencesTable
			data={list}
			search={props.search}
			categories={props.categories}
			sickNotesEnabled={props.sickNotesEnabled}
			recordingAvailable={props.listResult.success && !props.recordingSetupUnavailable}
		>
			{props.recordingSetupUnavailable ? (
				<AbsenceReadFailure
					title={t(
						"team.absences.recordingUnavailable",
						"Unable to load absence recording options",
					)}
				/>
			) : null}
			{calendarContent}
			{listError}
		</TeamAbsencesTable>
	) : (
		<div className="space-y-6">
			{calendarContent}
			{listError}
		</div>
	);
}
