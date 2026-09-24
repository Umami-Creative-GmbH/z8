"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { listTeams } from "@/app/[locale]/(app)/settings/teams/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useEmployeeOffboarding, useRequestIdentity } from "@/lib/query/use-employee-offboarding";
import { DepartureCard } from "./departure-card";
import { DepartureForm } from "./departure-form";
import { FollowUpList } from "./follow-up-list";
import { zonedDate } from "./format";
import { type RehireOption, RehireForm } from "./rehire-form";

type Panel = { kind: "departure"; mode: "scheduled" | "immediate" } | { kind: "rehire" } | null;

export type EmployeeOffboardingSectionProps = {
	organizationId: string;
	employeeId: string;
	/** Review to highlight, from a notification link. */
	highlightedReviewId: string | null;
	managers: RehireOption[];
	workPolicies: RehireOption[];
};

/**
 * Departure, rehire and follow-up for one employee on the existing detail
 * page. Everything shown comes from the server's lifecycle view; every
 * mutation is authorized again on the server.
 */
export function EmployeeOffboardingSection(props: EmployeeOffboardingSectionProps) {
	const { t } = useTranslate();
	const offboarding = useEmployeeOffboarding({
		organizationId: props.organizationId,
		employeeId: props.employeeId,
	});
	const [panel, setPanel] = useState<Panel>(null);
	const [confirmCancel, setConfirmCancel] = useState(false);
	const cancelIdentity = useRequestIdentity();
	const view = offboarding.view;
	const teamsQuery = useQuery({
		queryKey: ["teams", props.organizationId, "rehire-options"],
		queryFn: async () => {
			const result = await listTeams(props.organizationId);
			return result.success ? result.data.map((team) => ({ id: team.id, name: team.name })) : [];
		},
		enabled: panel?.kind === "rehire",
		staleTime: 60 * 1000,
	});

	if (offboarding.isLoading) {
		return (
			<output
				className="flex items-center justify-center p-4"
				aria-label={t("settings.employees.offboarding.loading", "Loading employment status")}
			>
				<IconLoader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
			</output>
		);
	}
	if (!view) return null;

	const closePanel = () => setPanel(null);
	const completed = (message: string) => {
		toast.success(message);
		closePanel();
	};
	// A panel for a different employee never mutates this one.
	const targetEmployeeId = view.employeeId;

	async function cancelDeparture() {
		if (!view?.departure) return;
		const intent = {
			employeeId: targetEmployeeId,
			departureId: view.departure.id,
			expectedRevision: view.departure.revision,
		};
		const result = await offboarding.cancelDeparture({
			...intent,
			requestId: cancelIdentity.forPayload(intent),
		});
		setConfirmCancel(false);
		if (result.success) {
			cancelIdentity.complete();
			toast.success(t("settings.employees.offboarding.canceled", "Departure canceled"));
		} else {
			toast.error(result.error);
		}
	}

	const followUpList = view.departure ? (
		<FollowUpList
			employeeId={targetEmployeeId}
			departureId={view.departure.id}
			reviews={view.reviews}
			failedTasks={view.failedTasks}
			canResolve={view.capabilities.resolve}
			timeCorrectionHref={`/calendar/${targetEmployeeId}?date=${zonedDate(
				view.departure.cutoff,
				view.departure.timezone,
			)}`}
			highlightedReviewId={props.highlightedReviewId}
			replacementOptions={props.managers}
			resolveReview={offboarding.resolveReview}
			retryTask={offboarding.retryTask}
			assignReplacement={offboarding.assignReplacement}
		/>
	) : null;

	return (
		<>
			<DepartureCard
				view={view}
				isMutating={offboarding.isMutating}
				onSchedule={() => setPanel({ kind: "departure", mode: "scheduled" })}
				onOffboardNow={() => setPanel({ kind: "departure", mode: "immediate" })}
				onCancelDeparture={() => setConfirmCancel(true)}
				onRehire={() => setPanel({ kind: "rehire" })}
				followUpList={followUpList}
			/>

			<ActionPanel open={panel !== null} onOpenChange={(open) => (open ? undefined : closePanel())}>
				<ActionPanelContent>
					<ActionPanelHeader>
						<ActionPanelTitle>
							{panel?.kind === "rehire"
								? t("settings.employees.offboarding.rehire", "Rehire employee")
								: panel?.mode === "immediate"
									? t("settings.employees.offboarding.offboardNow", "Offboard now")
									: t("settings.employees.offboarding.schedule", "Schedule departure")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{panel?.kind === "rehire"
								? t(
										"settings.employees.offboarding.rehirePanelDescription",
										"Start a new employment period with confirmed terms.",
									)
								: t(
										"settings.employees.offboarding.departurePanelDescription",
										"Access and paid-seat usage end at the cutoff shown below. Employee history is retained.",
									)}
						</ActionPanelDescription>
					</ActionPanelHeader>
					<ActionPanelBody>
						{panel?.kind === "departure" && (
							<DepartureForm
								key={`${targetEmployeeId}:${panel.mode}:${view.departure?.revision ?? 0}`}
								organizationId={props.organizationId}
								employeeId={targetEmployeeId}
								departure={view.state === "scheduled" ? view.departure : null}
								initialMode={panel.mode}
								canSchedule={view.capabilities.schedule}
								canOffboardNow={view.capabilities.offboardNow}
								scheduleDeparture={offboarding.scheduleDeparture}
								offboardNow={offboarding.offboardNow}
								onCompleted={() =>
									completed(t("settings.employees.offboarding.saved", "Departure saved"))
								}
								onCancel={closePanel}
							/>
						)}
						{panel?.kind === "rehire" && view.previousEmploymentPeriodId && (
							<RehireForm
								key={targetEmployeeId}
								employeeId={targetEmployeeId}
								previousEmploymentPeriodId={view.previousEmploymentPeriodId}
								membershipApproved={view.membershipApproved}
								teams={teamsQuery.data ?? []}
								managers={props.managers}
								workPolicies={props.workPolicies}
								rehire={offboarding.rehire}
								onCompleted={() =>
									completed(t("settings.employees.offboarding.rehired", "Employee rehired"))
								}
								onCancel={closePanel}
							/>
						)}
					</ActionPanelBody>
				</ActionPanelContent>
			</ActionPanel>

			<AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.employees.offboarding.cancelTitle", "Cancel this departure?")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.employees.offboarding.cancelDescription",
								"The employee keeps access and their seat. The canceled departure stays in the audit history.",
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={(event) => {
								event.preventDefault();
								void cancelDeparture();
							}}
						>
							{t("settings.employees.offboarding.cancelDeparture", "Cancel departure")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
