"use client";

import { IconCheck, IconLoader2, IconPlugConnected, IconTrash, IconX } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
	deleteStorageConfigAction,
	getStorageConfigAction,
	type StorageConfigResult,
	saveStorageConfigAction,
	testStorageConnectionAction,
} from "@/app/[locale]/(app)/settings/export/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

const storageConfigSchema = z.object({
	bucket: z.string().min(1, "Bucket name is required"),
	accessKeyId: z.string(),
	secretAccessKey: z.string(),
	region: z.string().min(1, "Region is required"),
	endpoint: z.string(),
});

type StorageConfigFormValues = z.infer<typeof storageConfigSchema>;

interface StorageSettingsFormProps {
	organizationId: string;
	initialConfig?: StorageConfigResult | null;
	onConfigChange?: (hasConfig: boolean) => void;
}

export function StorageSettingsForm({
	organizationId,
	initialConfig,
	onConfigChange,
}: StorageSettingsFormProps) {
	const { t } = useTranslate();
	const [isPending, startTransition] = useTransition();
	const [isTesting, setIsTesting] = useState(false);
	const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
	const [config, setConfig] = useState<StorageConfigResult | null>(initialConfig ?? null);
	const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

	const form = useForm({
		defaultValues: {
			bucket: initialConfig?.bucket ?? "",
			accessKeyId: "",
			secretAccessKey: "",
			region: initialConfig?.region ?? "us-east-1",
			endpoint: initialConfig?.endpoint ?? "",
		},
		onSubmit: async ({ value }) => {
			// Only require credentials if there's no existing config
			if (!config && (!value.accessKeyId || !value.secretAccessKey)) {
				return;
			}

			startTransition(async () => {
				const result = await saveStorageConfigAction({
					organizationId,
					bucket: value.bucket,
					accessKeyId: value.accessKeyId,
					secretAccessKey: value.secretAccessKey,
					region: value.region,
					endpoint: value.endpoint || undefined,
				});

				if (result.success) {
					setConfig(result.data);
					setHasUnsavedChanges(false);
					setTestResult(null);
					form.reset();
					form.setFieldValue("bucket", result.data.bucket);
					form.setFieldValue("accessKeyId", "");
					form.setFieldValue("secretAccessKey", "");
					form.setFieldValue("region", result.data.region);
					form.setFieldValue("endpoint", result.data.endpoint ?? "");
					toast.success(t("settings.dataExport.storage.saveSuccess", "Configuration saved"), {
						description: t(
							"settings.dataExport.storage.saveSuccessDescription",
							"Your S3 storage settings have been saved",
						),
					});
					onConfigChange?.(true);
				} else {
					toast.error(t("settings.dataExport.storage.saveError", "Failed to save configuration"), {
						description:
							result.error ??
							t("settings.dataExport.storage.unexpectedError", "An unexpected error occurred"),
					});
				}
			});
		},
	});

	// Subscribe to form values for validation
	const formValues = useStore(form.store, (state) => state.values);
	const isFormValid = Boolean(
		formValues.bucket &&
			formValues.region &&
			(config || (formValues.accessKeyId && formValues.secretAccessKey)),
	);

	// Load config on mount if not provided
	useEffect(() => {
		if (!initialConfig) {
			startTransition(async () => {
				const result = await getStorageConfigAction(organizationId);
				if (result.success && result.data) {
					setConfig(result.data);
					form.setFieldValue("bucket", result.data.bucket);
					form.setFieldValue("accessKeyId", "");
					form.setFieldValue("secretAccessKey", "");
					form.setFieldValue("region", result.data.region);
					form.setFieldValue("endpoint", result.data.endpoint ?? "");
				}
			});
		}
	}, [organizationId, initialConfig, form]);

	const handleTestConnection = () => {
		setIsTesting(true);
		setTestResult(null);

		const values = formValues;

		startTransition(async () => {
			// If we have complete credentials, test with those
			// Otherwise test with stored config
			const testConfig =
				values.accessKeyId && values.secretAccessKey
					? {
							bucket: values.bucket,
							accessKeyId: values.accessKeyId,
							secretAccessKey: values.secretAccessKey,
							region: values.region,
							endpoint: values.endpoint,
						}
					: undefined;

			const result = await testStorageConnectionAction(organizationId, testConfig).catch(
				() => null,
			);
			if (!result) {
				setTestResult({
					success: false,
					message: t("settings.dataExport.storage.testFailed", "Connection test failed"),
				});
				setIsTesting(false);
				return;
			}

			if (result.success) {
				setTestResult(result.data);
				if (result.data.success) {
					// Refresh config to get updated verification status
					const configResult = await getStorageConfigAction(organizationId).catch(() => null);
					if (configResult?.success && configResult.data) {
						setConfig(configResult.data);
					}
				}
			} else {
				setTestResult({
					success: false,
					message: result.error ?? t("settings.dataExport.storage.testFailed", "Connection test failed"),
				});
			}

			setIsTesting(false);
		});
	};

	const handleDelete = () => {
		startTransition(async () => {
			const result = await deleteStorageConfigAction(organizationId);

			if (result.success) {
				setConfig(null);
				setTestResult(null);
				form.reset();
				form.setFieldValue("bucket", "");
				form.setFieldValue("accessKeyId", "");
				form.setFieldValue("secretAccessKey", "");
				form.setFieldValue("region", "us-east-1");
				form.setFieldValue("endpoint", "");
				toast.success(t("settings.dataExport.storage.deleteSuccess", "Configuration deleted"));
				onConfigChange?.(false);
			} else {
				toast.error(
					t("settings.dataExport.storage.deleteError", "Failed to delete configuration"),
					{
						description:
							result.error ??
							t("settings.dataExport.storage.unexpectedError", "An unexpected error occurred"),
					},
				);
			}
		});
	};

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							{t("settings.dataExport.storage.title", "S3 Storage Configuration")}
							{config?.isVerified && (
								<Badge variant="secondary" className="gap-1">
									<IconCheck className="h-3 w-3" />
									{t("settings.dataExport.storage.verified", "Verified")}
								</Badge>
							)}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.dataExport.storage.description",
								"Configure your own S3-compatible storage for exports",
							)}
						</CardDescription>
					</div>
					{config && (
						<AlertDialog>
							<AlertDialogTrigger asChild>
								<Button variant="ghost" size="icon" className="text-destructive">
									<IconTrash className="h-4 w-4" />
								</Button>
							</AlertDialogTrigger>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>
										{t("settings.dataExport.storage.deleteDialogTitle", "Delete Configuration")}
									</AlertDialogTitle>
									<AlertDialogDescription>
										{t(
											"settings.dataExport.storage.deleteDialogDescription",
											"Are you sure you want to delete this storage configuration?",
										)}
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
									<AlertDialogAction
										onClick={handleDelete}
										className="bg-destructive text-destructive-foreground"
									>
										{t("common.delete", "Delete")}
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					)}
				</div>
			</CardHeader>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					form.handleSubmit();
				}}
			>
				<CardContent className="space-y-4">
					{testResult && (
						<Alert variant={testResult.success ? "default" : "destructive"}>
							{testResult.success ? (
								<IconCheck className="h-4 w-4" />
							) : (
								<IconX className="h-4 w-4" />
							)}
							<AlertTitle>
								{testResult.success
									? t("settings.dataExport.storage.connectionSuccess", "Connection Successful")
									: t("settings.dataExport.storage.connectionFailed", "Connection Failed")}
							</AlertTitle>
							<AlertDescription>{testResult.message}</AlertDescription>
						</Alert>
					)}

					<div className="grid gap-4 md:grid-cols-2">
						<form.Field
							name="bucket"
							validators={{
								onChange: z.string().min(1, "Bucket name is required"),
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="bucket">
										{t("settings.dataExport.storage.bucketName", "Bucket Name")}
									</Label>
									<Input
										id="bucket"
										placeholder={t(
											"settings.dataExport.storage.bucketPlaceholder",
											"my-export-bucket",
										)}
										value={field.state.value}
										onChange={(e) => {
											field.handleChange(e.target.value);
											setHasUnsavedChanges(true);
										}}
										onBlur={field.handleBlur}
									/>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.dataExport.storage.bucketDescription",
											"The name of your S3 bucket",
										)}
									</p>
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
							name="region"
							validators={{
								onChange: z.string().min(1, "Region is required"),
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="region">
										{t("settings.dataExport.storage.region", "Region")}
									</Label>
									<Input
										id="region"
										placeholder={t("settings.dataExport.storage.regionPlaceholder", "us-east-1")}
										value={field.state.value}
										onChange={(e) => {
											field.handleChange(e.target.value);
											setHasUnsavedChanges(true);
										}}
										onBlur={field.handleBlur}
									/>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.dataExport.storage.regionDescription",
											"AWS region where your bucket is located",
										)}
									</p>
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

					<form.Field name="endpoint">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor="endpoint">
									{t("settings.dataExport.storage.endpoint", "Custom Endpoint (Optional)")}
								</Label>
								<Input
									id="endpoint"
									placeholder={t(
										"settings.dataExport.storage.endpointPlaceholder",
										"https://s3.example.com",
									)}
									value={field.state.value}
									onChange={(e) => {
										field.handleChange(e.target.value);
										setHasUnsavedChanges(true);
									}}
									onBlur={field.handleBlur}
								/>
								<p className="text-sm text-muted-foreground">
									{t(
										"settings.dataExport.storage.endpointDescription",
										"For S3-compatible services like MinIO",
									)}
								</p>
							</div>
						)}
					</form.Field>

					<div className="grid gap-4 md:grid-cols-2">
						<form.Field name="accessKeyId">
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="accessKeyId">
										{t("settings.dataExport.storage.accessKeyId", "Access Key ID")}
									</Label>
									<Input
										id="accessKeyId"
										type="password"
										placeholder={config ? "••••••••••••" : "AKIAIOSFODNN7EXAMPLE"}
										value={field.state.value}
										onChange={(e) => {
											field.handleChange(e.target.value);
											setHasUnsavedChanges(true);
										}}
										onBlur={field.handleBlur}
									/>
									<p className="text-sm text-muted-foreground">
										{config
											? t(
													"settings.dataExport.storage.keepExistingCredentials",
													"Leave blank to keep existing credentials",
												)
											: t(
													"settings.dataExport.storage.accessKeyDescription",
													"Your AWS access key ID",
												)}
									</p>
								</div>
							)}
						</form.Field>

						<form.Field name="secretAccessKey">
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="secretAccessKey">
										{t("settings.dataExport.storage.secretAccessKey", "Secret Access Key")}
									</Label>
									<Input
										id="secretAccessKey"
										type="password"
										placeholder={
											config ? "••••••••••••" : "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
										}
										value={field.state.value}
										onChange={(e) => {
											field.handleChange(e.target.value);
											setHasUnsavedChanges(true);
										}}
										onBlur={field.handleBlur}
									/>
									<p className="text-sm text-muted-foreground">
										{config
											? t(
													"settings.dataExport.storage.keepExistingCredentials",
													"Leave blank to keep existing credentials",
												)
											: t(
													"settings.dataExport.storage.secretKeyDescription",
													"Your AWS secret access key",
												)}
									</p>
								</div>
							)}
						</form.Field>
					</div>

					{config?.lastVerifiedAt && (
						<p className="text-muted-foreground text-sm">
							{t(
								"settings.dataExport.storage.lastVerified",
								`Last verified: ${new Date(config.lastVerifiedAt).toLocaleString()}`,
								{
									date: new Date(config.lastVerifiedAt).toLocaleString(),
								},
							)}
						</p>
					)}
				</CardContent>
				<CardFooter className="flex justify-between">
					<Button
						type="button"
						variant="outline"
						onClick={handleTestConnection}
						disabled={isPending || isTesting || (!config && !isFormValid)}
					>
						{isTesting ? (
							<>
								<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
								{t("settings.dataExport.storage.testing", "Testing...")}
							</>
						) : (
							<>
								<IconPlugConnected className="mr-2 h-4 w-4" />
								{t("settings.dataExport.storage.testConnection", "Test Connection")}
							</>
						)}
					</Button>
					<Button type="submit" disabled={isPending || !isFormValid}>
						{isPending ? (
							<>
								<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
								{t("settings.dataExport.storage.saving", "Saving...")}
							</>
						) : (
							t("settings.dataExport.storage.saveConfiguration", "Save Configuration")
						)}
					</Button>
				</CardFooter>
			</form>
		</Card>
	);
}
