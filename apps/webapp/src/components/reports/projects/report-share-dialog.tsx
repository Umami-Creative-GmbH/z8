"use client";

import { IconCheck, IconCopy, IconLoader2, IconShare } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import { createReportShareLink } from "@/app/[locale]/(app)/reports/projects/share-actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TFormItem, TFormLabel } from "@/components/ui/tanstack-form";
import { formatPlainDateRange } from "@/lib/datetime/temporal-format";
import type { ShareTarget } from "@/lib/projects/report-share/report-share-links";
import {
	SHARE_LINK_DEFAULT_EXPIRY_DAYS,
	SHARE_LINK_MAX_EXPIRY_DAYS,
} from "@/lib/projects/report-share/share-link-expiry";
import type { ShareLinkFigures } from "@/lib/projects/report-share/shared-snapshot";
import { queryKeys } from "@/lib/query/keys";
import { ReportShareLinkList } from "./report-share-link-list";

const EXPIRY_CHOICES = [7, 14, SHARE_LINK_DEFAULT_EXPIRY_DAYS, 60, SHARE_LINK_MAX_EXPIRY_DAYS];

interface ShareFormValues {
	figures: ShareLinkFigures;
	includeEmployees: boolean;
	expiresInDays: string;
}

interface ReportShareDialogProps {
	target: ShareTarget;
	/** The project's or customer's name. */
	reportName: string;
	/** The report's period as calendar days (ISO dates). */
	period: { fromDay: string; toDay: string };
	/** The viewer sees revenue on this report, so they may share it. */
	canShareRevenue: boolean;
	/** The trigger's size, e.g. small inside a table row. */
	size?: "default" | "sm";
}

/**
 * The "Share" action of a project report or one customer's billable report
 * (#806): creates a report share link to a frozen snapshot and lists the
 * report's links. The full URL is shown once, right after creation.
 */
export function ReportShareDialog({
	target,
	reportName,
	period,
	canShareRevenue,
	size = "default",
}: ReportShareDialogProps) {
	const { t } = useTranslate();
	const locale = useLocale();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [createdUrl, setCreatedUrl] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const isProject = target.kind === "project";
	const periodLabel = formatPlainDateRange(
		Temporal.PlainDate.from(period.fromDay),
		Temporal.PlainDate.from(period.toDay),
		locale,
		"dateMedium",
	);

	const form = useForm({
		defaultValues: {
			figures: "hours",
			includeEmployees: false,
			expiresInDays: String(SHARE_LINK_DEFAULT_EXPIRY_DAYS),
		} as ShareFormValues,
		onSubmit: async ({ value }) => {
			const result = await createReportShareLink({
				...target,
				...period,
				figures: canShareRevenue ? value.figures : "hours",
				includeEmployees: isProject && value.includeEmployees,
				expiresInDays: Number(value.expiresInDays),
				locale,
			});
			if (!result.success) {
				toast.error(t("reports.share.create.failed", "The share link could not be created"), {
					description: result.error,
				});
				return;
			}
			setCopied(false);
			setCreatedUrl(`${window.location.origin}${result.data.path}`);
			await queryClient.invalidateQueries({ queryKey: queryKeys.reportShareLinks.all });
		},
	});

	async function copy() {
		if (!createdUrl) return;
		try {
			await navigator.clipboard.writeText(createdUrl);
			setCopied(true);
		} catch {
			toast.error(t("reports.share.created.copyFailed", "Copy the link by selecting it"));
		}
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) {
					// The URL is shown once; closing the dialog forgets it.
					setCreatedUrl(null);
					form.reset();
				}
			}}
		>
			<DialogTrigger asChild>
				<Button variant="outline" size={size}>
					<IconShare aria-hidden="true" className="size-4" />
					{t("reports.share.action", "Share")}
				</Button>
			</DialogTrigger>
			<DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>
						{t("reports.share.dialog.title", "Share {name}", { name: reportName })}
					</DialogTitle>
					<DialogDescription>
						{t(
							"reports.share.dialog.description",
							"Anyone with the link can view a read-only snapshot of this report for {period}, as it is now, until the link expires. Cost and margin are never shared.",
							{ period: periodLabel },
						)}
					</DialogDescription>
				</DialogHeader>

				{createdUrl ? (
					<section
						aria-labelledby="share-created-title"
						className="space-y-3 rounded-lg border p-4"
					>
						<h3 id="share-created-title" className="font-medium">
							{t("reports.share.created.title", "Your share link")}
						</h3>
						<p className="text-sm text-muted-foreground">
							{t(
								"reports.share.created.description",
								"Copy it now: it is shown only once. To share again later, create a new link.",
							)}
						</p>
						<div className="flex gap-2">
							<Input
								readOnly
								value={createdUrl}
								aria-label={t("reports.share.created.urlLabel", "Share link")}
								onFocus={(event) => event.currentTarget.select()}
								className="font-mono text-xs"
								spellCheck={false}
							/>
							<Button type="button" onClick={copy}>
								{copied ? (
									<IconCheck aria-hidden="true" className="size-4" />
								) : (
									<IconCopy aria-hidden="true" className="size-4" />
								)}
								{copied
									? t("reports.share.created.copied", "Copied")
									: t("reports.share.created.copy", "Copy")}
							</Button>
						</div>
						<Button type="button" variant="ghost" size="sm" onClick={() => setCreatedUrl(null)}>
							{t("reports.share.created.another", "Create another link")}
						</Button>
					</section>
				) : (
					<form
						className="space-y-4"
						onSubmit={(event) => {
							event.preventDefault();
							void form.handleSubmit();
						}}
					>
						<form.Field name="figures">
							{(field) => (
								<TFormItem>
									<TFormLabel>{t("reports.share.form.figures", "Figures")}</TFormLabel>
									<RadioGroup
										value={field.state.value}
										onValueChange={(value) => field.handleChange(value as ShareLinkFigures)}
										className="gap-2"
									>
										<div className="flex items-center gap-2">
											<RadioGroupItem id="share-figures-hours" value="hours" />
											<Label htmlFor="share-figures-hours" className="font-normal">
												{t("reports.share.figures.hours", "Hours only")}
											</Label>
										</div>
										<div className="flex items-center gap-2">
											<RadioGroupItem
												id="share-figures-revenue"
												value="revenue"
												disabled={!canShareRevenue}
											/>
											<Label htmlFor="share-figures-revenue" className="font-normal">
												{t("reports.share.figures.revenue", "Hours + revenue")}
											</Label>
										</div>
									</RadioGroup>
									{!canShareRevenue && (
										<p className="text-xs text-muted-foreground">
											{t(
												"reports.share.form.revenueUnavailable",
												"You don't see revenue on this report, so you can't share it.",
											)}
										</p>
									)}
								</TFormItem>
							)}
						</form.Field>

						{isProject && (
							<form.Field name="includeEmployees">
								{(field) => (
									<div className="flex items-start justify-between gap-4 rounded-lg border p-3">
										<div className="space-y-1">
											<Label htmlFor="share-include-employees">
												{t("reports.share.form.employees", "Employee breakdown")}
											</Label>
											<p className="text-xs text-muted-foreground">
												{t(
													"reports.share.form.employeesDescription",
													"Shows each employee's hours under their real name.",
												)}
											</p>
										</div>
										<Switch
											id="share-include-employees"
											checked={field.state.value}
											onCheckedChange={field.handleChange}
										/>
									</div>
								)}
							</form.Field>
						)}

						<form.Field name="expiresInDays">
							{(field) => (
								<TFormItem>
									<TFormLabel>{t("reports.share.form.expiry", "Expires after")}</TFormLabel>
									<Select value={field.state.value} onValueChange={field.handleChange}>
										<SelectTrigger className="w-full sm:w-56">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{EXPIRY_CHOICES.map((days) => (
												<SelectItem key={days} value={String(days)}>
													{t(
														"reports.share.form.expiryDays",
														"{days, plural, one {# day} other {# days}}",
														{
															days,
														},
													)}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</TFormItem>
							)}
						</form.Field>

						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<Button type="submit" disabled={isSubmitting}>
									{isSubmitting && (
										<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
									)}
									{t("reports.share.form.create", "Create link")}
								</Button>
							)}
						</form.Subscribe>
					</form>
				)}

				<section aria-labelledby="share-links-title" className="space-y-2">
					<h3 id="share-links-title" className="font-medium">
						{t("reports.share.list.title", "Links to this report")}
					</h3>
					<ReportShareLinkList target={target} />
				</section>
			</DialogContent>
		</Dialog>
	);
}
