"use client";

import { IconCheck, IconInfoCircle, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import Image from "next/image";
import { useTransition } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
	saveDatevConfigAction,
	type DatevConfigResult,
} from "@/app/[locale]/(app)/settings/payroll-export/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { DatevLohnConfig } from "@/lib/payroll-export/types";

interface DatevConfigFormProps {
	organizationId: string;
	initialConfig?: DatevConfigResult | null;
	onConfigSaved?: () => void;
}

const mandantennummerSchema = z
	.string()
	.min(1, "Client number is required")
	.regex(/^\d{1,5}$/, "Must be 1-5 digits");

const beraternummerSchema = z
	.string()
	.min(1, "Consultant number is required")
	.regex(/^\d{1,7}$/, "Must be 1-7 digits");

export function DatevConfigForm({
	organizationId,
	initialConfig,
	onConfigSaved,
}: DatevConfigFormProps) {
	const { t } = useTranslate();
	const [isPending, startTransition] = useTransition();

	const form = useForm({
		defaultValues: (initialConfig?.config ?? {
			mandantennummer: "",
			beraternummer: "",
			personnelNumberType: "employeeNumber" as const,
			includeZeroHours: false,
		}) satisfies DatevLohnConfig,
		onSubmit: async ({ value }) => {
			startTransition(async () => {
				const result = await saveDatevConfigAction({
					organizationId,
					config: value,
				});

				if (result.success) {
					toast.success(t("settings.payrollExport.datev.saveSuccess", "Configuration saved"));
					onConfigSaved?.();
				} else {
					toast.error(
						t("settings.payrollExport.datev.saveError", "Failed to save configuration"),
						{
							description: result.error,
						},
					);
				}
			});
		},
	});

	const formValues = useStore(form.store, (state) => state.values);
	const isValid =
		formValues.mandantennummer &&
		formValues.beraternummer &&
		/^\d{1,5}$/.test(formValues.mandantennummer) &&
		/^\d{1,7}$/.test(formValues.beraternummer);

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-4">
						<Image
							src="/datev.svg"
							alt="DATEV Logo"
							width={48}
							height={48}
							className="h-12 w-12 dark:invert"
						/>
						<div>
							<CardTitle className="flex items-center gap-2">
								{t("settings.payrollExport.datev.title", "DATEV Master Data")}
								{initialConfig && (
									<Badge variant="secondary" className="gap-1">
										<IconCheck className="h-3 w-3" aria-hidden="true" />
										{t("settings.payrollExport.datev.configured", "Configured")}
									</Badge>
								)}
							</CardTitle>
							<CardDescription>
								{t(
									"settings.payrollExport.datev.description",
									"Configure your DATEV Lohn & Gehalt connection details",
								)}
							</CardDescription>
						</div>
					</div>
				</div>
			</CardHeader>
			<form
				className="flex flex-col gap-6"
				onSubmit={(e) => {
					e.preventDefault();
					form.handleSubmit();
				}}
			>
				<CardContent className="space-y-4">
					<div className="grid gap-4 md:grid-cols-2">
						<form.Field
							name="mandantennummer"
							validators={{
								onChange: mandantennummerSchema,
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<div className="flex items-center gap-2">
										<Label htmlFor="mandantennummer">
											{t("settings.payrollExport.datev.mandantennummer", "Mandantennummer")}
										</Label>
										<TooltipProvider>
											<Tooltip>
												<TooltipTrigger asChild>
													<IconInfoCircle className="h-4 w-4 text-muted-foreground" />
												</TooltipTrigger>
												<TooltipContent>
													<p>
														{t(
															"settings.payrollExport.datev.mandantennummerTooltip",
															"Your DATEV client number (1-5 digits)",
														)}
													</p>
												</TooltipContent>
											</Tooltip>
										</TooltipProvider>
									</div>
									<Input
										id="mandantennummer"
										placeholder="12345"
										maxLength={5}
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
									/>
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

						<form.Field
							name="beraternummer"
							validators={{
								onChange: beraternummerSchema,
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<div className="flex items-center gap-2">
										<Label htmlFor="beraternummer">
											{t("settings.payrollExport.datev.beraternummer", "Beraternummer")}
										</Label>
										<TooltipProvider>
											<Tooltip>
												<TooltipTrigger asChild>
													<IconInfoCircle className="h-4 w-4 text-muted-foreground" />
												</TooltipTrigger>
												<TooltipContent>
													<p>
														{t(
															"settings.payrollExport.datev.beraternummerTooltip",
															"Your DATEV consultant number (1-7 digits)",
														)}
													</p>
												</TooltipContent>
											</Tooltip>
										</TooltipProvider>
									</div>
									<Input
										id="beraternummer"
										placeholder="1234567"
										maxLength={7}
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
									/>
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
					</div>

					<form.Field name="personnelNumberType">
						{(field) => (
							<div className="space-y-2">
								<div className="flex items-center gap-2">
									<Label htmlFor="personnelNumberType">
										{t(
											"settings.payrollExport.datev.personnelNumberType",
											"Personnel Number Type",
										)}
									</Label>
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger asChild>
												<IconInfoCircle className="h-4 w-4 text-muted-foreground" />
											</TooltipTrigger>
											<TooltipContent className="max-w-xs">
												<p>
													{t(
														"settings.payrollExport.datev.personnelNumberTypeTooltip",
														"Choose which field to use as the employee identifier in the export",
													)}
												</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</div>
								<Select
									value={field.state.value}
									onValueChange={(v) =>
										field.handleChange(v as "employeeNumber" | "employeeId")
									}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="employeeNumber">
											{t(
												"settings.payrollExport.datev.personnelNumberType.employeeNumber",
												"Employee Number (Recommended)",
											)}
										</SelectItem>
										<SelectItem value="employeeId">
											{t(
												"settings.payrollExport.datev.personnelNumberType.employeeId",
												"Internal Employee ID",
											)}
										</SelectItem>
									</SelectContent>
								</Select>
							</div>
						)}
					</form.Field>

					<form.Field name="includeZeroHours">
						{(field) => (
							<div className="flex items-center justify-between rounded-lg border p-4">
								<div className="space-y-0.5">
									<Label htmlFor="includeZeroHours" className="text-base">
										{t(
											"settings.payrollExport.datev.includeZeroHours",
											"Include Zero Hours",
										)}
									</Label>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.payrollExport.datev.includeZeroHoursDescription",
											"Include rows with 0 hours in the export",
										)}
									</p>
								</div>
								<Switch
									id="includeZeroHours"
									checked={field.state.value}
									onCheckedChange={field.handleChange}
								/>
							</div>
						)}
					</form.Field>
				</CardContent>
				<CardFooter>
					<Button type="submit" disabled={isPending || !isValid}>
						{isPending ? (
							<>
								<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
								{t("common.saving", "Saving…")}
							</>
						) : (
							t("settings.payrollExport.datev.save", "Save Configuration")
						)}
					</Button>
				</CardFooter>
			</form>
		</Card>
	);
}
