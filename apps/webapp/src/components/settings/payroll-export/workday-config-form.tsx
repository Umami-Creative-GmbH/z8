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

export function WorkdayConfigForm({
	organizationId,
	initialConfig,
	onConfigSaved,
}: WorkdayConfigFormProps) {
	const { t } = useTranslate();
	const [isPending, startTransition] = useTransition();
	const [isTesting, setIsTesting] = useState(false);
	const [showCredentialsForm, setShowCredentialsForm] = useState(!initialConfig?.hasCredentials);
	const [clientId, setClientId] = useState("");
	const [clientSecret, setClientSecret] = useState("");

	const form = useForm({
		defaultValues: (initialConfig?.config ?? DEFAULT_CONFIG) satisfies WorkdayConfig,
		onSubmit: async ({ value }) => {
			startTransition(async () => {
				const result = await saveWorkdayConfigAction({
					organizationId,
					config: value,
				});

				if (result.success) {
					toast.success(t("settings.payrollExport.workday.saveSuccess", "Configuration saved"));
					onConfigSaved?.();
				} else {
					toast.error(
						t(
							"settings.payrollExport.workday.saveError",
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

	const handleSaveCredentials = async () => {
		if (!clientId || !clientSecret) {
			toast.error(
				t(
					"settings.payrollExport.workday.credentialsRequired",
					"Please enter both Client ID and Client Secret",
				),
			);
			return;
		}

		startTransition(async () => {
			const result = await saveWorkdayCredentialsAction({
				organizationId,
				clientId,
				clientSecret,
			});

			if (result.success) {
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
			} else {
				toast.error(
					t(
						"settings.payrollExport.workday.credentialsSaveError",
						"Failed to save credentials",
					),
					{
						description: result.error,
					},
				);
			}
		});
	};

	const handleDeleteCredentials = async () => {
		startTransition(async () => {
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
			} else {
				toast.error(
					t(
						"settings.payrollExport.workday.credentialsDeleteError",
						"Failed to delete credentials",
					),
					{
						description: result.error,
					},
				);
			}
		});
	};

	const handleTestConnection = async () => {
		setIsTesting(true);
		const result = await testWorkdayConnectionAction({
			organizationId,
			config: form.state.values,
		}).catch(() => null);

		if (!result) {
			toast.error(t("settings.payrollExport.workday.connectionFailed", "Connection test failed"));
			setIsTesting(false);
			return;
		}

		if (result.success && result.data.success) {
			toast.success(
				t(
					"settings.payrollExport.workday.connectionSuccess",
					"Successfully connected to Workday",
				),
			);
		} else {
			toast.error(t("settings.payrollExport.workday.connectionFailed", "Connection test failed"), {
				description: result.success ? result.data.error : result.error,
			});
		}

		setIsTesting(false);
	};

	const hasConfiguredCredentials = !showCredentialsForm;

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						{t(
							"settings.payrollExport.workday.credentialsTitle",
							"Workday API Credentials",
						)}
						{initialConfig?.hasCredentials && !showCredentialsForm && (
							<Badge variant="secondary" className="gap-1">
								<IconCheck className="h-3 w-3" aria-hidden="true" />
								{t("settings.payrollExport.workday.connected", "Connected")}
							</Badge>
						)}
					</CardTitle>
					<CardDescription>
						{t(
							"settings.payrollExport.workday.credentialsDescription",
							"Store OAuth credentials used for Workday API access",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{showCredentialsForm ? (
						<>
							<div className="space-y-2">
								<Label htmlFor="clientId">
									{t("settings.payrollExport.workday.clientId", "Client ID")}
								</Label>
								<Input
									id="clientId"
									type="text"
									autoComplete="off"
									value={clientId}
									onChange={(e) => setClientId(e.target.value)}
									placeholder="workday-client-id"
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="clientSecret">
									{t("settings.payrollExport.workday.clientSecret", "Client Secret")}
								</Label>
								<Input
									id="clientSecret"
									type="password"
									autoComplete="new-password"
									value={clientSecret}
									onChange={(e) => setClientSecret(e.target.value)}
									placeholder="********"
								/>
							</div>
						</>
					) : (
						<div className="flex items-center justify-between rounded-lg border p-4">
							<div className="flex items-center gap-3">
								<IconPlugConnected className="h-5 w-5 text-green-600" aria-hidden="true" />
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
									onClick={() => setShowCredentialsForm(true)}
								>
									{t("settings.payrollExport.workday.updateCredentials", "Update")}
								</Button>
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
											<IconTrash className="h-4 w-4 text-destructive" aria-hidden="true" />
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
												onClick={handleDeleteCredentials}
												className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
											>
												{t("common.delete", "Delete")}
											</AlertDialogAction>
										</AlertDialogFooter>
									</AlertDialogContent>
								</AlertDialog>
							</div>
						</div>
					)}
				</CardContent>
				{showCredentialsForm && (
					<CardFooter className="flex gap-2">
						<Button
							type="button"
							onClick={handleSaveCredentials}
							disabled={isPending || !clientId || !clientSecret}
						>
							{isPending ? (
								<>
									<IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
									{t("common.saving", "Saving...")}
								</>
							) : (
								t("settings.payrollExport.workday.saveCredentials", "Save Credentials")
							)}
						</Button>
						{initialConfig?.hasCredentials && (
							<Button
								type="button"
								variant="ghost"
								onClick={() => {
									setShowCredentialsForm(false);
									setClientId("");
									setClientSecret("");
								}}
							>
								{t("common.cancel", "Cancel")}
							</Button>
						)}
					</CardFooter>
				)}
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>{t("settings.payrollExport.workday.configTitle", "Workday Export Settings")}</CardTitle>
					<CardDescription>
						{t(
							"settings.payrollExport.workday.configDescription",
							"Configure how records are prepared and sent to Workday",
						)}
					</CardDescription>
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
									<Label htmlFor="instanceUrl">
										{t("settings.payrollExport.workday.instanceUrl", "Instance URL")}
									</Label>
									<Input
										id="instanceUrl"
										type="url"
										autoComplete="url"
										placeholder="https://wd5-impl-services1.workday.com"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
									/>
								</div>
							)}
						</form.Field>

						<form.Field name="tenantId">
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="tenantId">
										{t("settings.payrollExport.workday.tenantId", "Tenant ID")}
									</Label>
									<Input
										id="tenantId"
										type="text"
										autoComplete="organization"
										placeholder="tenant_name"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
									/>
								</div>
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
								<div className="space-y-2">
									<Label htmlFor="batchSize">
										{t("settings.payrollExport.workday.batchSize", "Batch Size")}
									</Label>
									<Input
										id="batchSize"
										type="number"
										autoComplete="off"
										min={1}
										max={500}
										value={field.state.value}
										onChange={(e) => field.handleChange(parseInt(e.target.value, 10) || 100)}
									/>
								</div>
							)}
						</form.Field>

						<form.Field name="apiTimeoutMs">
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="apiTimeoutMs">
										{t("settings.payrollExport.workday.apiTimeoutMs", "API Timeout (ms)")}
									</Label>
									<Input
										id="apiTimeoutMs"
										type="number"
										autoComplete="off"
										min={1000}
										step={1000}
										value={field.state.value}
										onChange={(e) =>
											field.handleChange(parseInt(e.target.value, 10) || 30000)
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
									<IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
									{t("common.saving", "Saving...")}
								</>
							) : (
								t("settings.payrollExport.workday.save", "Save Settings")
							)}
						</Button>
						<Button
							type="button"
							variant="outline"
							onClick={handleTestConnection}
							disabled={
								isTesting ||
								!hasConfiguredCredentials ||
								!form.state.values.instanceUrl ||
								!form.state.values.tenantId
							}
						>
							{isTesting ? (
								<>
									<IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
									{t("settings.payrollExport.workday.testing", "Testing...")}
								</>
							) : (
								<>
									<IconPlugConnected className="mr-2 h-4 w-4" aria-hidden="true" />
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
		</div>
	);
}
