"use client";

import { IconCheck, IconInfoCircle, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import Image from "next/image";
import { useTransition } from "react";
import { toast } from "sonner";
import {
	saveLexwareConfigAction,
	type LexwareConfigResult,
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
import type { LexwareLohnConfig } from "@/lib/payroll-export/types";

interface LexwareConfigFormProps {
	organizationId: string;
	initialConfig?: LexwareConfigResult | null;
	onConfigSaved?: () => void;
}

const DEFAULT_CONFIG: LexwareLohnConfig = {
	personnelNumberType: "employeeNumber",
	includeZeroHours: false,
	includeStunden: true,
	includeStundensatz: false,
};

export function LexwareConfigForm({
	organizationId,
	initialConfig,
	onConfigSaved,
}: LexwareConfigFormProps) {
	const { t } = useTranslate();
	const [isPending, startTransition] = useTransition();

	const form = useForm({
		defaultValues: (initialConfig?.config ?? DEFAULT_CONFIG) satisfies LexwareLohnConfig,
		onSubmit: async ({ value }) => {
			startTransition(async () => {
				const result = await saveLexwareConfigAction({
					organizationId,
					config: value,
				});

				if (result.success) {
					toast.success(
						t("settings.payrollExport.lexware.saveSuccess", "Configuration saved"),
					);
					onConfigSaved?.();
				} else {
					toast.error(
						t(
							"settings.payrollExport.lexware.saveError",
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
							src="/lexware.svg"
							alt="Lexware Logo"
							width={48}
							height={48}
							className="h-12 w-12"
						/>
						<div>
							<CardTitle className="flex items-center gap-2">
								{t("settings.payrollExport.lexware.title", "Lexware lohn+gehalt")}
								{initialConfig && (
									<Badge variant="secondary" className="gap-1">
										<IconCheck className="h-3 w-3" aria-hidden="true" />
										{t("settings.payrollExport.lexware.configured", "Configured")}
									</Badge>
								)}
							</CardTitle>
							<CardDescription>
								{t(
									"settings.payrollExport.lexware.description",
									"Configure export settings for Lexware lohn+gehalt",
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
											"settings.payrollExport.lexware.personnelNumberType",
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
														"settings.payrollExport.lexware.personnelNumberTypeHelp",
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
														"settings.payrollExport.lexware.personnelNumberTypeTooltip",
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
												"settings.payrollExport.lexware.personnelNumberType.employeeNumber",
												"Employee Number (Recommended)",
											)}
										</SelectItem>
										<SelectItem value="employeeId">
											{t(
												"settings.payrollExport.lexware.personnelNumberType.employeeId",
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
											"settings.payrollExport.lexware.includeZeroHours",
											"Include Zero Hours",
										)}
									</Label>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.payrollExport.lexware.includeZeroHoursDescription",
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

					<form.Field name="includeStunden">
						{(field) => (
							<div className="flex items-center justify-between rounded-lg border p-4">
								<div className="space-y-0.5">
									<Label htmlFor="includeStunden" className="text-base">
										{t(
											"settings.payrollExport.lexware.includeStunden",
											"Include Hours Column",
										)}
									</Label>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.payrollExport.lexware.includeStundenDescription",
											"Add optional Stunden column to the export",
										)}
									</p>
								</div>
								<Switch
									id="includeStunden"
									checked={field.state.value}
									onCheckedChange={field.handleChange}
								/>
							</div>
						)}
					</form.Field>

					<form.Field name="includeStundensatz">
						{(field) => (
							<div className="flex items-center justify-between rounded-lg border p-4">
								<div className="space-y-0.5">
									<Label htmlFor="includeStundensatz" className="text-base">
										{t(
											"settings.payrollExport.lexware.includeStundensatz",
											"Include Hourly Rate Column",
										)}
									</Label>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.payrollExport.lexware.includeStundensatzDescription",
											"Add optional Stundensatz column to the export",
										)}
									</p>
								</div>
								<Switch
									id="includeStundensatz"
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
							t("settings.payrollExport.lexware.save", "Save Configuration")
						)}
					</Button>
				</CardFooter>
			</form>
		</Card>
	);
}
