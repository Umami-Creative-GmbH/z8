"use client";

import { IconCalendar, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
	createVacationPolicy,
	updateVacationPolicy,
} from "@/app/[locale]/(app)/settings/vacation/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useRouter } from "@/navigation";

interface VacationPolicyFormProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	existingPolicy?: {
		id: string;
		name: string;
		startDate: string; // YYYY-MM-DD
		validUntil: string | null; // YYYY-MM-DD or null
		isCompanyDefault: boolean;
		defaultAnnualDays: string;
		accrualType: string;
		accrualStartMonth: number | null;
		allowCarryover: boolean;
		maxCarryoverDays: string | null;
		carryoverExpiryMonths: number | null;
	};
}

// Helper to format date string to Date object
const parseDate = (dateStr: string): Date => {
	const [year, month, day] = dateStr.split("-").map(Number);
	return new Date(year, month - 1, day);
};

// Helper to format Date to YYYY-MM-DD string
const formatDateStr = (date: Date): string => {
	return DateTime.fromJSDate(date).toFormat("yyyy-MM-dd");
};

// Get default start date (Jan 1 of next year)
const getDefaultStartDate = (): Date => {
	const now = new Date();
	return new Date(now.getFullYear() + 1, 0, 1);
};

export function VacationPolicyForm({
	open,
	onOpenChange,
	organizationId,
	existingPolicy,
}: VacationPolicyFormProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [loading, setLoading] = useState(false);
	const [startDateOpen, setStartDateOpen] = useState(false);
	const [validUntilOpen, setValidUntilOpen] = useState(false);

	const form = useForm({
		defaultValues: existingPolicy
			? {
					name: existingPolicy.name,
					startDate: parseDate(existingPolicy.startDate),
					validUntil: existingPolicy.validUntil
						? parseDate(existingPolicy.validUntil)
						: (null as Date | null),
					isCompanyDefault: existingPolicy.isCompanyDefault,
					defaultAnnualDays: existingPolicy.defaultAnnualDays,
					accrualType: existingPolicy.accrualType as "annual" | "monthly" | "biweekly",
					accrualStartMonth: existingPolicy.accrualStartMonth || 1,
					allowCarryover: existingPolicy.allowCarryover,
					maxCarryoverDays: existingPolicy.maxCarryoverDays || "",
					carryoverExpiryMonths:
						existingPolicy.carryoverExpiryMonths || (undefined as number | undefined),
				}
			: {
					name: "",
					startDate: getDefaultStartDate(),
					validUntil: null as Date | null,
					isCompanyDefault: false,
					defaultAnnualDays: "20",
					accrualType: "annual" as "annual" | "monthly" | "biweekly",
					accrualStartMonth: 1,
					allowCarryover: false,
					maxCarryoverDays: "",
					carryoverExpiryMonths: undefined as number | undefined,
				},
		onSubmit: async ({ value }) => {
			setLoading(true);

			try {
				const result = existingPolicy
					? await updateVacationPolicy(existingPolicy.id, {
							name: value.name,
							startDate: formatDateStr(value.startDate),
							validUntil: value.validUntil ? formatDateStr(value.validUntil) : undefined,
							isCompanyDefault: value.isCompanyDefault,
							defaultAnnualDays: value.defaultAnnualDays,
							accrualType: value.accrualType,
							accrualStartMonth: value.accrualStartMonth,
							allowCarryover: value.allowCarryover,
							maxCarryoverDays: value.maxCarryoverDays || undefined,
							carryoverExpiryMonths: value.carryoverExpiryMonths,
						})
					: await createVacationPolicy({
							organizationId,
							startDate: formatDateStr(value.startDate),
							validUntil: value.validUntil ? formatDateStr(value.validUntil) : undefined,
							isCompanyDefault: value.isCompanyDefault,
							name: value.name,
							defaultAnnualDays: value.defaultAnnualDays,
							accrualType: value.accrualType,
							accrualStartMonth: value.accrualStartMonth,
							allowCarryover: value.allowCarryover,
							maxCarryoverDays: value.maxCarryoverDays || undefined,
							carryoverExpiryMonths: value.carryoverExpiryMonths,
						});

				if (result.success) {
					toast.success(
						existingPolicy
							? t("settings.vacation.policyUpdated", "Policy updated successfully")
							: t("settings.vacation.policyCreated", "Policy created successfully"),
					);
					onOpenChange(false);
					router.refresh();
				} else {
					toast.error(result.error || t("settings.vacation.saveFailed", "Failed to save policy"));
				}
			} catch (_error) {
				toast.error(t("common.unexpectedError", "An unexpected error occurred"));
			}
			setLoading(false);
		},
	});

	// Subscribe to allowCarryover for conditional fields
	const allowCarryover = useStore(form.store, (state) => state.values.allowCarryover);

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{existingPolicy
							? t("settings.vacation.editPolicy", 'Edit "{name}"', { name: existingPolicy.name })
							: t("settings.vacation.createPolicy", "Create Vacation Policy")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.vacation.policyDescription",
							"Configure vacation allowance settings. Each policy can be assigned to the organization, specific teams, or individual employees.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
					className="flex min-h-0 flex-1 flex-col"
				>
					<ActionPanelBody className="space-y-6">
						<form.Field
							name="name"
							validators={{
								onChange: z
									.string()
									.min(
										1,
										t("settings.vacation.policyForm.policyNameRequired", "Policy name is required"),
									)
									.max(100, t("settings.vacation.policyForm.nameTooLong", "Name too long")),
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="policyName">
										{t("settings.vacation.policyForm.policyName", "Policy Name")}
									</Label>
									<Input
										id="policyName"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t(
											"settings.vacation.policyForm.policyNamePlaceholder",
											"e.g., Germany Standard, Senior Engineers",
										)}
									/>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.vacation.policyForm.policyNameDescription",
											"A descriptive name to identify this vacation policy",
										)}
									</p>
									{field.state.meta.errors.length > 0 && (
										<p className="text-sm text-destructive">
											{typeof field.state.meta.errors[0] === "string"
												? field.state.meta.errors[0]
												: (field.state.meta.errors[0] as any)?.message}
										</p>
									)}
								</div>
							)}
						</form.Field>

						<div className="grid grid-cols-2 gap-4">
							<form.Field name="startDate">
								{(field) => (
									<div className="space-y-2">
										<Label>
											{t("settings.vacation.policyForm.effectiveFrom", "Effective From")}
										</Label>
										<Popover open={startDateOpen} onOpenChange={setStartDateOpen}>
											<PopoverTrigger asChild>
												<Button
													variant="outline"
													className={cn(
														"w-full justify-start text-left font-normal",
														!field.state.value && "text-muted-foreground",
													)}
												>
													<IconCalendar className="mr-2 size-4" />
													{field.state.value ? (
														DateTime.fromJSDate(field.state.value).toLocaleString(DateTime.DATE_MED)
													) : (
														<span>{t("settings.vacation.policyForm.pickDate", "Pick a date")}</span>
													)}
												</Button>
											</PopoverTrigger>
											<PopoverContent className="w-auto p-0" align="start">
												<Calendar
													mode="single"
													selected={field.state.value}
													onSelect={(date) => {
														if (date) {
															field.handleChange(date);
															setStartDateOpen(false);
														}
													}}
													autoFocus
												/>
											</PopoverContent>
										</Popover>
										<p className="text-sm text-muted-foreground">
											{t(
												"settings.vacation.policyForm.effectiveFromDescription",
												"When this policy becomes effective",
											)}
										</p>
									</div>
								)}
							</form.Field>

							<form.Field name="validUntil">
								{(field) => (
									<div className="space-y-2">
										<Label>
											{t("settings.vacation.policyForm.validUntil", "Valid Until (optional)")}
										</Label>
										<Popover open={validUntilOpen} onOpenChange={setValidUntilOpen}>
											<PopoverTrigger asChild>
												<Button
													variant="outline"
													className={cn(
														"w-full justify-start text-left font-normal",
														!field.state.value && "text-muted-foreground",
													)}
												>
													<IconCalendar className="mr-2 size-4" />
													{field.state.value ? (
														DateTime.fromJSDate(field.state.value).toLocaleString(DateTime.DATE_MED)
													) : (
														<span>
															{t("settings.vacation.policyForm.noEndDate", "No end date")}
														</span>
													)}
												</Button>
											</PopoverTrigger>
											<PopoverContent className="w-auto p-0" align="start">
												<div className="p-2 border-b">
													<Button
														variant="ghost"
														size="sm"
														className="w-full"
														onClick={() => {
															field.handleChange(null);
															setValidUntilOpen(false);
														}}
													>
														{t("settings.vacation.policyForm.clearDate", "Clear date")}
													</Button>
												</div>
												<Calendar
													mode="single"
													selected={field.state.value || undefined}
													onSelect={(date) => {
														field.handleChange(date || null);
														setValidUntilOpen(false);
													}}
													autoFocus
												/>
											</PopoverContent>
										</Popover>
										<p className="text-sm text-muted-foreground">
											{t(
												"settings.vacation.policyForm.validUntilDescription",
												"Leave empty for ongoing policy",
											)}
										</p>
									</div>
								)}
							</form.Field>
						</div>

						<form.Field name="isCompanyDefault">
							{(field) => (
								<div className="flex flex-row items-start space-x-3 rounded-lg border p-4">
									<Checkbox
										id="isCompanyDefault"
										checked={field.state.value}
										onCheckedChange={(checked) => field.handleChange(checked === true)}
									/>
									<div className="space-y-1 leading-none">
										<Label htmlFor="isCompanyDefault" className="cursor-pointer">
											{t("settings.vacation.policyForm.companyDefault", "Set as Company Default")}
										</Label>
										<p className="text-sm text-muted-foreground">
											{t(
												"settings.vacation.policyForm.companyDefaultDescription",
												"This policy will apply to all employees without specific overrides. Setting this will supersede any existing company default.",
											)}
										</p>
									</div>
								</div>
							)}
						</form.Field>

						<form.Field
							name="defaultAnnualDays"
							validators={{
								onChange: z
									.string()
									.refine(
										(val) => val && !Number.isNaN(parseFloat(val)) && parseFloat(val) > 0,
										t("settings.vacation.policyForm.positiveNumber", "Must be a positive number"),
									),
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="defaultAnnualDays">
										{t("settings.vacation.policyForm.defaultAnnualDays", "Default Annual Days")}
									</Label>
									<Input
										id="defaultAnnualDays"
										type="number"
										step="0.5"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder="20"
									/>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.vacation.policyForm.defaultAnnualDaysDescription",
											"Default number of vacation days per year for all employees",
										)}
									</p>
									{field.state.meta.errors.length > 0 && (
										<p className="text-sm text-destructive">
											{typeof field.state.meta.errors[0] === "string"
												? field.state.meta.errors[0]
												: (field.state.meta.errors[0] as any)?.message}
										</p>
									)}
								</div>
							)}
						</form.Field>

						<form.Field name="accrualType">
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="accrualType">
										{t("settings.vacation.policyForm.accrualType", "Accrual Type")}
									</Label>
									<Select
										value={field.state.value}
										onValueChange={(value) =>
											field.handleChange(value as "annual" | "monthly" | "biweekly")
										}
									>
										<SelectTrigger id="accrualType">
											<SelectValue
												placeholder={t(
													"settings.vacation.policyForm.selectAccrualType",
													"Select accrual type",
												)}
											/>
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="annual">
												{t("settings.vacation.policyForm.accrualAnnual", "Annual (all at once)")}
											</SelectItem>
											<SelectItem value="monthly">
												{t("settings.vacation.policyForm.accrualMonthly", "Monthly accrual")}
											</SelectItem>
											<SelectItem value="biweekly">
												{t("settings.vacation.policyForm.accrualBiweekly", "Biweekly accrual")}
											</SelectItem>
										</SelectContent>
									</Select>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.vacation.policyForm.accrualTypeDescription",
											"How vacation days are granted throughout the year",
										)}
									</p>
								</div>
							)}
						</form.Field>

						<form.Field name="accrualStartMonth">
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="accrualStartMonth">
										{t("settings.vacation.policyForm.accrualStartMonth", "Accrual Start Month")}
									</Label>
									<Select
										value={field.state.value?.toString() || "1"}
										onValueChange={(val) => field.handleChange(parseInt(val, 10))}
									>
										<SelectTrigger id="accrualStartMonth">
											<SelectValue
												placeholder={t("settings.vacation.policyForm.selectMonth", "Select month")}
											/>
										</SelectTrigger>
										<SelectContent>
											{Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
												<SelectItem key={month} value={month.toString()}>
													{new Date(2000, month - 1).toLocaleString("default", {
														month: "long",
													})}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.vacation.policyForm.accrualStartMonthDescription",
											"Month when vacation accrual begins (typically January or hire date)",
										)}
									</p>
								</div>
							)}
						</form.Field>

						<form.Field name="allowCarryover">
							{(field) => (
								<div className="flex flex-row items-center justify-between rounded-lg border p-4">
									<div className="space-y-0.5">
										<Label className="text-base">
											{t("settings.vacation.policyForm.allowCarryover", "Allow Carryover")}
										</Label>
										<p className="text-sm text-muted-foreground">
											{t(
												"settings.vacation.policyForm.allowCarryoverDescription",
												"Allow employees to carry unused days to next year",
											)}
										</p>
									</div>
									<Switch checked={field.state.value} onCheckedChange={field.handleChange} />
								</div>
							)}
						</form.Field>

						{allowCarryover && (
							<>
								<form.Field name="maxCarryoverDays">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor="maxCarryoverDays">
												{t(
													"settings.vacation.policyForm.maxCarryoverDays",
													"Max Carryover Days (optional)",
												)}
											</Label>
											<Input
												id="maxCarryoverDays"
												type="number"
												step="0.5"
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
												placeholder={t(
													"settings.vacation.policyForm.unlimitedPlaceholder",
													"Leave empty for unlimited",
												)}
											/>
											<p className="text-sm text-muted-foreground">
												{t(
													"settings.vacation.policyForm.maxCarryoverDaysDescription",
													"Maximum days that can be carried over (leave empty for unlimited)",
												)}
											</p>
										</div>
									)}
								</form.Field>

								<form.Field name="carryoverExpiryMonths">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor="carryoverExpiryMonths">
												{t(
													"settings.vacation.policyForm.carryoverExpiryMonths",
													"Carryover Expiry (months, optional)",
												)}
											</Label>
											<Input
												id="carryoverExpiryMonths"
												type="number"
												min="1"
												max="12"
												value={field.state.value || ""}
												onChange={(e) =>
													field.handleChange(
														e.target.value ? parseInt(e.target.value, 10) : undefined,
													)
												}
												onBlur={field.handleBlur}
												placeholder={t(
													"settings.vacation.policyForm.expiryMonthsPlaceholder",
													"e.g., 3",
												)}
											/>
											<p className="text-sm text-muted-foreground">
												{t(
													"settings.vacation.policyForm.carryoverExpiryMonthsDescription",
													"Number of months before carried-over days expire (optional)",
												)}
											</p>
										</div>
									)}
								</form.Field>
							</>
						)}
					</ActionPanelBody>

					<ActionPanelFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={loading}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={loading}>
							{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
							{existingPolicy
								? t("settings.vacation.updatePolicy", "Update Policy")
								: t("settings.vacation.createPolicyBtn", "Create Policy")}
						</Button>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
