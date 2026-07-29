"use client";

import {
	IconCheck,
	IconInfoCircle,
	IconLoader2,
	IconPlugConnected,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import Image from "next/image";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
	type SuccessFactorsConfigResult,
	saveSuccessFactorsConfigAction,
	testSuccessFactorsConnectionAction,
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
type Translate = ReturnType<typeof useTranslate>["t"];

export function SuccessFactorsConfigForm(props: SuccessFactorsConfigFormProps) {
	const { t } = useTranslate();
	return <SuccessFactorsSettingsView {...props} t={t} />;
}

function SuccessFactorsSettingsView({
	organizationId,
	initialConfig,
	onConfigSaved,
	t,
}: SuccessFactorsConfigFormProps & { t: Translate }) {
	const [isPending, startTransition] = useTransition();
	const [isTestingConnection, setIsTestingConnection] = useState(false);
	const form = useForm({
		defaultValues: (initialConfig?.config ??
			DEFAULT_CONFIG) satisfies SuccessFactorsConfig,
		onSubmit: async ({ value }) =>
			startTransition(async () => {
				const result = await saveSuccessFactorsConfigAction({
					organizationId,
					config: value,
				});
				if (result.success) {
					toast.success(
						t(
							"settings.payrollExport.successfactors.saveSuccess",
							"Configuration saved",
						),
					);
					onConfigSaved?.();
				} else
					toast.error(
						t(
							"settings.payrollExport.successfactors.saveError",
							"Failed to save configuration",
						),
						{ description: result.error },
					);
			}),
	});
	const testConnection = async () => {
		setIsTestingConnection(true);
		const result = await testSuccessFactorsConnectionAction({
			organizationId,
			config: form.state.values,
		}).then(
			(response) => response,
			() => null,
		);
		if (result?.success && result.data?.success)
			toast.success(
				t(
					"settings.payrollExport.successfactors.connectionSuccess",
					"Connection successful",
				),
			);
		else {
			const description = result?.success ? result.data?.error : result?.error;
			toast.error(
				t(
					"settings.payrollExport.successfactors.connectionFailed",
					"Connection failed",
				),
				{ description },
			);
		}
		setIsTestingConnection(false);
	};

	return (
		<Card>
			<SuccessFactorsHeader configured={Boolean(initialConfig)} t={t} />
			<form className="flex flex-col gap-6" action={() => form.handleSubmit()}>
				<CardContent className="space-y-4">
					<form.Field name="instanceUrl">
						{(field) => (
							<HelpInput
								id="instanceUrl"
								type="url"
								autoComplete="url"
								placeholder="https://api.successfactors.com"
								label={t(
									"settings.payrollExport.successfactors.instanceUrl",
									"Instance URL",
								)}
								helpLabel={t(
									"settings.payrollExport.successfactors.instanceUrlHelp",
									"Instance URL help",
								)}
								help={t(
									"settings.payrollExport.successfactors.instanceUrlTooltip",
									"Your SAP SuccessFactors API endpoint URL (e.g., https://api.successfactors.com)",
								)}
								value={field.state.value}
								onChange={field.handleChange}
							/>
						)}
					</form.Field>
					<form.Field name="companyId">
						{(field) => (
							<HelpInput
								id="companyId"
								autoComplete="organization"
								placeholder="COMPANY_ID"
								label={t(
									"settings.payrollExport.successfactors.companyId",
									"Company ID",
								)}
								helpLabel={t(
									"settings.payrollExport.successfactors.companyIdHelp",
									"Company ID help",
								)}
								help={t(
									"settings.payrollExport.successfactors.companyIdTooltip",
									"Your SAP SuccessFactors company identifier",
								)}
								value={field.state.value}
								onChange={field.handleChange}
							/>
						)}
					</form.Field>
					<form.Field name="employeeMatchStrategy">
						{(field) => (
							<div className="space-y-2">
								<HelpLabel
									htmlFor="employeeMatchStrategy"
									label={t(
										"settings.payrollExport.successfactors.employeeMatchStrategy",
										"Employee Matching",
									)}
									helpLabel={t(
										"settings.payrollExport.successfactors.employeeMatchStrategyHelp",
										"Employee matching help",
									)}
									help={t(
										"settings.payrollExport.successfactors.employeeMatchStrategyTooltip",
										"How to match local employees to SAP SuccessFactors users",
									)}
								/>
								<Select
									value={field.state.value}
									onValueChange={(value) =>
										field.handleChange(
											value as "userId" | "personIdExternal" | "email",
										)
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
								<HelpLabel
									htmlFor="batchSize"
									label={t(
										"settings.payrollExport.successfactors.batchSize",
										"Batch Size",
									)}
									helpLabel={t(
										"settings.payrollExport.successfactors.batchSizeHelp",
										"Batch size help",
									)}
									help={t(
										"settings.payrollExport.successfactors.batchSizeTooltip",
										"Number of records per API request (1-100). Lower values are safer but slower.",
									)}
								/>
								<Input
									id="batchSize"
									type="number"
									autoComplete="off"
									min={1}
									max={100}
									value={field.state.value}
									onChange={(event) =>
										field.handleChange(parseInt(event.target.value, 10) || 100)
									}
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
							onClick={testConnection}
							disabled={
								isTestingConnection ||
								!form.state.values.instanceUrl ||
								!form.state.values.companyId
							}
						>
							{isTestingConnection ? (
								<>
									<IconLoader2
										className="mr-2 size-4 animate-spin"
										aria-hidden="true"
									/>
									{t(
										"settings.payrollExport.successfactors.testingConnection",
										"Testing...",
									)}
								</>
							) : (
								<>
									<IconPlugConnected
										className="mr-2 size-4"
										aria-hidden="true"
									/>
									{t(
										"settings.payrollExport.successfactors.testConnection",
										"Test Connection",
									)}
								</>
							)}
						</Button>
					</div>
				</CardContent>
				<CardFooter>
					<Button type="submit" disabled={isPending}>
						{isPending ? (
							<>
								<IconLoader2
									className="mr-2 size-4 animate-spin"
									aria-hidden="true"
								/>
								{t("common.saving", "Saving...")}
							</>
						) : (
							t(
								"settings.payrollExport.successfactors.save",
								"Save Configuration",
							)
						)}
					</Button>
				</CardFooter>
			</form>
		</Card>
	);
}

function SuccessFactorsHeader({
	configured,
	t,
}: {
	configured: boolean;
	t: Translate;
}) {
	return (
		<CardHeader>
			<div className="flex items-center gap-4">
				<Image
					src="/successfactors.svg"
					alt="SAP SuccessFactors Logo"
					width={48}
					height={48}
					className="size-12"
				/>
				<div>
					<CardTitle className="flex items-center gap-2">
						{t(
							"settings.payrollExport.successfactors.title",
							"SAP SuccessFactors",
						)}
						{configured ? (
							<Badge variant="secondary" className="gap-1">
								<IconCheck className="size-3" aria-hidden="true" />
								{t(
									"settings.payrollExport.successfactors.configured",
									"Configured",
								)}
							</Badge>
						) : null}
					</CardTitle>
					<CardDescription>
						{t(
							"settings.payrollExport.successfactors.description",
							"Configure export settings for SAP SuccessFactors Employee Central",
						)}
					</CardDescription>
				</div>
			</div>
		</CardHeader>
	);
}

function HelpInput({
	id,
	type = "text",
	autoComplete,
	placeholder,
	label,
	helpLabel,
	help,
	value,
	onChange,
}: {
	id: string;
	type?: string;
	autoComplete: string;
	placeholder: string;
	label: string;
	helpLabel: string;
	help: string;
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<div className="space-y-2">
			<HelpLabel htmlFor={id} label={label} helpLabel={helpLabel} help={help} />
			<Input
				id={id}
				type={type}
				autoComplete={autoComplete}
				placeholder={placeholder}
				value={value}
				onChange={(event) => onChange(event.target.value)}
			/>
		</div>
	);
}

function HelpLabel({
	htmlFor,
	label,
	helpLabel,
	help,
}: {
	htmlFor: string;
	label: string;
	helpLabel: string;
	help: string;
}) {
	return (
		<div className="flex items-center gap-2">
			<Label htmlFor={htmlFor}>{label}</Label>
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							className="inline-flex cursor-help"
							aria-label={helpLabel}
						>
							<IconInfoCircle
								className="size-4 text-muted-foreground"
								aria-hidden="true"
							/>
						</button>
					</TooltipTrigger>
					<TooltipContent className="max-w-xs">
						<p>{help}</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		</div>
	);
}
