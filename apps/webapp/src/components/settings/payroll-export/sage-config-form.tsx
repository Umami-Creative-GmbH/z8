"use client";

import { IconCheck, IconInfoCircle, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import Image from "next/image";
import { useTransition } from "react";
import { toast } from "sonner";
import {
	type SageConfigResult,
	saveSageConfigAction,
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
import type { SageLohnConfig } from "@/lib/payroll-export/types";

interface SageConfigFormProps {
	organizationId: string;
	initialConfig?: SageConfigResult | null;
	onConfigSaved?: () => void;
}

const DEFAULT_CONFIG: SageLohnConfig = {
	personnelNumberType: "employeeNumber",
	includeZeroHours: false,
	outputFormat: "sage_native",
};

export function SageConfigForm({
	organizationId,
	initialConfig,
	onConfigSaved,
}: SageConfigFormProps) {
	const { t } = useTranslate();
	const [isPending, startTransition] = useTransition();

	const form = useForm({
		defaultValues: (initialConfig?.config ??
			DEFAULT_CONFIG) satisfies SageLohnConfig,
		onSubmit: async ({ value }) => {
			startTransition(async () => {
				const result = await saveSageConfigAction({
					organizationId,
					config: value,
				});

				if (result.success) {
					toast.success(
						t("settings.payrollExport.sage.saveSuccess", "Configuration saved"),
					);
					onConfigSaved?.();
				} else {
					toast.error(
						t(
							"settings.payrollExport.sage.saveError",
							"Failed to save configuration",
						),
						{
							description: result.error,
						},
					);
				}
			});
		},
	});

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-4">
						<Image
							src="/sage.png"
							alt="Sage Logo"
							width={48}
							height={48}
							className="h-12 w-12"
						/>
						<div>
							<CardTitle className="flex items-center gap-2">
								{t("settings.payrollExport.sage.title", "Sage Lohn")}
								{initialConfig && (
									<Badge variant="secondary" className="gap-1">
										<IconCheck className="h-3 w-3" aria-hidden="true" />
										{t("settings.payrollExport.sage.configured", "Configured")}
									</Badge>
								)}
							</CardTitle>
							<CardDescription>
								{t(
									"settings.payrollExport.sage.description",
									"Configure export settings for Sage Lohn",
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
					<form.Field name="personnelNumberType">
						{(field) => (
							<div className="space-y-2">
								<div className="flex items-center gap-2">
									<Label htmlFor="personnelNumberType">
										{t(
											"settings.payrollExport.sage.personnelNumberType",
											"Personnel Number Type",
										)}
									</Label>
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger asChild>
												<button
													type="button"
													className="inline-flex cursor-help"
													aria-label={t(
														"settings.payrollExport.sage.personnelNumberTypeHelp",
														"Personnel number type help",
													)}
												>
													<IconInfoCircle
														className="h-4 w-4 text-muted-foreground"
														aria-hidden="true"
													/>
												</button>
											</TooltipTrigger>
											<TooltipContent className="max-w-xs">
												<p>
													{t(
														"settings.payrollExport.sage.personnelNumberTypeTooltip",
														"Choose which field to use as Personalnummer in the export",
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
												"settings.payrollExport.sage.personnelNumberType.employeeNumber",
												"Employee Number (Recommended)",
											)}
										</SelectItem>
										<SelectItem value="employeeId">
											{t(
												"settings.payrollExport.sage.personnelNumberType.employeeId",
												"Internal Employee ID",
											)}
										</SelectItem>
									</SelectContent>
								</Select>
							</div>
						)}
					</form.Field>

					<form.Field name="outputFormat">
						{(field) => (
							<div className="space-y-2">
								<div className="flex items-center gap-2">
									<Label htmlFor="outputFormat">
										{t(
											"settings.payrollExport.sage.outputFormat",
											"Output Format",
										)}
									</Label>
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger asChild>
												<button
													type="button"
													className="inline-flex cursor-help"
													aria-label={t(
														"settings.payrollExport.sage.outputFormatHelp",
														"Output format help",
													)}
												>
													<IconInfoCircle
														className="h-4 w-4 text-muted-foreground"
														aria-hidden="true"
													/>
												</button>
											</TooltipTrigger>
											<TooltipContent className="max-w-xs">
												<p>
													{t(
														"settings.payrollExport.sage.outputFormatTooltip",
														"Choose the CSV format style. DATEV-compatible uses period as decimal separator, Sage-native uses comma.",
													)}
												</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</div>
								<Select
									value={field.state.value}
									onValueChange={(v) =>
										field.handleChange(v as "datev_compatible" | "sage_native")
									}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="sage_native">
											{t(
												"settings.payrollExport.sage.outputFormat.sageNative",
												"Sage Native (Recommended)",
											)}
										</SelectItem>
										<SelectItem value="datev_compatible">
											{t(
												"settings.payrollExport.sage.outputFormat.datevCompatible",
												"DATEV-Compatible",
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
											"settings.payrollExport.sage.includeZeroHours",
											"Include Zero Hours",
										)}
									</Label>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.payrollExport.sage.includeZeroHoursDescription",
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
					<Button type="submit" disabled={isPending}>
						{isPending ? (
							<>
								<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
								{t("common.saving", "Saving…")}
							</>
						) : (
							t("settings.payrollExport.sage.save", "Save Configuration")
						)}
					</Button>
				</CardFooter>
			</form>
		</Card>
	);
}
