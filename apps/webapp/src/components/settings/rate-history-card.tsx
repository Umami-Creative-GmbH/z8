"use client";

import {
	IconCalendar,
	IconCircleDot,
	IconClock,
	IconCurrencyEuro,
	IconLoader2,
	IconPlus,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import type { RateHistoryEntry } from "@/app/[locale]/(app)/settings/employees/rate-actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
	ActionPanelTrigger,
} from "@/components/ui/action-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { CreateRateHistory } from "@/lib/validations/employee";
import { HourlyRateInput } from "./hourly-rate-input";

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function getCurrencyFormatter(currency: string) {
	const cachedFormatter = currencyFormatters.get(currency);
	if (cachedFormatter) {
		return cachedFormatter;
	}

	const formatter = Intl.NumberFormat(undefined, { style: "currency", currency });
	currencyFormatters.set(currency, formatter);
	return formatter;
}

interface RateHistoryCardProps {
	rateHistory: RateHistoryEntry[];
	isLoading?: boolean;
	isAdmin: boolean;
	onAddRate: (data: CreateRateHistory) => Promise<{ success: boolean; error?: string }>;
	isAddingRate?: boolean;
}

const defaultFormValues = {
	hourlyRate: "",
	effectiveFrom: "",
	reason: "",
};

export function RateHistoryCard({
	rateHistory,
	isLoading,
	isAdmin,
	onAddRate,
	isAddingRate,
}: RateHistoryCardProps) {
	const { t } = useTranslate();
	const [dialogOpen, setDialogOpen] = useState(false);

	const form = useForm({
		defaultValues: defaultFormValues,
		onSubmit: async ({ value }) => {
			const result = await onAddRate({
				hourlyRate: value.hourlyRate,
				currency: currentRate?.currency || "EUR",
				effectiveFrom: new Date(value.effectiveFrom),
				reason: value.reason || null,
			}).then(
				(response) => response,
				() => null,
			);

			if (!result) {
				toast.error(t("common.unexpectedError", "An unexpected error occurred"));
				return;
			}

			if (result.success) {
				toast.success(t("settings.rateHistory.updateSuccess", "Rate updated successfully"));
				setDialogOpen(false);
				form.reset();
			} else {
				toast.error(result.error || t("settings.rateHistory.updateError", "Failed to update rate"));
			}
		},
	});

	const formatDate = (date: Date | null | undefined) => {
		if (!date) return t("common.present", "Present");
		return new Date(date).toLocaleDateString(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
		});
	};

	const formatCurrency = (amount: string, currency: string) => {
		return getCurrencyFormatter(currency).format(parseFloat(amount));
	};

	const currentRate = rateHistory.find((r) => !r.effectiveTo);

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between">
				<div>
					<CardTitle className="flex items-center gap-2">
						<IconClock className="size-5" />
						{t("settings.rateHistory.title", "Rate History")}
					</CardTitle>
					<CardDescription>
						{t("settings.rateHistory.description", "Hourly rate changes over time")}
					</CardDescription>
				</div>
				{isAdmin && (
					<ActionPanel open={dialogOpen} onOpenChange={setDialogOpen}>
						<ActionPanelTrigger asChild>
							<Button size="sm">
								<IconPlus className="mr-2 size-4" />
								{t("settings.rateHistory.changeRate", "Change Rate")}
							</Button>
						</ActionPanelTrigger>
						<ActionPanelContent>
							<ActionPanelHeader>
								<ActionPanelTitle>
									{t("settings.rateHistory.updateTitle", "Update Hourly Rate")}
								</ActionPanelTitle>
								<ActionPanelDescription>
									{t(
										"settings.rateHistory.updateDescription",
										"Create a new rate entry. The current rate will be closed automatically.",
									)}
								</ActionPanelDescription>
							</ActionPanelHeader>
							<form
								onSubmit={(e) => {
									e.preventDefault();
									e.stopPropagation();
									form.handleSubmit();
								}}
								className="flex min-h-0 flex-1 flex-col"
							>
								<ActionPanelBody className="space-y-4">
									<form.Field name="hourlyRate">
										{(field) => (
											<TFormItem>
												<TFormLabel hasError={fieldHasError(field)}>
													{t("settings.rateHistory.newHourlyRate", "New Hourly Rate")}
												</TFormLabel>
												<TFormControl hasError={fieldHasError(field)}>
													<HourlyRateInput
														value={field.state.value}
														onChange={field.handleChange}
														onBlur={field.handleBlur}
														hasError={fieldHasError(field)}
														placeholder={currentRate?.hourlyRate || "0.00"}
													/>
												</TFormControl>
												{currentRate && (
													<TFormDescription>
														{t("settings.rateHistory.currentRate", "Current rate: {rate}", {
															rate: formatCurrency(currentRate.hourlyRate, currentRate.currency),
														})}
													</TFormDescription>
												)}
												<TFormMessage field={field} />
											</TFormItem>
										)}
									</form.Field>

									<form.Field name="effectiveFrom">
										{(field) => (
											<TFormItem>
												<TFormLabel hasError={fieldHasError(field)}>
													{t("settings.rateHistory.effectiveFrom", "Effective From")}
												</TFormLabel>
												<TFormControl hasError={fieldHasError(field)}>
													<DatePicker
														value={field.state.value}
														onChange={field.handleChange}
														onBlur={field.handleBlur}
													/>
												</TFormControl>
												<TFormDescription>
													{t(
														"settings.rateHistory.effectiveFromHelp",
														"When the new rate takes effect",
													)}
												</TFormDescription>
												<TFormMessage field={field} />
											</TFormItem>
										)}
									</form.Field>

									<form.Field name="reason">
										{(field) => (
											<TFormItem>
												<TFormLabel hasError={fieldHasError(field)}>
													{t("settings.rateHistory.reasonOptional", "Reason (Optional)")}
												</TFormLabel>
												<TFormControl hasError={fieldHasError(field)}>
													<Textarea
														value={field.state.value}
														onChange={(e) => field.handleChange(e.target.value)}
														onBlur={field.handleBlur}
														placeholder={t(
															"settings.rateHistory.reasonPlaceholder",
															"e.g., Annual review, Promotion, etc.",
														)}
														rows={2}
													/>
												</TFormControl>
												<TFormMessage field={field} />
											</TFormItem>
										)}
									</form.Field>
								</ActionPanelBody>

								<ActionPanelFooter>
									<Button
										type="button"
										variant="outline"
										onClick={() => setDialogOpen(false)}
										disabled={isAddingRate}
									>
										{t("common.cancel", "Cancel")}
									</Button>
									<Button type="submit" disabled={isAddingRate}>
										{isAddingRate && <IconLoader2 className="mr-2 size-4 animate-spin" />}
										{t("settings.rateHistory.updateRate", "Update Rate")}
									</Button>
								</ActionPanelFooter>
							</form>
						</ActionPanelContent>
					</ActionPanel>
				)}
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<div className="flex items-center justify-center p-4">
						<IconLoader2 className="size-6 animate-spin text-muted-foreground" />
					</div>
				) : rateHistory.length === 0 ? (
					<div className="text-center text-sm text-muted-foreground">
						{t("settings.rateHistory.empty", "No rate history available")}
					</div>
				) : (
					<div className="relative space-y-4 pl-6">
						{/* Timeline line */}
						<div className="absolute bottom-0 left-[11px] top-0 w-px bg-border" />

						{rateHistory.map((entry, _index) => {
							const isCurrent = !entry.effectiveTo;

							return (
								<div key={entry.id} className="relative flex items-start gap-4">
									{/* Timeline dot */}
									<div
										className={cn(
											"absolute left-[-13px] flex size-6 items-center justify-center rounded-full",
											isCurrent ? "bg-primary text-primary-foreground" : "bg-muted",
										)}
									>
										{isCurrent ? (
											<IconCircleDot className="size-4" />
										) : (
											<IconCurrencyEuro className="size-3 text-muted-foreground" />
										)}
									</div>

									{/* Content */}
									<div className="ml-4 flex-1 space-y-1">
										<div className="flex items-center gap-2">
											<span
												className={cn(
													"font-medium",
													isCurrent ? "text-primary" : "text-foreground",
												)}
											>
												{formatCurrency(entry.hourlyRate, entry.currency)}
											</span>
											{isCurrent && (
												<Badge variant="default">{t("common.current", "Current")}</Badge>
											)}
										</div>
										<div className="flex items-center gap-2 text-xs text-muted-foreground">
											<IconCalendar className="size-3" />
											<span>
												{formatDate(entry.effectiveFrom)} -{" "}
												{entry.effectiveTo
													? formatDate(entry.effectiveTo)
													: t("common.present", "Present")}
											</span>
										</div>
										{entry.reason && (
											<div className="text-xs text-muted-foreground">{entry.reason}</div>
										)}
									</div>
								</div>
							);
						})}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
