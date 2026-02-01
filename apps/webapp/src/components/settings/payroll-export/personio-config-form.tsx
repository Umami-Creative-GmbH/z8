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
	savePersonioConfigAction,
	savePersonioCredentialsAction,
	deletePersonioCredentialsAction,
	testPersonioConnectionAction,
	type PersonioConfigResult,
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

export function PersonioConfigForm({
	organizationId,
	initialConfig,
	onConfigSaved,
}: PersonioConfigFormProps) {
	const { t } = useTranslate();
	const [isPending, startTransition] = useTransition();
	const [isTesting, setIsTesting] = useState(false);
	const [showCredentialsForm, setShowCredentialsForm] = useState(
		!initialConfig?.hasCredentials,
	);

	// Credentials form state
	const [clientId, setClientId] = useState("");
	const [clientSecret, setClientSecret] = useState("");

	const form = useForm({
		defaultValues: (initialConfig?.config ?? DEFAULT_CONFIG) satisfies PersonioConfig,
		onSubmit: async ({ value }) => {
			startTransition(async () => {
				const result = await savePersonioConfigAction({
					organizationId,
					config: value,
				});

				if (result.success) {
					toast.success(
						t("settings.payrollExport.personio.saveSuccess", "Configuration saved"),
					);
					onConfigSaved?.();
				} else {
					toast.error(
						t(
							"settings.payrollExport.personio.saveError",
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
					"settings.payrollExport.personio.credentialsRequired",
					"Please enter both Client ID and API Secret",
				),
			);
			return;
		}

		startTransition(async () => {
			const result = await savePersonioCredentialsAction({
				organizationId,
				clientId,
				clientSecret,
			});

			if (result.success) {
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
			} else {
				toast.error(
					t(
						"settings.payrollExport.personio.credentialsError",
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
					{
						description: result.error,
					},
				);
			}
		});
	};

	const handleTestConnection = async () => {
		setIsTesting(true);
		try {
			const result = await testPersonioConnectionAction(organizationId);

			if (result.success) {
				if (result.data.success) {
					toast.success(
						t(
							"settings.payrollExport.personio.connectionSuccess",
							"Successfully connected to Personio",
						),
					);
				} else {
					toast.error(
						t(
							"settings.payrollExport.personio.connectionFailed",
							"Connection test failed",
						),
						{
							description: result.data.error,
						},
					);
				}
			} else {
				toast.error(
					t(
						"settings.payrollExport.personio.connectionFailed",
						"Connection test failed",
					),
					{
						description: result.error,
					},
				);
			}
		} finally {
			setIsTesting(false);
		}
	};

	return (
		<div className="space-y-6">
			{/* API Credentials Card */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-4">
							<Image
								src="/personio.svg"
								alt="Personio Logo"
								width={48}
								height={48}
								className="h-12 w-12"
							/>
							<div>
								<CardTitle className="flex items-center gap-2">
									{t(
										"settings.payrollExport.personio.credentialsTitle",
										"Personio API Credentials",
									)}
									{initialConfig?.hasCredentials && (
										<Badge variant="secondary" className="gap-1">
											<IconCheck className="h-3 w-3" aria-hidden="true" />
											{t(
												"settings.payrollExport.personio.connected",
												"Connected",
											)}
										</Badge>
									)}
								</CardTitle>
								<CardDescription>
									{t(
										"settings.payrollExport.personio.credentialsDescription",
										"Enter your Personio API credentials to enable time entry sync",
									)}
								</CardDescription>
							</div>
						</div>
					</div>
				</CardHeader>
				<CardContent className="space-y-4">
					{showCredentialsForm || !initialConfig?.hasCredentials ? (
						<>
							<div className="space-y-2">
								<div className="flex items-center gap-2">
									<Label htmlFor="clientId">
										{t("settings.payrollExport.personio.clientId", "Client ID")}
									</Label>
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger asChild>
												<button
													type="button"
													className="inline-flex cursor-help"
													aria-label={t("settings.payrollExport.personio.clientIdHelp", "Client ID help")}
												>
													<IconInfoCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
												</button>
											</TooltipTrigger>
											<TooltipContent className="max-w-xs">
												<p>
													{t(
														"settings.payrollExport.personio.clientIdTooltip",
														"Found in Personio under Settings > Integrations > API credentials",
													)}
												</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</div>
								<Input
									id="clientId"
									type="text"
									placeholder="papi-..."
									value={clientId}
									onChange={(e) => setClientId(e.target.value)}
									autoComplete="off"
								/>
							</div>

							<div className="space-y-2">
								<div className="flex items-center gap-2">
									<Label htmlFor="clientSecret">
										{t(
											"settings.payrollExport.personio.clientSecret",
											"API Secret",
										)}
									</Label>
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger asChild>
												<button
													type="button"
													className="inline-flex cursor-help"
													aria-label={t("settings.payrollExport.personio.clientSecretHelp", "API Secret help")}
												>
													<IconInfoCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
												</button>
											</TooltipTrigger>
											<TooltipContent className="max-w-xs">
												<p>
													{t(
														"settings.payrollExport.personio.clientSecretTooltip",
														"The secret key associated with your Client ID",
													)}
												</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</div>
								<Input
									id="clientSecret"
									type="password"
									placeholder="••••••••••••••••"
									value={clientSecret}
									onChange={(e) => setClientSecret(e.target.value)}
									autoComplete="new-password"
								/>
							</div>
						</>
					) : (
						<div className="flex items-center justify-between rounded-lg border p-4">
							<div className="flex items-center gap-3">
								<IconPlugConnected className="h-5 w-5 text-green-600" />
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
									onClick={() => setShowCredentialsForm(true)}
								>
									{t("settings.payrollExport.personio.updateCredentials", "Update")}
								</Button>
								<AlertDialog>
									<AlertDialogTrigger asChild>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											aria-label={t("settings.payrollExport.personio.deleteCredentials", "Delete credentials")}
										>
											<IconTrash className="h-4 w-4 text-destructive" aria-hidden="true" />
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
											<AlertDialogCancel>
												{t("common.cancel", "Cancel")}
											</AlertDialogCancel>
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
				{(showCredentialsForm || !initialConfig?.hasCredentials) && (
					<CardFooter className="flex gap-2">
						<Button
							type="button"
							onClick={handleSaveCredentials}
							disabled={isPending || !clientId || !clientSecret}
						>
							{isPending ? (
								<>
									<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
									{t("common.saving", "Saving...")}
								</>
							) : (
								t("settings.payrollExport.personio.saveCredentials", "Save Credentials")
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

			{/* Configuration Card */}
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
				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
				>
					<CardContent className="space-y-4">
						<form.Field name="employeeMatchStrategy">
							{(field) => (
								<div className="space-y-2">
									<div className="flex items-center gap-2">
										<Label htmlFor="employeeMatchStrategy">
											{t(
												"settings.payrollExport.personio.employeeMatchStrategy",
												"Employee Matching",
											)}
										</Label>
										<TooltipProvider>
											<Tooltip>
												<TooltipTrigger asChild>
													<button
														type="button"
														className="inline-flex cursor-help"
														aria-label={t("settings.payrollExport.personio.employeeMatchStrategyHelp", "Employee matching help")}
													>
														<IconInfoCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
													</button>
												</TooltipTrigger>
												<TooltipContent className="max-w-xs">
													<p>
														{t(
															"settings.payrollExport.personio.employeeMatchStrategyTooltip",
															"How to match employees between Z8 and Personio",
														)}
													</p>
												</TooltipContent>
											</Tooltip>
										</TooltipProvider>
									</div>
									<Select
										value={field.state.value}
										onValueChange={(v) =>
											field.handleChange(v as "employeeNumber" | "email")
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
									<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
									{t("common.saving", "Saving...")}
								</>
							) : (
								t("settings.payrollExport.personio.save", "Save Settings")
							)}
						</Button>
						{initialConfig?.hasCredentials && (
							<Button
								type="button"
								variant="outline"
								onClick={handleTestConnection}
								disabled={isTesting}
							>
								{isTesting ? (
									<>
										<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
										{t("settings.payrollExport.personio.testing", "Testing...")}
									</>
								) : (
									<>
										<IconPlugConnected className="mr-2 h-4 w-4" />
										{t(
											"settings.payrollExport.personio.testConnection",
											"Test Connection",
										)}
									</>
								)}
							</Button>
						)}
					</CardFooter>
				</form>
			</Card>
		</div>
	);
}
