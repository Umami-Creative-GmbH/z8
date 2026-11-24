"use client";

import { IconInfoCircle, IconLoader2, IconMoonStars, IconShieldCheck } from "@tabler/icons-react";
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
import { cn } from "@/lib/utils";
import { invalidateStatutoryReviewViews } from "./statutory-review-query-keys";
import {
	InvalidatedAcknowledgementNotice,
	invalidatedItemClassName,
	StatutoryAcknowledgementHistory,
} from "./statutory-review-shared";

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

/** A finding's figure in minutes, worded by what the rule measures. */
function usedMinutesLabel(kind: JarbschgSectorExceptionKind, minutes: number, t: Translate) {
	return kind === "jarbschg_shift_span"
		? t("settings.contracts.reviews.youth.shiftSpanMinutes", "{minutes} min shift span", {
				minutes,
			})
		: t("settings.contracts.reviews.youth.nightMinutes", "{minutes} min at night", { minutes });
}

/**
 * Open JArbSchG night, Saturday, Sunday and holiday findings of employees under 18 (#1993). An
 * org admin records a statutory sector exception with a reason; it covers the shift as shown and
 * lifts its publication block. The unified Reviews inbox (#1994) shows it under Youth & Apprentice.
 */
export function YouthSectorExceptionsSection({
	organizationId,
	includeResolved = false,
	showWhenEmpty = false,
}: {
	organizationId: string;
	/** Also list findings a current sector exception documents. */
	includeResolved?: boolean;
	/** Show the card with an empty note instead of nothing (the domain filter is selected). */
	showWhenEmpty?: boolean;
}) {
	const { t } = useTranslate();
	const query = useQuery({
		queryKey: [...youthSectorExceptionsKey(organizationId), includeResolved],
		queryFn: async (): Promise<OpenYouthSectorException[]> => {
			const result = await listYouthSectorExceptionsAction({
				includeAcknowledged: includeResolved,
			});
			if (!result.success) throw new Error(actionErrorMessage(t, result));
			return result.data;
		},
	});
	const findings = query.data ?? [];
	if (query.isLoading || (findings.length === 0 && !query.isError && !showWhenEmpty)) return null;

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
				) : findings.length === 0 ? (
					<div className="flex items-center gap-2 rounded-lg border border-dashed p-6 text-muted-foreground text-sm">
						<IconInfoCircle className="size-4" aria-hidden="true" />
						{t(
							"settings.contracts.reviews.youth.empty",
							"No youth protection finding needs a sector exception.",
						)}
					</div>
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
				invalidateStatutoryReviewViews(queryClient, organizationId),
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
		<li
			className={cn(
				"flex flex-col gap-3 p-3",
				invalidatedItemClassName(finding.acknowledgementStatus),
			)}
		>
			<div className="flex flex-wrap items-center gap-2">
				<span className="font-medium">{finding.employeeName}</span>
				<Badge variant="outline">{kindLabel(finding.findingKind, t)}</Badge>
				<span className="text-muted-foreground text-sm tabular-nums">
					{formatPlainDate(parsePlainDate(finding.periodStart), locale, "dateMedium")}
				</span>
				{finding.used?.unit === "minutes" ? (
					<span className="text-muted-foreground text-sm tabular-nums">
						{usedMinutesLabel(finding.findingKind, finding.used.value, t)}
					</span>
				) : null}
				{finding.acknowledgementStatus === "stale" ? (
					<Badge variant="outline" className="border-warning/60 text-warning">
						{t("settings.contracts.reviews.youth.stale", "Changed since last acknowledged")}
					</Badge>
				) : null}
				{finding.acknowledgementStatus === "current" ? (
					<Badge variant="secondary">
						{t("settings.contracts.reviews.youth.documented", "Sector exception recorded")}
					</Badge>
				) : null}
				<span className="text-muted-foreground text-xs">{finding.legalReference}</span>
			</div>
			{finding.acknowledgementStatus === "stale" ? <InvalidatedAcknowledgementNotice /> : null}
			<StatutoryAcknowledgementHistory
				organizationId={organizationId}
				subject={{
					employeeId: finding.employeeId,
					acknowledgementKind: "jarbschg_sector_exception",
					findingKind: finding.findingKind,
					subjectKey: finding.subjectKey,
				}}
				currentInputFingerprint={finding.inputFingerprint}
				currentStatus={finding.acknowledgementStatus}
			/>
			{finding.acknowledgementStatus === "current" ? null : open ? (
				<form
					className="grid gap-3 sm:grid-cols-2"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
					{finding.findingKind === "jarbschg_night_work" ? (
						// The acknowledgeable hours are the union of every § 14 permission for the minor's
						// age; which one applies, and that Abs. 4 does not exclude it, the admin confirms.
						<p className="text-muted-foreground text-sm sm:col-span-2">
							{t(
								"settings.contracts.reviews.youth.nightConfirms",
								"Recording this confirms that one of these § 14 JArbSchG permissions applies to this work: hospitality or fairgrounds until 22:00 (from 16, Abs. 2 Nr. 1); multi-shift operations until 23:00 (from 16, Abs. 2 Nr. 2), or from 05:30 or until 23:30 after notifying the supervisory authority (Abs. 5 S. 2); agriculture from 05:00 or until 21:00 (from 16, Abs. 2 Nr. 3); bakeries and pastry shops from 05:00 (from 16, Abs. 2 Nr. 4), or bakeries from 04:00 (from 17, Abs. 3); until 21:00 from 15 where the usual working time ends after 20:00 for transport reasons, after notifying the supervisory authority (Abs. 5 S. 1); from 05:00 from 15 in a workplace with extraordinary heat in the warm season (Abs. 6). It also confirms that § 14 Abs. 4 does not exclude it: no work after 20:00 under Abs. 2 Nr. 1–3 on the day before a vocational school day whose lessons start before 09:00; and that the minor is no longer subject to full-time compulsory schooling (§ 2 Abs. 3) or works during school holidays, at most four weeks a year (§ 5 Abs. 4); otherwise the rules for children apply and no exception does.",
							)}
						</p>
					) : null}
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
