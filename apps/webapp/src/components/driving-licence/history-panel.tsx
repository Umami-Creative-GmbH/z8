"use client";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { TFormControl, TFormItem, TFormLabel } from "@/components/ui/tanstack-form";
import { useSession } from "@/lib/auth-client";
import type { DrivingLicenceHistoryPeriod } from "@/lib/organization/driving-licence/history";
import { getDrivingLicenceHistoryAction } from "@/lib/organization/driving-licence/history-actions";
import { queryKeys } from "@/lib/query";
import { DrivingStatusLabel } from "./check-evidence";
import { DrivingLicenceHistoryTimeline } from "./history-timeline";
import { DrivingCheckSupplementForm } from "./supplement-form";
export function DrivingLicenceHistoryPanel({ employeeId }: { employeeId: string }) {
	const { t } = useTranslate();
	const titleId = useId();
	const router = useRouter();
	const queryClient = useQueryClient();
	const { data: session } = useSession();
	const organizationId = session?.session.activeOrganizationId;
	const userId = session?.user.id;
	const [period, setPeriod] = useState<DrivingLicenceHistoryPeriod>({});
	const [selectedCheckId, setSelectedCheckId] = useState<string | null>(null);
	const form = useForm({
		defaultValues: { from: "", to: "" },
		onSubmit: ({ value }) => {
			setSelectedCheckId(null);
			setPeriod({
				...(value.from ? { from: `${value.from}T00:00:00Z` } : {}),
				...(value.to ? { to: `${value.to}T00:00:00Z` } : {}),
			});
		},
	});
	const query = useQuery({
		queryKey: queryKeys.drivingLicence.history(organizationId, userId, employeeId, period),
		queryFn: () => getDrivingLicenceHistoryAction({ employeeId, ...period }),
	});
	const data = query.data?.success ? query.data.data : null;
	const selected = data?.canSupplement
		? data.checks.find((check) => check.id === selectedCheckId)
		: null;
	const refresh = async () => {
		setSelectedCheckId(null);
		void queryClient.invalidateQueries({
			queryKey: queryKeys.drivingLicence.status,
		});
		await queryClient.invalidateQueries({
			queryKey: queryKeys.drivingLicence.historyAll(organizationId, userId, employeeId),
		});
		await queryClient.invalidateQueries({
			queryKey: queryKeys.drivingLicence.record(organizationId, userId, employeeId),
		});
		await queryClient.invalidateQueries({
			queryKey: queryKeys.drivingLicence.worklistAll(organizationId, userId),
		});
		router.refresh();
	};
	return (
		<Card role="region" aria-labelledby={titleId}>
			<CardHeader>
				<CardTitle>
					<h2 id={titleId} className="text-lg font-semibold">
						{t("drivingLicence.history.title", "Check and authorization history")}
					</h2>
				</CardTitle>
				<CardDescription>
					{t(
						"drivingLicence.history.help",
						"Original confirmations, dated supplements and effective authorization decisions remain separate. Earlier evidence needed to understand the selected period is labeled as context. All event times and period boundaries below use UTC.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<form
					className="flex flex-wrap items-end gap-3"
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<form.Field name="from">
						{(field) => (
							<TFormItem>
								<TFormLabel>{t("drivingLicence.history.from", "From date (UTC)")}</TFormLabel>
								<TFormControl>
									<DatePicker
										value={field.state.value || null}
										onBlur={field.handleBlur}
										onChange={(value) => field.handleChange(value)}
									/>
								</TFormControl>
							</TFormItem>
						)}
					</form.Field>
					<form.Field name="to">
						{(field) => (
							<TFormItem>
								<TFormLabel>{t("drivingLicence.history.to", "Before date (UTC)")}</TFormLabel>
								<TFormControl>
									<DatePicker
										value={field.state.value || null}
										onBlur={field.handleBlur}
										onChange={(value) => field.handleChange(value)}
									/>
								</TFormControl>
							</TFormItem>
						)}
					</form.Field>
					<Button type="submit" variant="outline">
						{t("drivingLicence.history.apply", "Apply period")}
					</Button>
				</form>
				{query.isPending ? (
					<p role="status">{t("drivingLicence.history.loading", "Loading history…")}</p>
				) : !data ? (
					<p role="alert">
						{t(
							"drivingLicence.history.unavailable",
							"History is unavailable. Check the period and your current access.",
						)}
					</p>
				) : (
					<>
						<Button asChild variant="outline">
							<a
								href={`/api/driving-licence/evidence?${new URLSearchParams({ employeeId, ...period }).toString()}`}
							>
								{t("drivingLicence.history.downloadPdf", "Download evidence PDF")}
							</a>
						</Button>
						<p className="font-medium">
							<DrivingStatusLabel status={data.authorization.status} />
						</p>
						<DrivingLicenceHistoryTimeline
							history={data}
							supplementForm={
								selected
									? {
											checkId: selected.id,
											content: (
												<DrivingCheckSupplementForm
													key={selected.id}
													employeeId={employeeId}
													check={selected}
													onSaved={refresh}
													onCancel={() => setSelectedCheckId(null)}
												/>
											),
										}
									: null
							}
							onSupplement={setSelectedCheckId}
						/>
					</>
				)}
			</CardContent>
		</Card>
	);
}
