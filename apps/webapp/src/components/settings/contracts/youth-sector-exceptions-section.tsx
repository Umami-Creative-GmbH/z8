"use client";

import { IconLoader2, IconMoonStars, IconShieldCheck } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	acknowledgeYouthSectorExceptionAction,
	listYouthSectorExceptionsAction,
} from "@/app/[locale]/(app)/settings/contracts/youth-sector-exception-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import {
	actionErrorMessage,
	type RefusalMessages,
} from "@/lib/organization-action/action-error-message";
import { queryKeys } from "@/lib/query/keys";
import type { StatutoryAcknowledgementRefusal } from "@/lib/statutory/acknowledgements";
import type {
	JarbschgSectorExceptionKind,
	OpenYouthSectorException,
	YouthSectorExceptionRefusal,
} from "@/lib/statutory/youth/sector-exception-review";

type Translate = ReturnType<typeof useTranslate>["t"];

/** Every refusal recording a sector exception can return, as admins read it. */
export const youthSectorExceptionRefusals = {
	statutory_finding_not_found: [
		"settings.contracts.reviews.youth.refusal.notFound",
		"This finding is no longer open. The list shows the current findings.",
	],
	statutory_finding_changed: [
		"settings.contracts.reviews.youth.refusal.changed",
		"The shift changed since this list was loaded. Review it again before recording the exception.",
	],
	statutory_reason_required: [
		"settings.contracts.reviews.youth.refusal.reasonRequired",
		"Explain which sector exception applies.",
	],
	statutory_subject_required: [
		"settings.contracts.reviews.youth.refusal.subjectRequired",
		"This finding cannot be acknowledged. Reload the list and try again.",
	],
} as const satisfies RefusalMessages<YouthSectorExceptionRefusal | StatutoryAcknowledgementRefusal>;

const youthSectorExceptionsKey = (organizationId: string) =>
	["contracts", "youth-sector-exceptions", organizationId] as const;

function kindLabel(kind: JarbschgSectorExceptionKind, t: Translate): string {
	switch (kind) {
		case "jarbschg_night_work":
			return t("settings.contracts.reviews.youth.kind.night", "Night work (20:00–06:00)");
		case "jarbschg_saturday_work":
			return t("settings.contracts.reviews.youth.kind.saturday", "Saturday work");
		case "jarbschg_sunday_work":
			return t("settings.contracts.reviews.youth.kind.sunday", "Sunday work");
		case "jarbschg_holiday_work":
			return t("settings.contracts.reviews.youth.kind.holiday", "Public holiday work");
		case "jarbschg_shift_span":
			return t(
				"settings.contracts.reviews.youth.kind.shiftSpan",
				"Shift span of 10 to 11 hours (§ 12)",
			);
	}
}

/**
 * Open JArbSchG night, Saturday, Sunday and holiday findings of employees under 18 (#1993). An
 * org admin records a statutory sector exception with a reason; it covers the shift as shown and
 * lifts its publication block. #1994 folds this list into the unified Reviews inbox.
 */
export function YouthSectorExceptionsSection({ organizationId }: { organizationId: string }) {
	const { t } = useTranslate();
	const query = useQuery({
		queryKey: youthSectorExceptionsKey(organizationId),
		queryFn: async (): Promise<OpenYouthSectorException[]> => {
			const result = await listYouthSectorExceptionsAction();
			if (!result.success) throw new Error(actionErrorMessage(t, result));
			return result.data;
		},
	});
	const findings = query.data ?? [];
	if (query.isLoading || (findings.length === 0 && !query.isError)) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconMoonStars className="size-5" aria-hidden="true" />
					{t("settings.contracts.reviews.youth.title", "Youth protection: sector exceptions")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.contracts.reviews.youth.description",
						"Employees under 18 may work at night, on weekends or on public holidays only under a statutory sector exception (§§ 14, 16–18 JArbSchG). Record why it applies; it covers the shift as shown here.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{query.isError ? (
					<p className="text-destructive text-sm">
						{t(
							"settings.contracts.reviews.youth.loadFailed",
							"Could not load youth protection findings.",
						)}
					</p>
				) : (
					<ul className="divide-y rounded-md border">
						{findings.map((finding) => (
							<YouthSectorExceptionItem
								key={finding.findingId}
								organizationId={organizationId}
								finding={finding}
							/>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}

function YouthSectorExceptionItem({
	organizationId,
	finding,
}: {
	organizationId: string;
	finding: OpenYouthSectorException;
}) {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const mutation = useMutation({
		mutationFn: async (value: { reason: string; legalNote: string }) => {
			const result = await acknowledgeYouthSectorExceptionAction({
				employeeId: finding.employeeId,
				findingKind: finding.findingKind,
				subjectKey: finding.subjectKey,
				periodStart: finding.periodStart,
				expectedFingerprint: finding.inputFingerprint,
				reason: value.reason,
				legalNote: value.legalNote.trim() || null,
			});
			if (!result.success) {
				throw new Error(actionErrorMessage(t, result, youthSectorExceptionRefusals));
			}
		},
		onSuccess: () => {
			toast.success(
				t("settings.contracts.reviews.youth.acknowledged", "Sector exception recorded"),
			);
			setOpen(false);
		},
		onError: (error) => toast.error(error.message),
		// A refused (changed) finding is refetched too, so the admin sees what changed; the
		// scheduler's compliance warnings show the finding as well.
		onSettled: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: youthSectorExceptionsKey(organizationId) }),
				queryClient.invalidateQueries({ queryKey: queryKeys.compliance.all }),
			]),
	});
	const form = useForm({
		defaultValues: { reason: "", legalNote: "" },
		onSubmit: async ({ value }) => {
			// A refusal is shown by onError; the form keeps what was entered.
			await mutation.mutateAsync(value).catch(() => undefined);
		},
	});

	return (
		<li className="flex flex-col gap-3 p-3">
			<div className="flex flex-wrap items-center gap-2">
				<span className="font-medium">{finding.employeeName}</span>
				<Badge variant="outline">{kindLabel(finding.findingKind, t)}</Badge>
				<span className="text-muted-foreground text-sm tabular-nums">
					{formatPlainDate(parsePlainDate(finding.periodStart), locale, "dateMedium")}
				</span>
				{finding.used?.unit === "minutes" ? (
					<span className="text-muted-foreground text-sm tabular-nums">
						{t("settings.contracts.reviews.youth.nightMinutes", "{minutes} min at night", {
							minutes: finding.used.value,
						})}
					</span>
				) : null}
				{finding.acknowledgementStatus === "stale" ? (
					<Badge variant="secondary">
						{t("settings.contracts.reviews.youth.stale", "Changed since last acknowledged")}
					</Badge>
				) : null}
				<span className="text-muted-foreground text-xs">{finding.legalReference}</span>
			</div>
			{open ? (
				<form
					className="grid gap-3 sm:grid-cols-2"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<form.Field
						name="reason"
						validators={{
							onSubmit: ({ value }) =>
								value.trim()
									? undefined
									: t(
											"settings.contracts.reviews.youth.reasonRequired",
											"Explain which sector exception applies.",
										),
						}}
					>
						{(field) => (
							<div className="space-y-1.5 sm:col-span-2">
								<Label htmlFor={`youth-reason-${finding.findingId}`}>
									{t(
										"settings.contracts.reviews.youth.reason",
										"Why does a sector exception apply?",
									)}
								</Label>
								<Textarea
									id={`youth-reason-${finding.findingId}`}
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
									maxLength={1000}
									aria-invalid={field.state.meta.errors.length > 0}
								/>
								{field.state.meta.errors.length > 0 ? (
									<p className="text-destructive text-xs">{field.state.meta.errors.join(" ")}</p>
								) : null}
							</div>
						)}
					</form.Field>
					<form.Field name="legalNote">
						{(field) => (
							<div className="space-y-1.5 sm:col-span-2">
								<Label htmlFor={`youth-legal-${finding.findingId}`}>
									{t(
										"settings.contracts.reviews.youth.legalNote",
										"Legal basis (optional), e.g. § 14 Abs. 2 Nr. 1 JArbSchG",
									)}
								</Label>
								<Input
									id={`youth-legal-${finding.findingId}`}
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
									maxLength={500}
								/>
							</div>
						)}
					</form.Field>
					<div className="flex gap-2 sm:col-span-2">
						<Button type="submit" size="sm" disabled={mutation.isPending}>
							{mutation.isPending ? (
								<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
							) : (
								<IconShieldCheck className="mr-1.5 size-4" aria-hidden="true" />
							)}
							{t("settings.contracts.reviews.youth.confirm", "Record sector exception")}
						</Button>
						<Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
					</div>
				</form>
			) : (
				<div>
					<Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
						<IconShieldCheck className="mr-1.5 size-4" aria-hidden="true" />
						{t("settings.contracts.reviews.youth.acknowledge", "Record sector exception…")}
					</Button>
				</div>
			)}
		</li>
	);
}
