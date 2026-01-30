"use client";

import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import {
	AlertTriangle,
	CheckCircle2,
	Loader2,
	Mail,
	Send,
	Server,
	Shield,
	Trash2,
	XCircle,
} from "lucide-react";
import { useState, useTransition } from "react";
import type {
	EmailConfigInput,
	EmailConfigOutput,
} from "@/app/[locale]/(app)/settings/enterprise/email/actions";
import {
	deleteEmailConfig,
	saveEmailConfig,
	testEmailConfig,
} from "@/app/[locale]/(app)/settings/enterprise/email/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

interface EmailConfigFormProps {
	organizationId: string;
	initialConfig: EmailConfigOutput | null;
	vaultStatus: {
		available: boolean;
		initialized: boolean;
		sealed: boolean;
		address: string;
	};
}

export function EmailConfigForm({
	organizationId,
	initialConfig,
	vaultStatus,
}: EmailConfigFormProps) {
	const { t } = useTranslate();
	const [isPending, startTransition] = useTransition();
	const [testEmail, setTestEmail] = useState("");
	const [isTesting, setIsTesting] = useState(false);

	const defaultValues: EmailConfigInput = {
		transportType: initialConfig?.transportType ?? "resend",
		fromEmail: initialConfig?.fromEmail ?? "",
		fromName: initialConfig?.fromName ?? "",
		isActive: initialConfig?.isActive ?? true,
		resendApiKey: "",
		smtpHost: initialConfig?.smtpHost ?? "",
		smtpPort: initialConfig?.smtpPort ?? 587,
		smtpSecure: initialConfig?.smtpSecure ?? true,
		smtpRequireTls: initialConfig?.smtpRequireTls ?? true,
		smtpUsername: initialConfig?.smtpUsername ?? "",
		smtpPassword: "",
	};

	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			startTransition(async () => {
				const result = await saveEmailConfig(organizationId, value);
				if (result.success) {
					toast.success(t("settings.enterprise.email.saved", "Email configuration saved"));
				} else {
					toast.error(result.error || t("settings.enterprise.email.saveFailed", "Failed to save"));
				}
			});
		},
	});

	const handleTest = async () => {
		if (!testEmail) {
			toast.error(
				t("settings.enterprise.email.testEmailRequired", "Please enter a test email address"),
			);
			return;
		}

		setIsTesting(true);
		try {
			const result = await testEmailConfig(organizationId, testEmail);
			if (result.success) {
				toast.success(t("settings.enterprise.email.testSent", "Test email sent successfully"));
			} else {
				toast.error(
					result.error || t("settings.enterprise.email.testFailed", "Failed to send test email"),
				);
			}
		} finally {
			setIsTesting(false);
		}
	};

	const handleDelete = async () => {
		if (
			!confirm(
				t(
					"settings.enterprise.email.deleteConfirm",
					"Are you sure you want to delete this email configuration?",
				),
			)
		) {
			return;
		}

		startTransition(async () => {
			const result = await deleteEmailConfig(organizationId);
			if (result.success) {
				toast.success(t("settings.enterprise.email.deleted", "Email configuration deleted"));
			} else {
				toast.error(
					result.error || t("settings.enterprise.email.deleteFailed", "Failed to delete"),
				);
			}
		});
	};

	// Vault status component
	const VaultStatus = () => {
		if (!vaultStatus.available) {
			return (
				<Alert variant="destructive" className="mb-4">
					<AlertTriangle className="h-4 w-4" />
					<AlertTitle>
						{t("settings.enterprise.email.vaultUnavailable", "Vault Unavailable")}
					</AlertTitle>
					<AlertDescription>
						{t(
							"settings.enterprise.email.vaultUnavailableDesc",
							"HashiCorp Vault is not available. Secrets cannot be stored securely.",
						)}
					</AlertDescription>
				</Alert>
			);
		}

		if (vaultStatus.sealed) {
			return (
				<Alert variant="destructive" className="mb-4">
					<AlertTriangle className="h-4 w-4" />
					<AlertTitle>{t("settings.enterprise.email.vaultSealed", "Vault Sealed")}</AlertTitle>
					<AlertDescription>
						{t(
							"settings.enterprise.email.vaultSealedDesc",
							"HashiCorp Vault is sealed. Please unseal it to store secrets.",
						)}
					</AlertDescription>
				</Alert>
			);
		}

		return (
			<Alert className="mb-4">
				<Shield className="h-4 w-4" />
				<AlertTitle>{t("settings.enterprise.email.vaultConnected", "Vault Connected")}</AlertTitle>
				<AlertDescription>
					{t(
						"settings.enterprise.email.vaultConnectedDesc",
						"Secrets are stored securely in HashiCorp Vault.",
					)}
				</AlertDescription>
			</Alert>
		);
	};

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				form.handleSubmit();
			}}
		>
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Mail className="h-5 w-5" />
						{t("settings.enterprise.email.title", "Email Configuration")}
					</CardTitle>
					<CardDescription>
						{t(
							"settings.enterprise.email.description",
							"Configure a custom email provider for your organization. All organization emails (notifications, auth, invitations) will use this configuration.",
						)}
					</CardDescription>
				</CardHeader>

				<CardContent className="space-y-6">
					<VaultStatus />

					{/* Transport Type Selection */}
					<div className="space-y-3">
						<Label>{t("settings.enterprise.email.transportType", "Email Provider")}</Label>
						<form.Field name="transportType">
							{(field) => (
								<RadioGroup
									value={field.state.value}
									onValueChange={(value) => field.handleChange(value as "resend" | "smtp")}
									className="flex flex-col gap-3"
								>
									<div className="flex items-center space-x-2">
										<RadioGroupItem value="resend" id="resend" />
										<Label htmlFor="resend" className="flex items-center gap-2 cursor-pointer">
											<Send className="h-4 w-4" />
											Resend
											<Badge variant="secondary" className="text-xs">
												{t("settings.enterprise.email.recommended", "Recommended")}
											</Badge>
										</Label>
									</div>
									<div className="flex items-center space-x-2">
										<RadioGroupItem value="smtp" id="smtp" />
										<Label htmlFor="smtp" className="flex items-center gap-2 cursor-pointer">
											<Server className="h-4 w-4" />
											{t("settings.enterprise.email.smtpServer", "SMTP Server")}
										</Label>
									</div>
								</RadioGroup>
							)}
						</form.Field>
					</div>

					<Separator />

					{/* Common Fields */}
					<div className="grid gap-4 md:grid-cols-2">
						<form.Field name="fromEmail">
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="fromEmail">
										{t("settings.enterprise.email.fromEmail", "From Email")} *
									</Label>
									<Input
										id="fromEmail"
										type="email"
										placeholder="noreply@yourdomain.com"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										required
									/>
								</div>
							)}
						</form.Field>

						<form.Field name="fromName">
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="fromName">
										{t("settings.enterprise.email.fromName", "From Name")}
									</Label>
									<Input
										id="fromName"
										placeholder="Your Company Name"
										value={field.state.value ?? ""}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
									/>
								</div>
							)}
						</form.Field>
					</div>

					{/* Resend Configuration */}
					<form.Subscribe selector={(state) => state.values.transportType}>
						{(transportType) =>
							transportType === "resend" && (
								<div className="space-y-4 rounded-lg border p-4">
									<h4 className="font-medium flex items-center gap-2">
										<Send className="h-4 w-4" />
										{t("settings.enterprise.email.resendConfig", "Resend Configuration")}
									</h4>
									<form.Field name="resendApiKey">
										{(field) => (
											<div className="space-y-2">
												<Label htmlFor="resendApiKey">
													{t("settings.enterprise.email.apiKey", "API Key")}
													{initialConfig?.hasResendApiKey && (
														<Badge variant="outline" className="ml-2 text-xs">
															<CheckCircle2 className="h-3 w-3 mr-1" />
															{t("settings.enterprise.email.secretSet", "Set")}
														</Badge>
													)}
												</Label>
												<Input
													id="resendApiKey"
													type="password"
													placeholder={initialConfig?.hasResendApiKey ? "••••••••" : "re_..."}
													value={field.state.value ?? ""}
													onChange={(e) => field.handleChange(e.target.value)}
													onBlur={field.handleBlur}
												/>
												<p className="text-xs text-muted-foreground">
													{t(
														"settings.enterprise.email.apiKeyHint",
														"Leave blank to keep existing key. Get your API key from resend.com",
													)}
												</p>
											</div>
										)}
									</form.Field>
								</div>
							)
						}
					</form.Subscribe>

					{/* SMTP Configuration */}
					<form.Subscribe selector={(state) => state.values.transportType}>
						{(transportType) =>
							transportType === "smtp" && (
								<div className="space-y-4 rounded-lg border p-4">
									<h4 className="font-medium flex items-center gap-2">
										<Server className="h-4 w-4" />
										{t("settings.enterprise.email.smtpConfig", "SMTP Configuration")}
									</h4>

									<div className="grid gap-4 md:grid-cols-2">
										<form.Field name="smtpHost">
											{(field) => (
												<div className="space-y-2">
													<Label htmlFor="smtpHost">
														{t("settings.enterprise.email.smtpHost", "SMTP Host")} *
													</Label>
													<Input
														id="smtpHost"
														placeholder="smtp.example.com"
														value={field.state.value ?? ""}
														onChange={(e) => field.handleChange(e.target.value)}
														onBlur={field.handleBlur}
													/>
												</div>
											)}
										</form.Field>

										<form.Field name="smtpPort">
											{(field) => (
												<div className="space-y-2">
													<Label htmlFor="smtpPort">
														{t("settings.enterprise.email.smtpPort", "Port")} *
													</Label>
													<Input
														id="smtpPort"
														type="number"
														placeholder="587"
														value={field.state.value ?? 587}
														onChange={(e) => field.handleChange(Number.parseInt(e.target.value))}
														onBlur={field.handleBlur}
													/>
												</div>
											)}
										</form.Field>
									</div>

									<div className="grid gap-4 md:grid-cols-2">
										<form.Field name="smtpUsername">
											{(field) => (
												<div className="space-y-2">
													<Label htmlFor="smtpUsername">
														{t("settings.enterprise.email.smtpUsername", "Username")} *
													</Label>
													<Input
														id="smtpUsername"
														placeholder="user@example.com"
														value={field.state.value ?? ""}
														onChange={(e) => field.handleChange(e.target.value)}
														onBlur={field.handleBlur}
													/>
												</div>
											)}
										</form.Field>

										<form.Field name="smtpPassword">
											{(field) => (
												<div className="space-y-2">
													<Label htmlFor="smtpPassword">
														{t("settings.enterprise.email.smtpPassword", "Password")}
														{initialConfig?.hasSmtpPassword && (
															<Badge variant="outline" className="ml-2 text-xs">
																<CheckCircle2 className="h-3 w-3 mr-1" />
																{t("settings.enterprise.email.secretSet", "Set")}
															</Badge>
														)}
													</Label>
													<Input
														id="smtpPassword"
														type="password"
														placeholder={initialConfig?.hasSmtpPassword ? "••••••••" : ""}
														value={field.state.value ?? ""}
														onChange={(e) => field.handleChange(e.target.value)}
														onBlur={field.handleBlur}
													/>
													<p className="text-xs text-muted-foreground">
														{t(
															"settings.enterprise.email.passwordHint",
															"Leave blank to keep existing password",
														)}
													</p>
												</div>
											)}
										</form.Field>
									</div>

									<div className="flex flex-col gap-3">
										<form.Field name="smtpSecure">
											{(field) => (
												<div className="flex items-center space-x-2">
													<Checkbox
														id="smtpSecure"
														checked={field.state.value ?? true}
														onCheckedChange={(checked) => field.handleChange(checked === true)}
													/>
													<Label htmlFor="smtpSecure" className="cursor-pointer">
														{t("settings.enterprise.email.smtpSecure", "Use TLS (port 465)")}
													</Label>
												</div>
											)}
										</form.Field>

										<form.Field name="smtpRequireTls">
											{(field) => (
												<div className="flex items-center space-x-2">
													<Checkbox
														id="smtpRequireTls"
														checked={field.state.value ?? true}
														onCheckedChange={(checked) => field.handleChange(checked === true)}
													/>
													<Label htmlFor="smtpRequireTls" className="cursor-pointer">
														{t(
															"settings.enterprise.email.smtpRequireTls",
															"Require STARTTLS upgrade",
														)}
													</Label>
												</div>
											)}
										</form.Field>
									</div>
								</div>
							)
						}
					</form.Subscribe>

					{/* Active Toggle */}
					<form.Field name="isActive">
						{(field) => (
							<div className="flex items-center space-x-2">
								<Checkbox
									id="isActive"
									checked={field.state.value}
									onCheckedChange={(checked) => field.handleChange(checked === true)}
								/>
								<Label htmlFor="isActive" className="cursor-pointer">
									{t("settings.enterprise.email.isActive", "Enable this email configuration")}
								</Label>
							</div>
						)}
					</form.Field>

					{/* Test Status */}
					{initialConfig?.lastTestAt && (
						<div className="rounded-lg border p-4 space-y-2">
							<h4 className="font-medium">
								{t("settings.enterprise.email.lastTest", "Last Test")}
							</h4>
							<div className="flex items-center gap-2 text-sm">
								{initialConfig.lastTestSuccess ? (
									<>
										<CheckCircle2 className="h-4 w-4 text-green-500" />
										<span className="text-green-600">
											{t("settings.enterprise.email.testSuccess", "Success")}
										</span>
									</>
								) : (
									<>
										<XCircle className="h-4 w-4 text-red-500" />
										<span className="text-red-600">
											{t("settings.enterprise.email.testFailure", "Failed")}
										</span>
									</>
								)}
								<span className="text-muted-foreground">
									{new Date(initialConfig.lastTestAt).toLocaleString()}
								</span>
							</div>
							{initialConfig.lastTestError && (
								<p className="text-sm text-red-600">{initialConfig.lastTestError}</p>
							)}
						</div>
					)}

					{/* Test Email Section */}
					{initialConfig && (
						<>
							<Separator />
							<div className="space-y-3">
								<Label>{t("settings.enterprise.email.testSection", "Send Test Email")}</Label>
								<div className="flex gap-2">
									<Input
										type="email"
										placeholder="test@example.com"
										value={testEmail}
										onChange={(e) => setTestEmail(e.target.value)}
										className="flex-1"
									/>
									<Button
										type="button"
										variant="outline"
										onClick={handleTest}
										disabled={isTesting || !testEmail}
									>
										{isTesting ? (
											<Loader2 className="h-4 w-4 animate-spin" />
										) : (
											<Send className="h-4 w-4 mr-2" />
										)}
										{t("settings.enterprise.email.sendTest", "Send Test")}
									</Button>
								</div>
							</div>
						</>
					)}
				</CardContent>

				<CardFooter className="flex justify-between">
					{initialConfig && (
						<Button type="button" variant="destructive" onClick={handleDelete} disabled={isPending}>
							<Trash2 className="h-4 w-4 mr-2" />
							{t("settings.enterprise.email.delete", "Delete Configuration")}
						</Button>
					)}
					<div className="flex-1" />
					<form.Subscribe selector={(state) => [state.isDirty, state.isSubmitting]}>
						{([isDirty, isSubmitting]) => (
							<Button
								type="submit"
								disabled={isPending || isSubmitting || (!isDirty && !!initialConfig)}
							>
								{(isPending || isSubmitting) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
								{initialConfig
									? t("settings.enterprise.email.save", "Save Changes")
									: t("settings.enterprise.email.create", "Create Configuration")}
							</Button>
						)}
					</form.Subscribe>
				</CardFooter>
			</Card>
		</form>
	);
}
