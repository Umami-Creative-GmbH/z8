"use client";

import {
	IconCheck,
	IconLoader2,
	IconPlugConnected,
	IconTrash,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
	deleteWorkdayCredentialsAction,
	saveWorkdayConfigAction,
	saveWorkdayCredentialsAction,
	testWorkdayConnectionAction,
	type WorkdayConfigResult,
} from "@/app/[locale]/(app)/settings/payroll-export/actions";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import type { WorkdayConfig } from "@/lib/payroll-export";

interface WorkdayConfigFormProps {
	organizationId: string;
	initialConfig?: WorkdayConfigResult | null;
	onConfigSaved?: () => void;
}

const DEFAULT_CONFIG: WorkdayConfig = {
	instanceUrl: "",
	tenantId: "",
	employeeMatchStrategy: "employeeNumber",
	includeZeroHours: false,
	batchSize: 100,
	apiTimeoutMs: 30000,
};
type Translate = ReturnType<typeof useTranslate>["t"];
type RunTransition = (task: () => Promise<void>) => void;

export function WorkdayConfigForm({
	organizationId,
	initialConfig,
	onConfigSaved,
}: WorkdayConfigFormProps) {
	const { t } = useTranslate();
	const [isPending, startTransition] = useTransition();
	const [showCredentialsForm, setShowCredentialsForm] = useState(
		!initialConfig?.hasCredentials,
	);
	const [clientId, setClientId] = useState("");
	const [clientSecret, setClientSecret] = useState("");
	const run: RunTransition = (task) => startTransition(task);
	const saveCredentials = () => {
		if (!clientId || !clientSecret) {
			toast.error(
				t(
					"settings.payrollExport.workday.credentialsRequired",
					"Please enter both Client ID and Client Secret",
				),
			);
			return;
		}
		run(async () => {
			const result = await saveWorkdayCredentialsAction({
				organizationId,
				clientId,
				clientSecret,
			});
			if (!result.success) {
				toast.error(
					t(
						"settings.payrollExport.workday.credentialsSaveError",
						"Failed to save credentials",
					),
					{ description: result.error },
				);
				return;
			}
			toast.success(
				t(
					"settings.payrollExport.workday.credentialsSaved",
					"Credentials saved securely",
				),
			);
			setShowCredentialsForm(false);
			setClientId("");
			setClientSecret("");
			onConfigSaved?.();
		});
	};
	const deleteCredentials = () =>
		run(async () => {
			const result = await deleteWorkdayCredentialsAction(organizationId);
			if (result.success) {
				toast.success(
					t(
						"settings.payrollExport.workday.credentialsDeleted",
						"Credentials deleted",
					),
				);
				setShowCredentialsForm(true);
				onConfigSaved?.();
			} else
				toast.error(
					t(
						"settings.payrollExport.workday.credentialsDeleteError",
						"Failed to delete credentials",
					),
					{ description: result.error },
				);
		});
	const cancelCredentials = () => {
		setShowCredentialsForm(false);
		setClientId("");
		setClientSecret("");
	};

	return (
		<div className="space-y-6">
			<WorkdayCredentialsCard
				t={t}
				hasCredentials={Boolean(initialConfig?.hasCredentials)}
				showForm={showCredentialsForm}
				clientId={clientId}
				clientSecret={clientSecret}
				isPending={isPending}
				onClientIdChange={setClientId}
				onClientSecretChange={setClientSecret}
				onShowForm={() => setShowCredentialsForm(true)}
				onSave={saveCredentials}
				onCancel={cancelCredentials}
				onDelete={deleteCredentials}
			/>
			<WorkdaySettingsCard
				t={t}
				organizationId={organizationId}
				initialConfig={initialConfig}
				hasConfiguredCredentials={!showCredentialsForm}
				isPending={isPending}
				run={run}
				onConfigSaved={onConfigSaved}
			/>
		</div>
	);
}

function WorkdayCredentialsCard({
	t,
	hasCredentials,
	showForm,
	clientId,
	clientSecret,
	isPending,
	onClientIdChange,
	onClientSecretChange,
	onShowForm,
	onSave,
	onCancel,
	onDelete,
}: {
	t: Translate;
	hasCredentials: boolean;
	showForm: boolean;
	clientId: string;
	clientSecret: string;
	isPending: boolean;
	onClientIdChange: (value: string) => void;
	onClientSecretChange: (value: string) => void;
	onShowForm: () => void;
	onSave: () => void;
	onCancel: () => void;
	onDelete: () => void;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					{t(
						"settings.payrollExport.workday.credentialsTitle",
						"Workday API Credentials",
					)}
					{hasCredentials && !showForm ? (
						<Badge variant="secondary" className="gap-1">
							<IconCheck className="size-3" aria-hidden="true" />
							{t("settings.payrollExport.workday.connected", "Connected")}
						</Badge>
					) : null}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.payrollExport.workday.credentialsDescription",
						"Store OAuth credentials used for Workday API access",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{showForm ? (
					<>
						<CredentialInput
							id="clientId"
							label={t("settings.payrollExport.workday.clientId", "Client ID")}
							value={clientId}
							onChange={onClientIdChange}
							placeholder="workday-client-id"
						/>
						<CredentialInput
							id="clientSecret"
							type="password"
							label={t(
								"settings.payrollExport.workday.clientSecret",
								"Client Secret",
							)}
							value={clientSecret}
							onChange={onClientSecretChange}
							placeholder="********"
						/>
					</>
				) : (
					<div className="flex items-center justify-between rounded-lg border p-4">
						<div className="flex items-center gap-3">
							<IconPlugConnected
								className="size-5 text-green-600"
								aria-hidden="true"
							/>
							<div>
								<p className="font-medium">
									{t(
										"settings.payrollExport.workday.credentialsConfigured",
										"Credentials configured",
									)}
								</p>
								<p className="text-sm text-muted-foreground">
									{t(
										"settings.payrollExport.workday.credentialsSecure",
										"Stored securely in vault",
									)}
								</p>
							</div>
						</div>
						<div className="flex gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={onShowForm}
							>
								{t(
									"settings.payrollExport.workday.updateCredentials",
									"Update",
								)}
							</Button>
							<DeleteCredentialsButton t={t} onDelete={onDelete} />
						</div>
					</div>
				)}
			</CardContent>
			{showForm ? (
				<CardFooter className="flex gap-2">
					<Button
						type="button"
						onClick={onSave}
						disabled={isPending || !clientId || !clientSecret}
					>
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
								"settings.payrollExport.workday.saveCredentials",
								"Save Credentials",
							)
						)}
					</Button>
					{hasCredentials ? (
						<Button type="button" variant="ghost" onClick={onCancel}>
							{t("common.cancel", "Cancel")}
						</Button>
					) : null}
				</CardFooter>
			) : null}
		</Card>
	);
}

function CredentialInput({
	id,
	type = "text",
	label,
	value,
	onChange,
	placeholder,
}: {
	id: string;
	type?: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
}) {
	return (
		<div className="space-y-2">
			<Label htmlFor={id}>{label}</Label>
			<Input
				id={id}
				type={type}
				autoComplete={type === "password" ? "new-password" : "off"}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				placeholder={placeholder}
			/>
		</div>
	);
}

function DeleteCredentialsButton({
	t,
	onDelete,
}: {
	t: Translate;
	onDelete: () => void;
}) {
	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					aria-label={t(
						"settings.payrollExport.workday.deleteCredentials",
						"Delete credentials",
					)}
				>
					<IconTrash className="size-4 text-destructive" aria-hidden="true" />
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{t(
							"settings.payrollExport.workday.deleteCredentialsTitle",
							"Delete Workday credentials?",
						)}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{t(
							"settings.payrollExport.workday.deleteCredentialsDescription",
							"This removes stored Workday OAuth credentials for this organization.",
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
					<AlertDialogAction
						onClick={onDelete}
						className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
					>
						{t("common.delete", "Delete")}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function WorkdaySettingsCard({
	t,
	organizationId,
	initialConfig,
	hasConfiguredCredentials,
	isPending,
	run,
	onConfigSaved,
}: {
	t: Translate;
	organizationId: string;
	initialConfig?: WorkdayConfigResult | null;
	hasConfiguredCredentials: boolean;
	isPending: boolean;
	run: RunTransition;
	onConfigSaved?: () => void;
}) {
	const [isTesting, setIsTesting] = useState(false);
	const form = useForm({
		defaultValues: (initialConfig?.config ??
			DEFAULT_CONFIG) satisfies WorkdayConfig,
		onSubmit: async ({ value }) =>
			run(async () => {
				const result = await saveWorkdayConfigAction({
					organizationId,
					config: value,
				});
				if (result.success) {
					toast.success(
						t(
							"settings.payrollExport.workday.saveSuccess",
							"Configuration saved",
						),
					);
					onConfigSaved?.();
				} else
					toast.error(
						t(
							"settings.payrollExport.workday.saveError",
							"Failed to save configuration",
						),
						{ description: result.error },
					);
			}),
	});
	const testConnection = async () => {
		setIsTesting(true);
		const result = await testWorkdayConnectionAction({
			organizationId,
			config: form.state.values,
		}).catch(() => null);
		if (result?.success && result.data.success)
			toast.success(
				t(
					"settings.payrollExport.workday.connectionSuccess",
					"Successfully connected to Workday",
				),
			);
		else
			toast.error(
				t(
					"settings.payrollExport.workday.connectionFailed",
					"Connection test failed",
				),
				{
					description: result
						? result.success
							? result.data.error
							: result.error
						: undefined,
				},
			);
		setIsTesting(false);
	};
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t(
						"settings.payrollExport.workday.configTitle",
						"Workday Export Settings",
					)}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.payrollExport.workday.configDescription",
						"Configure how records are prepared and sent to Workday",
					)}
				</CardDescription>
			</CardHeader>
			<form className="flex flex-col gap-6" action={() => form.handleSubmit()}>
				<CardContent className="space-y-4">
					<form.Field name="instanceUrl">
						{(field) => (
							<TextField
								id="instanceUrl"
								type="url"
								autoComplete="url"
								placeholder="https://wd5-impl-services1.workday.com"
								label={t(
									"settings.payrollExport.workday.instanceUrl",
									"Instance URL",
								)}
								value={field.state.value}
								onChange={field.handleChange}
							/>
						)}
					</form.Field>
					<form.Field name="tenantId">
						{(field) => (
							<TextField
								id="tenantId"
								autoComplete="organization"
								placeholder="tenant_name"
								label={t(
									"settings.payrollExport.workday.tenantId",
									"Tenant ID",
								)}
								value={field.state.value}
								onChange={field.handleChange}
							/>
						)}
					</form.Field>
					<form.Field name="employeeMatchStrategy">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor="employeeMatchStrategy">
									{t(
										"settings.payrollExport.workday.employeeMatchStrategy",
										"Employee Matching",
									)}
								</Label>
								<Select
									value={field.state.value}
									onValueChange={(value) =>
										field.handleChange(value as "employeeNumber" | "email")
									}
								>
									<SelectTrigger id="employeeMatchStrategy">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="employeeNumber">
											{t(
												"settings.payrollExport.workday.matchByEmployeeNumber",
												"Employee Number (Recommended)",
											)}
										</SelectItem>
										<SelectItem value="email">
											{t(
												"settings.payrollExport.workday.matchByEmail",
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
							<NumberField
								id="batchSize"
								label={t(
									"settings.payrollExport.workday.batchSize",
									"Batch Size",
								)}
								value={field.state.value}
								min={1}
								max={500}
								fallback={100}
								onChange={field.handleChange}
							/>
						)}
					</form.Field>
					<form.Field name="apiTimeoutMs">
						{(field) => (
							<NumberField
								id="apiTimeoutMs"
								label={t(
									"settings.payrollExport.workday.apiTimeoutMs",
									"API Timeout (ms)",
								)}
								value={field.state.value}
								min={1000}
								step={1000}
								fallback={30000}
								onChange={field.handleChange}
							/>
						)}
					</form.Field>
					<form.Field name="includeZeroHours">
						{(field) => (
							<div className="flex items-center justify-between rounded-lg border p-4">
								<div className="space-y-0.5">
									<Label htmlFor="includeZeroHours" className="text-base">
										{t(
											"settings.payrollExport.workday.includeZeroHours",
											"Include Zero Hours",
										)}
									</Label>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.payrollExport.workday.includeZeroHoursDescription",
											"Include records with zero hours in exports",
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
				<CardFooter className="flex gap-2">
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
							t("settings.payrollExport.workday.save", "Save Settings")
						)}
					</Button>
					<Button
						type="button"
						variant="outline"
						onClick={testConnection}
						disabled={
							isTesting ||
							!hasConfiguredCredentials ||
							!form.state.values.instanceUrl ||
							!form.state.values.tenantId
						}
					>
						{isTesting ? (
							<>
								<IconLoader2
									className="mr-2 size-4 animate-spin"
									aria-hidden="true"
								/>
								{t("settings.payrollExport.workday.testing", "Testing...")}
							</>
						) : (
							<>
								<IconPlugConnected className="mr-2 size-4" aria-hidden="true" />
								{t(
									"settings.payrollExport.workday.testConnection",
									"Test Connection",
								)}
							</>
						)}
					</Button>
				</CardFooter>
			</form>
		</Card>
	);
}

function TextField({
	id,
	type = "text",
	autoComplete,
	placeholder,
	label,
	value,
	onChange,
}: {
	id: string;
	type?: string;
	autoComplete: string;
	placeholder: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<div className="space-y-2">
			<Label htmlFor={id}>{label}</Label>
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

function NumberField({
	id,
	label,
	value,
	min,
	max,
	step,
	fallback,
	onChange,
}: {
	id: string;
	label: string;
	value: number;
	min: number;
	max?: number;
	step?: number;
	fallback: number;
	onChange: (value: number) => void;
}) {
	return (
		<div className="space-y-2">
			<Label htmlFor={id}>{label}</Label>
			<Input
				id={id}
				type="number"
				autoComplete="off"
				min={min}
				max={max}
				step={step}
				value={value}
				onChange={(event) =>
					onChange(parseInt(event.target.value, 10) || fallback)
				}
			/>
		</div>
	);
}
