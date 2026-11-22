"use client";

import { IconCash, IconLoader2, IconPlus } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { systemClock } from "@/lib/datetime/temporal-core";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import { ChangeWageForm } from "./employee-employment-history/change-wage-form";
import { EmploymentHistoryForm } from "./employee-employment-history/form";
import {
	EmploymentHistoryContext,
	EmploymentHistoryTimeline,
} from "./employee-employment-history/timeline";
import type {
	EmployeeEmploymentHistoryCardProps,
	EmploymentHistoryWorkPolicyOption,
} from "./employee-employment-history/types";
import {
	defaultFormValues,
	formatDate,
	formatWeeklyHours,
	isCurrentConfirmed,
	isFutureConfirmed,
	toEmploymentHistoryPayload,
	toInstant,
} from "./employee-employment-history/utils";

export type {
	EmployeeEmploymentHistoryCardProps,
	EmploymentHistoryEntry,
	EmploymentHistoryWorkPolicyOption,
} from "./employee-employment-history/types";

const EMPTY_WORK_POLICIES: EmploymentHistoryWorkPolicyOption[] = [];

export function EmployeeEmploymentHistoryCard({
	history,
	canManage,
	onCreate,
	onConfirm,
	onCancel,
	isCreating,
	isMutating,
	workPolicies = EMPTY_WORK_POLICIES,
	notice,
	lifecycleEvents,
	changeWage,
}: EmployeeEmploymentHistoryCardProps) {
	const { t } = useTranslate();
	const locale = useLocale();
	const [isAdding, setIsAdding] = useState(false);
	const [isChangingWage, setIsChangingWage] = useState(false);
	const now = systemClock.nowInstant();
	const sortedHistory = history.toSorted(
		(a, b) =>
			(toInstant(b.validFrom)?.epochMilliseconds ?? 0) -
			(toInstant(a.validFrom)?.epochMilliseconds ?? 0),
	);
	const policyNameById = new Map(workPolicies.map((policy) => [policy.id, policy.name]));
	const current = sortedHistory.find((entry) => isCurrentConfirmed(entry, now));
	const nextConfirmed = sortedHistory
		.filter((entry) => isFutureConfirmed(entry, now))
		.toSorted(
			(a, b) =>
				(toInstant(a.validFrom)?.epochMilliseconds ?? 0) -
				(toInstant(b.validFrom)?.epochMilliseconds ?? 0),
		)[0];
	const form = useForm({
		defaultValues: defaultFormValues,
		onSubmit: async ({ value }) => {
			const result = await onCreate(toEmploymentHistoryPayload(value)).catch(() => null);
			if (!result) {
				toast.error(t("common.unexpectedError", "An unexpected error occurred"));
				return;
			}
			if (result.success) {
				toast.success(
					t("settings.employmentHistory.addSuccess", "Employment history change added"),
				);
				form.reset();
				setIsAdding(false);
				return;
			}
			toast.error(
				actionErrorMessage(t, result, {}, [
					"settings.employmentHistory.addError",
					"Failed to add employment history change",
				]),
			);
		},
	});
	const handleConfirm = async (historyId: string) => {
		const result = await onConfirm(historyId).catch(() => null);
		if (result?.success) {
			toast.success(
				t("settings.employmentHistory.confirmSuccess", "Employment history change confirmed"),
			);
			return;
		}
		toast.error(
			actionErrorMessage(t, result, {}, [
				"settings.employmentHistory.confirmError",
				"Failed to confirm employment history change",
			]),
		);
	};
	// Cancelling removes a scheduled or draft change, so it is confirmed first.
	// The dialog stays open while the cancellation runs and shows a failure inline.
	const [pendingCancelId, setPendingCancelId] = useState<string | null>(null);
	const [isCancelling, setIsCancelling] = useState(false);
	const [cancelError, setCancelError] = useState<string | null>(null);
	const pendingCancelEntry = pendingCancelId
		? sortedHistory.find((entry) => entry.id === pendingCancelId)
		: undefined;
	const pendingCancelDate = pendingCancelEntry
		? formatDate(pendingCancelEntry.validFrom, locale)
		: null;
	const requestCancel = (historyId: string) => {
		setCancelError(null);
		setPendingCancelId(historyId);
	};
	const handleCancel = async (historyId: string) => {
		if (isCancelling) return;
		setIsCancelling(true);
		setCancelError(null);
		const result = await onCancel(historyId).catch(() => null);
		setIsCancelling(false);
		if (result?.success) {
			setPendingCancelId(null);
			toast.success(
				t("settings.employmentHistory.cancelSuccess", "Employment history change canceled"),
			);
			return;
		}
		setCancelError(
			actionErrorMessage(t, result, {}, [
				"settings.employmentHistory.cancelError",
				"Failed to cancel employment history change",
			]),
		);
	};
	return (
		<Card id="employment-history">
			<CardHeader className="flex flex-row items-start justify-between gap-4">
				<div>
					<CardTitle>{t("settings.employmentHistory.title", "Contract & Work Model")}</CardTitle>
					<CardDescription>
						{t(
							"settings.employmentHistory.description",
							"Confirmed context and scheduled employment changes",
						)}
					</CardDescription>
				</div>
				<div className="flex flex-wrap justify-end gap-2">
					{canManage && changeWage && (
						<Button
							size="sm"
							variant="outline"
							aria-expanded={isChangingWage}
							onClick={() => {
								setIsChangingWage(!isChangingWage);
								setIsAdding(false);
							}}
						>
							<IconCash className="mr-2 size-4" aria-hidden="true" />
							{t("settings.employmentHistory.changeWage.title", "Change wage")}
						</Button>
					)}
					{canManage && (
						<Button
							size="sm"
							variant={isAdding ? "outline" : "default"}
							onClick={() => {
								setIsAdding(!isAdding);
								setIsChangingWage(false);
							}}
						>
							<IconPlus className="mr-2 size-4" aria-hidden="true" />
							{t("settings.employmentHistory.addChange", "Add Change")}
						</Button>
					)}
				</div>
			</CardHeader>
			<CardContent className="space-y-6">
				{canManage && notice}
				<div className="grid gap-3 md:grid-cols-2">
					<EmploymentHistoryContext
						label={t("settings.employmentHistory.currentConfirmed", "Current confirmed")}
						entry={current}
						empty={t(
							"settings.employmentHistory.noCurrentContext",
							"No confirmed contract context",
						)}
						t={t}
						locale={locale}
						policyNameById={policyNameById}
					/>
					<EmploymentHistoryContext
						label={t(
							"settings.employmentHistory.nextScheduledConfirmed",
							"Next scheduled confirmed",
						)}
						entry={nextConfirmed}
						empty={t(
							"settings.employmentHistory.noScheduledChange",
							"No confirmed change scheduled",
						)}
						t={t}
						locale={locale}
						policyNameById={policyNameById}
					/>
				</div>
				{canManage && changeWage && isChangingWage && (
					<ChangeWageForm
						onSubmit={changeWage.onSubmit}
						isPending={changeWage.isPending}
						onClose={() => setIsChangingWage(false)}
					/>
				)}
				{canManage && isAdding && (
					<EmploymentHistoryForm
						form={form}
						isCreating={isCreating}
						workPolicies={workPolicies}
						onCancel={() => setIsAdding(false)}
					/>
				)}
				<EmploymentHistoryTimeline
					history={sortedHistory}
					canManage={canManage}
					isMutating={isMutating}
					now={now}
					onConfirm={handleConfirm}
					onCancel={requestCancel}
					t={t}
					locale={locale}
					policyNameById={policyNameById}
				/>
				{lifecycleEvents}
			</CardContent>
			<CancelEmploymentChangeDialog
				pendingCancelId={pendingCancelId}
				isCancelling={isCancelling}
				setPendingCancelId={setPendingCancelId}
				setCancelError={setCancelError}
				pendingCancelEntry={pendingCancelEntry}
				pendingCancelDate={pendingCancelDate}
				cancelError={cancelError}
				handleCancel={handleCancel}
			/>
		</Card>
	);
}

function CancelEmploymentChangeDialog({
	pendingCancelId,
	isCancelling,
	setPendingCancelId,
	setCancelError,
	pendingCancelEntry,
	pendingCancelDate,
	cancelError,
	handleCancel,
}: {
	pendingCancelId: string | null;
	isCancelling: boolean;
	setPendingCancelId: (id: null) => void;
	setCancelError: (error: null) => void;
	pendingCancelEntry: EmployeeEmploymentHistoryCardProps["history"][number] | undefined | null;
	pendingCancelDate: string | null;
	cancelError: string | null;
	handleCancel: (id: string) => void;
}) {
	const { t } = useTranslate();
	return (
		<AlertDialog
			open={pendingCancelId !== null}
			onOpenChange={(open) => {
				// Escape or an outside press must not hide a cancellation that is still running.
				if (!open && !isCancelling) {
					setPendingCancelId(null);
					setCancelError(null);
				}
			}}
		>
			<AlertDialogContent aria-busy={isCancelling}>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{pendingCancelEntry && pendingCancelDate
							? t(
									"settings.employmentHistory.cancelConfirmNamedTitle",
									"Cancel {contractType} change effective {date}?",
									{
										contractType: pendingCancelEntry.contractType,
										date: pendingCancelDate,
									},
								)
							: t("settings.employmentHistory.cancelConfirmTitle", "Cancel employment change?")}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{t(
							"settings.employmentHistory.cancelConfirm",
							"Cancel this employment change? This removes the scheduled or draft employment change.",
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				{pendingCancelEntry && (
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.employmentHistory.cancelConfirmSummary",
							"{hours} / week · {workModel} · {reviewState}",
							{
								hours:
									pendingCancelEntry.weeklyContractMinutes !== null
										? formatWeeklyHours(pendingCancelEntry.weeklyContractMinutes)
										: t("settings.employmentHistory.inherited", "Inherited"),
								workModel:
									pendingCancelEntry.workModel ??
									t("settings.employmentHistory.inherited", "Inherited"),
								reviewState: pendingCancelEntry.reviewState,
							},
						)}
					</p>
				)}
				{cancelError && (
					<p role="alert" className="text-sm text-destructive">
						{cancelError}
					</p>
				)}
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isCancelling}>
						{t("settings.employmentHistory.keepChange", "Keep change")}
					</AlertDialogCancel>
					<Button
						variant="destructive"
						disabled={isCancelling}
						onClick={() => {
							if (pendingCancelId) void handleCancel(pendingCancelId);
						}}
					>
						{isCancelling ? (
							<IconLoader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
						) : null}
						{t("settings.employmentHistory.cancelChange", "Cancel change")}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
