"use client";

import { useState } from "react";
import {
	IconCalendar,
	IconCircleDot,
	IconClock,
	IconCurrencyEuro,
	IconLoader2,
	IconPlus,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
	fieldHasError,
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import type { RateHistoryEntry } from "@/app/[locale]/(app)/settings/employees/rate-actions";
import type { CreateRateHistory } from "@/lib/validations/employee";
import { cn } from "@/lib/utils";
import { HourlyRateInput } from "./hourly-rate-input";

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
	const [dialogOpen, setDialogOpen] = useState(false);

	const form = useForm({
		defaultValues: defaultFormValues,
		onSubmit: async ({ value }) => {
			try {
				const result = await onAddRate({
					hourlyRate: value.hourlyRate,
					currency: currentRate?.currency || "EUR",
					effectiveFrom: new Date(value.effectiveFrom),
					reason: value.reason || null,
				});

				if (result.success) {
					toast.success("Rate updated successfully");
					setDialogOpen(false);
					form.reset();
				} else {
					toast.error(result.error || "Failed to update rate");
				}
			} catch (_error) {
				toast.error("An unexpected error occurred");
			}
		},
	});

	const formatDate = (date: Date | null | undefined) => {
		if (!date) return "Present";
		return new Date(date).toLocaleDateString(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
		});
	};

	const formatCurrency = (amount: string, currency: string) => {
		return new Intl.NumberFormat(undefined, {
			style: "currency",
			currency: currency,
		}).format(parseFloat(amount));
	};

	const currentRate = rateHistory.find((r) => !r.effectiveTo);

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between">
				<div>
					<CardTitle className="flex items-center gap-2">
						<IconClock className="size-5" />
						Rate History
					</CardTitle>
					<CardDescription>Hourly rate changes over time</CardDescription>
				</div>
				{isAdmin && (
					<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
						<DialogTrigger asChild>
							<Button size="sm">
								<IconPlus className="mr-2 size-4" />
								Change Rate
							</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Update Hourly Rate</DialogTitle>
								<DialogDescription>
									Create a new rate entry. The current rate will be closed automatically.
								</DialogDescription>
							</DialogHeader>
							<form
								onSubmit={(e) => {
									e.preventDefault();
									e.stopPropagation();
									form.handleSubmit();
								}}
								className="space-y-4"
							>
								<form.Field name="hourlyRate">
									{(field) => (
										<TFormItem>
											<TFormLabel hasError={fieldHasError(field)}>New Hourly Rate</TFormLabel>
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
													Current rate:{" "}
													{formatCurrency(currentRate.hourlyRate, currentRate.currency)}
												</TFormDescription>
											)}
											<TFormMessage field={field} />
										</TFormItem>
									)}
								</form.Field>

								<form.Field name="effectiveFrom">
									{(field) => (
										<TFormItem>
											<TFormLabel hasError={fieldHasError(field)}>Effective From</TFormLabel>
											<TFormControl hasError={fieldHasError(field)}>
												<Input
													type="date"
													value={field.state.value}
													onChange={(e) => field.handleChange(e.target.value)}
													onBlur={field.handleBlur}
												/>
											</TFormControl>
											<TFormDescription>When the new rate takes effect</TFormDescription>
											<TFormMessage field={field} />
										</TFormItem>
									)}
								</form.Field>

								<form.Field name="reason">
									{(field) => (
										<TFormItem>
											<TFormLabel hasError={fieldHasError(field)}>Reason (Optional)</TFormLabel>
											<TFormControl hasError={fieldHasError(field)}>
												<Textarea
													value={field.state.value}
													onChange={(e) => field.handleChange(e.target.value)}
													onBlur={field.handleBlur}
													placeholder="e.g., Annual review, Promotion, etc."
													rows={2}
												/>
											</TFormControl>
											<TFormMessage field={field} />
										</TFormItem>
									)}
								</form.Field>

								<DialogFooter>
									<Button
										type="button"
										variant="outline"
										onClick={() => setDialogOpen(false)}
										disabled={isAddingRate}
									>
										Cancel
									</Button>
									<Button type="submit" disabled={isAddingRate}>
										{isAddingRate && <IconLoader2 className="mr-2 size-4 animate-spin" />}
										Update Rate
									</Button>
								</DialogFooter>
							</form>
						</DialogContent>
					</Dialog>
				)}
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<div className="flex items-center justify-center p-4">
						<IconLoader2 className="size-6 animate-spin text-muted-foreground" />
					</div>
				) : rateHistory.length === 0 ? (
					<div className="text-center text-sm text-muted-foreground">No rate history available</div>
				) : (
					<div className="relative space-y-4 pl-6">
						{/* Timeline line */}
						<div className="absolute bottom-0 left-[11px] top-0 w-px bg-border" />

						{rateHistory.map((entry, index) => {
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
									<div className="flex-1 space-y-1">
										<div className="flex items-center gap-2">
											<span
												className={cn(
													"font-medium",
													isCurrent ? "text-primary" : "text-foreground",
												)}
											>
												{formatCurrency(entry.hourlyRate, entry.currency)}
											</span>
											{isCurrent && <Badge variant="default">Current</Badge>}
										</div>
										<div className="flex items-center gap-2 text-xs text-muted-foreground">
											<IconCalendar className="size-3" />
											<span>
												{formatDate(entry.effectiveFrom)} -{" "}
												{entry.effectiveTo ? formatDate(entry.effectiveTo) : "Present"}
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
