"use client";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormItem,
	TFormLabel,
} from "@/components/ui/tanstack-form";
import { useSession } from "@/lib/auth-client";
import type { DrivingLicenceHistoryPeriod } from "@/lib/organization/driving-licence/history";
import { getDrivingLicenceHistoryAction } from "@/lib/organization/driving-licence/history-actions";
import { DrivingStatusLabel } from "./check-evidence";
import { DrivingLicenceHistoryTimeline } from "./history-timeline";
import { DrivingCheckSupplementForm } from "./supplement-form";
export function DrivingLicenceHistoryPanel({
	employeeId,
}: {
	employeeId: string;
}) {
	const { t } = useTranslate();
	const titleId = useId();
	const router = useRouter();
	const queryClient = useQueryClient();
	const { data: session } = useSession();
	const identity = [session?.session.activeOrganizationId, session?.user.id];
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
		queryKey: ["driving-licence-history", ...identity, employeeId, period],
		queryFn: () => getDrivingLicenceHistoryAction({ employeeId, ...period }),
	});
	const data = query.data?.success ? query.data.data : null;
	const selected = data?.canSupplement
		? data.checks.find((check) => check.id === selectedCheckId)
		: null;
	const refresh = async () => {
		setSelectedCheckId(null);
		await queryClient.invalidateQueries({
			queryKey: ["driving-licence-history", ...identity, employeeId],
		});
		await queryClient.invalidateQueries({
			queryKey: ["driving-licence-record", ...identity, employeeId],
		});
		await queryClient.invalidateQueries({
			queryKey: ["driving-licence-worklist", ...identity],
		});
		router.refresh();
	};
	return (
		<section className="space-y-4 border-t pt-6" aria-labelledby={titleId}>
			<h2 id={titleId} className="text-xl font-semibold">
				{t("drivingLicence.history.title", "Check and authorization history")}
			</h2>
			<p className="text-sm text-muted-foreground">
				{t(
					"drivingLicence.history.help",
					"Original confirmations, dated supplements and effective authorization decisions remain separate. Earlier evidence needed to understand the selected period is labeled as context. All event times and period boundaries below use UTC.",
				)}
			</p>
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
							<TFormLabel>
								{t("drivingLicence.history.from", "From date (UTC)")}
							</TFormLabel>
							<TFormControl>
								<Input
									type="date"
									autoComplete="off"
									name={field.name}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
								/>
							</TFormControl>
						</TFormItem>
					)}
				</form.Field>
				<form.Field name="to">
					{(field) => (
						<TFormItem>
							<TFormLabel>
								{t("drivingLicence.history.to", "Before date (UTC)")}
							</TFormLabel>
							<TFormControl>
								<Input
									type="date"
									autoComplete="off"
									name={field.name}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
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
				<p role="status">
					{t("drivingLicence.history.loading", "Loading history…")}
				</p>
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
		</section>
	);
}
