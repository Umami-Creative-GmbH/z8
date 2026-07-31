"use client";

import {
	IconCheck,
	IconInfoCircle,
	IconLoader2,
	IconPlugConnected,
	IconTrash,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import Image from "next/image";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
	deletePersonioCredentialsAction,
	type PersonioConfigResult,
	savePersonioConfigAction,
	savePersonioCredentialsAction,
	testPersonioConnectionAction,
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
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { PersonioConfig } from "@/lib/payroll-export";

interface PersonioConfigFormProps {
	organizationId: string;
	initialConfig?: PersonioConfigResult | null;
	onConfigSaved?: () => void;
}

const DEFAULT_CONFIG: PersonioConfig = {
	employeeMatchStrategy: "employeeNumber",
	includeZeroHours: false,
	batchSize: 100,
	apiTimeoutMs: 30000,
};
type Translate = ReturnType<typeof useTranslate>["t"];
type RunTransition = (task: () => Promise<void>) => void;

export function PersonioConfigForm({
	organizationId,
	initialConfig,
	onConfigSaved,
}: PersonioConfigFormProps) {
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
					"settings.payrollExport.personio.credentialsRequired",
					"Please enter both Client ID and API Secret",
				),
			);
			return;
		}
		run(async () => {
			const result = await savePersonioCredentialsAction({
				organizationId,
				clientId,
				clientSecret,
			});
			if (!result.success) {
				toast.error(
					t(
						"settings.payrollExport.personio.credentialsError",
						"Failed to save credentials",
					),
					{ description: result.error },
				);
				return;
			}
			toast.success(
				t(
					"settings.payrollExport.personio.credentialsSaved",
					"API credentials saved securely",
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
			const result = await deletePersonioCredentialsAction(organizationId);
			if (result.success) {
				toast.success(
					t(
						"settings.payrollExport.personio.credentialsDeleted",
						"API credentials deleted",
					),
				);
				setShowCredentialsForm(true);
				onConfigSaved?.();
			} else {
				toast.error(
					t(
						"settings.payrollExport.personio.credentialsDeleteError",
						"Failed to delete credentials",
					),
					{ description: result.error },
				);
			}
		});
	const cancelCredentials = () => {
		setShowCredentialsForm(false);
		setClientId("");
		setClientSecret("");
	};

	return (
		<div className="space-y-6">
			<PersonioCredentialsCard
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
			<PersonioSettingsCard
				t={t}
				organizationId={organizationId}
				initialConfig={initialConfig}
				isPending={isPending}
				run={run}
				onConfigSaved={onConfigSaved}
			/>
		</div>
	);
}

function PersonioCredentialsCard({
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
				<div className="flex items-center gap-4">
					<Image
						src="/personio.svg"
						alt="Personio Logo"
						width={48}
						height={48}
						className="size-12"
					/>
					<div>
						<CardTitle className="flex items-center gap-2">
							{t(
								"settings.payrollExport.personio.credentialsTitle",
								"Personio API Credentials",
							)}
							{hasCredentials ? (
								<Badge variant="secondary" className="gap-1">
									<IconCheck className="size-3" aria-hidden="true" />
									{t("settings.payrollExport.personio.connected", "Connected")}
								</Badge>
							) : null}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.payrollExport.personio.credentialsDescription",
								"Enter your Personio API credentials to enable time entry sync",
							)}
						</CardDescription>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				{showForm || !hasCredentials ? (
					<>
						<CredentialInput
							id="clientId"
							label={t("settings.payrollExport.personio.clientId", "Client ID")}
							helpLabel={t(
								"settings.payrollExport.personio.clientIdHelp",
								"Client ID help",
							)}
							help={t(
								"settings.payrollExport.personio.clientIdTooltip",
								"Found in Personio under Settings > Integrations > API credentials",
							)}
							value={clientId}
							onChange={onClientIdChange}
							placeholder="papi-..."
						/>
						<CredentialInput
							id="clientSecret"
							type="password"
							label={t(
								"settings.payrollExport.personio.clientSecret",
								"API Secret",
							)}
							helpLabel={t(
								"settings.payrollExport.personio.clientSecretHelp",
								"API Secret help",
							)}
							help={t(
								"settings.payrollExport.personio.clientSecretTooltip",
								"The secret key associated with your Client ID",
							)}
							value={clientSecret}
							onChange={onClientSecretChange}
							placeholder="••••••••••••••••"
						/>
					</>
				) : (
					<div className="flex items-center justify-between rounded-lg border p-4">
						<div className="flex items-center gap-3">
							<IconPlugConnected className="size-5 text-green-600" />
							<div>
								<p className="font-medium">
									{t(
										"settings.payrollExport.personio.credentialsConfigured",
										"API credentials configured",
									)}
								</p>
								<p className="text-sm text-muted-foreground">
									{t(
										"settings.payrollExport.personio.credentialsSecure",
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
									"settings.payrollExport.personio.updateCredentials",
									"Update",
								)}
							</Button>
							<DeleteCredentialsButton t={t} onDelete={onDelete} />
						</div>
					</div>
				)}
			</CardContent>
			{showForm || !hasCredentials ? (
				<CardFooter className="flex gap-2">
					<Button
						type="button"
						onClick={onSave}
						disabled={isPending || !clientId || !clientSecret}
					>
						{isPending ? (
							<>
								<IconLoader2 className="mr-2 size-4 animate-spin" />
								{t("common.saving", "Saving...")}
							</>
						) : (
							t(
								"settings.payrollExport.personio.saveCredentials",
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
	helpLabel,
	help,
	value,
	onChange,
	placeholder,
}: {
	id: string;
	type?: string;
	label: string;
	helpLabel: string;
	help: string;
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
}) {
	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<Label htmlFor={id}>{label}</Label>
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
			<Input
				id={id}
				type={type}
				placeholder={placeholder}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				autoComplete={type === "password" ? "new-password" : "off"}
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
						"settings.payrollExport.personio.deleteCredentials",
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
							"settings.payrollExport.personio.deleteCredentialsTitle",
							"Delete API Credentials?",
						)}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{t(
							"settings.payrollExport.personio.deleteCredentialsDescription",
							"This will remove your Personio API credentials. You will need to re-enter them to use the Personio export.",
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

function PersonioSettingsCard({
	t,
	organizationId,
	initialConfig,
	isPending,
	run,
	onConfigSaved,
}: {
	t: Translate;
	organizationId: string;
	initialConfig?: PersonioConfigResult | null;
	isPending: boolean;
	run: RunTransition;
	onConfigSaved?: () => void;
}) {
	const [isTesting, setIsTesting] = useState(false);
	const form = useForm({
		defaultValues: (initialConfig?.config ??
			DEFAULT_CONFIG) satisfies PersonioConfig,
		onSubmit: async ({ value }) =>
			run(async () => {
				const result = await savePersonioConfigAction({
					organizationId,
					config: value,
				});
				if (result.success) {
					toast.success(
						t(
							"settings.payrollExport.personio.saveSuccess",
							"Configuration saved",
						),
					);
					onConfigSaved?.();
				} else
					toast.error(
						t(
							"settings.payrollExport.personio.saveError",
							"Failed to save configuration",
						),
						{ description: result.error },
					);
			}),
	});
	const testConnection = async () => {
		setIsTesting(true);
		const result = await testPersonioConnectionAction(organizationId).catch(
			() => null,
		);
		if (result?.success && result.data.success)
			toast.success(
				t(
					"settings.payrollExport.personio.connectionSuccess",
					"Successfully connected to Personio",
				),
			);
		else
			toast.error(
				t(
					"settings.payrollExport.personio.connectionFailed",
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
					{t("settings.payrollExport.personio.configTitle", "Export Settings")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.payrollExport.personio.configDescription",
						"Configure how time entries are exported to Personio",
					)}
				</CardDescription>
			</CardHeader>
			<form className="flex flex-col gap-6" action={() => form.handleSubmit()}>
				<CardContent className="space-y-4">
					<form.Field name="employeeMatchStrategy">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor="employeeMatchStrategy">
									{t(
										"settings.payrollExport.personio.employeeMatchStrategy",
										"Employee Matching",
									)}
								</Label>
								<Select
									value={field.state.value}
									onValueChange={(value) =>
										field.handleChange(value as "employeeNumber" | "email")
									}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="employeeNumber">
											{t(
												"settings.payrollExport.personio.matchByEmployeeNumber",
												"Employee Number (Recommended)",
											)}
										</SelectItem>
										<SelectItem value="email">
											{t(
												"settings.payrollExport.personio.matchByEmail",
												"Email Address",
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
											"settings.payrollExport.personio.includeZeroHours",
											"Include Zero Hours",
										)}
									</Label>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.payrollExport.personio.includeZeroHoursDescription",
											"Export days with no recorded time",
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
								<IconLoader2 className="mr-2 size-4 animate-spin" />
								{t("common.saving", "Saving...")}
							</>
						) : (
							t("settings.payrollExport.personio.save", "Save Settings")
						)}
					</Button>
					{initialConfig?.hasCredentials ? (
						<Button
							type="button"
							variant="outline"
							onClick={testConnection}
							disabled={isTesting}
						>
							{isTesting ? (
								<>
									<IconLoader2 className="mr-2 size-4 animate-spin" />
									{t("settings.payrollExport.personio.testing", "Testing...")}
								</>
							) : (
								<>
									<IconPlugConnected className="mr-2 size-4" />
									{t(
										"settings.payrollExport.personio.testConnection",
										"Test Connection",
									)}
								</>
							)}
						</Button>
					) : null}
				</CardFooter>
			</form>
		</Card>
	);
}
