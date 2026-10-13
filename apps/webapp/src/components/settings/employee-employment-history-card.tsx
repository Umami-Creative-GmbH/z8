"use client";

import { IconCash, IconPlus } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
	isCurrentConfirmed,
	isFutureConfirmed,
	toDateTime,
	toEmploymentHistoryPayload,
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
	changeWage,
}: EmployeeEmploymentHistoryCardProps) {
	const { t } = useTranslate();
	const [isAdding, setIsAdding] = useState(false);
	const [isChangingWage, setIsChangingWage] = useState(false);
	const now = DateTime.utc();
	const sortedHistory = history.toSorted(
		(a, b) =>
			(toDateTime(b.validFrom)?.toMillis() ?? 0) - (toDateTime(a.validFrom)?.toMillis() ?? 0),
	);
	const policyNameById = new Map(workPolicies.map((policy) => [policy.id, policy.name]));
	const current = sortedHistory.find((entry) => isCurrentConfirmed(entry, now));
	const nextConfirmed = sortedHistory
		.filter((entry) => isFutureConfirmed(entry, now))
		.toSorted(
			(a, b) =>
				(toDateTime(a.validFrom)?.toMillis() ?? 0) - (toDateTime(b.validFrom)?.toMillis() ?? 0),
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
				result.error ||
					t("settings.employmentHistory.addError", "Failed to add employment history change"),
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
			result?.error ||
				t("settings.employmentHistory.confirmError", "Failed to confirm employment history change"),
		);
	};
	const handleCancel = async (historyId: string) => {
		if (
			!window.confirm(
				t(
					"settings.employmentHistory.cancelConfirm",
					"Cancel this employment change? This removes the scheduled or draft employment change.",
				),
			)
		)
			return;
		const result = await onCancel(historyId).catch(() => null);
		if (result?.success) {
			toast.success(
				t("settings.employmentHistory.cancelSuccess", "Employment history change canceled"),
			);
			return;
		}
		toast.error(
			result?.error ||
				t("settings.employmentHistory.cancelError", "Failed to cancel employment history change"),
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
				<div className="grid gap-3 md:grid-cols-2">
					<EmploymentHistoryContext
						label={t("settings.employmentHistory.currentConfirmed", "Current confirmed")}
						entry={current}
						empty={t(
							"settings.employmentHistory.noCurrentContext",
							"No confirmed contract context",
						)}
						t={t}
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
					onCancel={handleCancel}
					t={t}
					policyNameById={policyNameById}
				/>
			</CardContent>
		</Card>
	);
}
