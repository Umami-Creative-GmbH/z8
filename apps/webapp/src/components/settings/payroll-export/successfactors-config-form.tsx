"use client";

import { IconCheck, IconInfoCircle, IconLoader2, IconPlugConnected } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import Image from "next/image";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
	saveSuccessFactorsConfigAction,
	testSuccessFactorsConnectionAction,
	type SuccessFactorsConfigResult,
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
import type { SuccessFactorsConfig } from "@/lib/payroll-export/types";

interface SuccessFactorsConfigFormProps {
	organizationId: string;
	initialConfig?: SuccessFactorsConfigResult | null;
	onConfigSaved?: () => void;
}

const DEFAULT_CONFIG: SuccessFactorsConfig = {
	employeeMatchStrategy: "userId",
	instanceUrl: "",
	companyId: "",
	includeZeroHours: false,
	batchSize: 100,
	apiTimeoutMs: 60000,
};

export function SuccessFactorsConfigForm({
	organizationId,
	initialConfig,
	onConfigSaved,
}: SuccessFactorsConfigFormProps) {
	const { t } = useTranslate();
	const [isPending, startTransition] = useTransition();
	const [isTestingConnection, setIsTestingConnection] = useState(false);

	const form = useForm({
		defaultValues: (initialConfig?.config ?? DEFAULT_CONFIG) satisfies SuccessFactorsConfig,
		onSubmit: async ({ value }) => {
			startTransition(async () => {
				const result = await saveSuccessFactorsConfigAction({
					organizationId,
					config: value,
				});

				if (result.success) {
					toast.success(
						t("settings.payrollExport.successfactors.saveSuccess", "Configuration saved"),
					);
					onConfigSaved?.();
				} else {
					toast.error(
						t(
							"settings.payrollExport.successfactors.saveError",
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

	const handleTestConnection = async () => {
		setIsTestingConnection(true);
		const result = await testSuccessFactorsConnectionAction({
			organizationId,
			config: form.state.values,
		}).then((response) => response, () => null);

		if (!result) {
			toast.error(
				t("settings.payrollExport.successfactors.connectionFailed", "Connection failed"),
			);
			setIsTestingConnection(false);
			return;
		}

		if (result.success && result.data && result.data.success) {
			toast.success(
				t("settings.payrollExport.successfactors.connectionSuccess", "Connection successful"),
			);
		} else {
			const errorMessage = result.success && result.data
				? result.data.error
				: result.success === false
					? result.error
					: undefined;
			toast.error(t("settings.payrollExport.successfactors.connectionFailed", "Connection failed"), {
				description: errorMessage,
			});
		}

		setIsTestingConnection(false);
	};

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-4">
						<Image
							src="/successfactors.svg"
							alt="SAP SuccessFactors Logo"
							width={48}
							height={48}
							className="h-12 w-12"
						/>
						<div>
							<CardTitle className="flex items-center gap-2">
								{t("settings.payrollExport.successfactors.title", "SAP SuccessFactors")}
								{initialConfig && (
									<Badge variant="secondary" className="gap-1">
										<IconCheck className="h-3 w-3" aria-hidden="true" />
										{t("settings.payrollExport.successfactors.configured", "Configured")}
									</Badge>
								)}
							</CardTitle>
							<CardDescription>
								{t(
									"settings.payrollExport.successfactors.description",
									"Configure export settings for SAP SuccessFactors Employee Central",
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
					<form.Field name="instanceUrl">
						{(field) => (
							<div className="space-y-2">
								<div className="flex items-center gap-2">
									<Label htmlFor="instanceUrl">
										{t(
											"settings.payrollExport.successfactors.instanceUrl",
											"Instance URL",
										)}
									</Label>
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger asChild>
												<button
													type="button"
													className="inline-flex cursor-help"
													aria-label={t(
														"settings.payrollExport.successfactors.instanceUrlHelp",
														"Instance URL help",
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
														"settings.payrollExport.successfactors.instanceUrlTooltip",
														"Your SAP SuccessFactors API endpoint URL (e.g., https://api.successfactors.com)",
													)}
												</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</div>
								<Input
									id="instanceUrl"
									type="url"
									autoComplete="url"
									placeholder="https://api.successfactors.com"
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
								/>
							</div>
						)}
					</form.Field>

					<form.Field name="companyId">
						{(field) => (
							<div className="space-y-2">
								<div className="flex items-center gap-2">
									<Label htmlFor="companyId">
										{t(
											"settings.payrollExport.successfactors.companyId",
											"Company ID",
										)}
									</Label>
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger asChild>
												<button
													type="button"
													className="inline-flex cursor-help"
													aria-label={t(
														"settings.payrollExport.successfactors.companyIdHelp",
														"Company ID help",
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
														"settings.payrollExport.successfactors.companyIdTooltip",
														"Your SAP SuccessFactors company identifier",
													)}
												</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</div>
								<Input
									id="companyId"
									type="text"
									autoComplete="organization"
									placeholder="COMPANY_ID"
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
								/>
							</div>
						)}
					</form.Field>

					<form.Field name="employeeMatchStrategy">
						{(field) => (
							<div className="space-y-2">
								<div className="flex items-center gap-2">
									<Label htmlFor="employeeMatchStrategy">
										{t(
											"settings.payrollExport.successfactors.employeeMatchStrategy",
											"Employee Matching",
										)}
									</Label>
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger asChild>
												<button
													type="button"
													className="inline-flex cursor-help"
													aria-label={t(
														"settings.payrollExport.successfactors.employeeMatchStrategyHelp",
														"Employee matching help",
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
														"settings.payrollExport.successfactors.employeeMatchStrategyTooltip",
														"How to match local employees to SAP SuccessFactors users",
													)}
												</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</div>
								<Select
									value={field.state.value}
									onValueChange={(v) =>
										field.handleChange(v as "userId" | "personIdExternal" | "email")
									}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="userId">
											{t(
												"settings.payrollExport.successfactors.matchStrategy.userId",
												"User ID (Recommended)",
											)}
										</SelectItem>
										<SelectItem value="personIdExternal">
											{t(
												"settings.payrollExport.successfactors.matchStrategy.personIdExternal",
												"Person ID External",
											)}
										</SelectItem>
										<SelectItem value="email">
											{t(
												"settings.payrollExport.successfactors.matchStrategy.email",
												"Email Address",
											)}
										</SelectItem>
									</SelectContent>
								</Select>
							</div>
						)}
					</form.Field>

					<form.Field name="batchSize">
						{(field) => (
							<div className="space-y-2">
								<div className="flex items-center gap-2">
									<Label htmlFor="batchSize">
										{t(
											"settings.payrollExport.successfactors.batchSize",
											"Batch Size",
										)}
									</Label>
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger asChild>
												<button
													type="button"
													className="inline-flex cursor-help"
													aria-label={t(
														"settings.payrollExport.successfactors.batchSizeHelp",
														"Batch size help",
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
														"settings.payrollExport.successfactors.batchSizeTooltip",
														"Number of records per API request (1-100). Lower values are safer but slower.",
													)}
												</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</div>
								<Input
									id="batchSize"
									type="number"
									autoComplete="off"
									min={1}
									max={100}
									value={field.state.value}
									onChange={(e) => field.handleChange(parseInt(e.target.value, 10) || 100)}
								/>
							</div>
						)}
					</form.Field>

					<form.Field name="includeZeroHours">
						{(field) => (
							<div className="flex items-center justify-between rounded-lg border p-4">
								<div className="space-y-0.5">
									<Label htmlFor="includeZeroHours" className="text-base">
										{t(
											"settings.payrollExport.successfactors.includeZeroHours",
											"Include Zero Hours",
										)}
									</Label>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.payrollExport.successfactors.includeZeroHoursDescription",
											"Include records with 0 hours in the export",
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

					<div className="pt-2">
						<Button
							type="button"
							variant="outline"
							onClick={handleTestConnection}
							disabled={isTestingConnection || !form.state.values.instanceUrl || !form.state.values.companyId}
						>
							{isTestingConnection ? (
								<>
									<IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
									{t("settings.payrollExport.successfactors.testingConnection", "Testing...")}
								</>
							) : (
								<>
									<IconPlugConnected className="mr-2 h-4 w-4" aria-hidden="true" />
									{t("settings.payrollExport.successfactors.testConnection", "Test Connection")}
								</>
							)}
						</Button>
					</div>
				</CardContent>
				<CardFooter>
					<Button type="submit" disabled={isPending}>
						{isPending ? (
							<>
								<IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
								{t("common.saving", "Saving...")}
							</>
						) : (
							t("settings.payrollExport.successfactors.save", "Save Configuration")
						)}
					</Button>
				</CardFooter>
			</form>
		</Card>
	);
}
