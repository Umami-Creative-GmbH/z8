"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { IconCheck, IconLoader2, IconPlugConnected, IconTrash, IconX } from "@tabler/icons-react";
import { useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
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
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

const storageConfigSchema = z.object({
	bucket: z.string().min(1, "Bucket name is required"),
	accessKeyId: z.string().min(1, "Access Key ID is required"),
	secretAccessKey: z.string().min(1, "Secret Access Key is required"),
	region: z.string().min(1, "Region is required"),
	endpoint: z.string().optional(),
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
	const [isPending, startTransition] = useTransition();
	const [isTesting, setIsTesting] = useState(false);
	const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
	const [config, setConfig] = useState<StorageConfigResult | null>(initialConfig ?? null);
	const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

	const form = useForm<StorageConfigFormValues>({
		resolver: zodResolver(storageConfigSchema),
		defaultValues: {
			bucket: initialConfig?.bucket ?? "",
			accessKeyId: "",
			secretAccessKey: "",
			region: initialConfig?.region ?? "us-east-1",
			endpoint: initialConfig?.endpoint ?? "",
		},
	});

	// Load config on mount if not provided
	useEffect(() => {
		if (!initialConfig) {
			startTransition(async () => {
				const result = await getStorageConfigAction(organizationId);
				if (result.success && result.data) {
					setConfig(result.data);
					form.reset({
						bucket: result.data.bucket,
						accessKeyId: "",
						secretAccessKey: "",
						region: result.data.region,
						endpoint: result.data.endpoint ?? "",
					});
				}
			});
		}
	}, [organizationId, initialConfig, form]);

	const onSubmit = (data: StorageConfigFormValues) => {
		startTransition(async () => {
			const result = await saveStorageConfigAction({
				organizationId,
				bucket: data.bucket,
				accessKeyId: data.accessKeyId,
				secretAccessKey: data.secretAccessKey,
				region: data.region,
				endpoint: data.endpoint || undefined,
			});

			if (result.success) {
				setConfig(result.data);
				setHasUnsavedChanges(false);
				setTestResult(null);
				form.reset({
					bucket: result.data.bucket,
					accessKeyId: "",
					secretAccessKey: "",
					region: result.data.region,
					endpoint: result.data.endpoint ?? "",
				});
				toast.success("Storage configuration saved", {
					description: "Your S3 storage settings have been saved. Test the connection to verify.",
				});
				onConfigChange?.(true);
			} else {
				toast.error("Failed to save configuration", {
					description: result.error ?? "An unexpected error occurred",
				});
			}
		});
	};

	const handleTestConnection = () => {
		setIsTesting(true);
		setTestResult(null);

		const values = form.getValues();

		startTransition(async () => {
			try {
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

				const result = await testStorageConnectionAction(organizationId, testConfig);

				if (result.success) {
					setTestResult(result.data);
					if (result.data.success) {
						// Refresh config to get updated verification status
						const configResult = await getStorageConfigAction(organizationId);
						if (configResult.success && configResult.data) {
							setConfig(configResult.data);
						}
					}
				} else {
					setTestResult({
						success: false,
						message: result.error ?? "Connection test failed",
					});
				}
			} finally {
				setIsTesting(false);
			}
		});
	};

	const handleDelete = () => {
		startTransition(async () => {
			const result = await deleteStorageConfigAction(organizationId);

			if (result.success) {
				setConfig(null);
				setTestResult(null);
				form.reset({
					bucket: "",
					accessKeyId: "",
					secretAccessKey: "",
					region: "us-east-1",
					endpoint: "",
				});
				toast.success("Storage configuration deleted");
				onConfigChange?.(false);
			} else {
				toast.error("Failed to delete configuration", {
					description: result.error ?? "An unexpected error occurred",
				});
			}
		});
	};

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							S3 Storage Configuration
							{config?.isVerified && (
								<Badge variant="secondary" className="gap-1">
									<IconCheck className="h-3 w-3" />
									Verified
								</Badge>
							)}
						</CardTitle>
						<CardDescription>
							Configure S3-compatible storage for data exports. Supports AWS S3, MinIO, and other
							S3-compatible services.
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
									<AlertDialogTitle>Delete Storage Configuration?</AlertDialogTitle>
									<AlertDialogDescription>
										This will remove the S3 storage configuration. You won&apos;t be able to create
										new exports until you configure storage again. Existing exports will remain in
										S3 but may become inaccessible.
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel>Cancel</AlertDialogCancel>
									<AlertDialogAction
										onClick={handleDelete}
										className="bg-destructive text-destructive-foreground"
									>
										Delete
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					)}
				</div>
			</CardHeader>
			<Form {...form}>
				<form onSubmit={form.handleSubmit(onSubmit)}>
					<CardContent className="space-y-4">
						{testResult && (
							<Alert variant={testResult.success ? "default" : "destructive"}>
								{testResult.success ? (
									<IconCheck className="h-4 w-4" />
								) : (
									<IconX className="h-4 w-4" />
								)}
								<AlertTitle>
									{testResult.success ? "Connection Successful" : "Connection Failed"}
								</AlertTitle>
								<AlertDescription>{testResult.message}</AlertDescription>
							</Alert>
						)}

						<div className="grid gap-4 md:grid-cols-2">
							<FormField
								control={form.control}
								name="bucket"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Bucket Name</FormLabel>
										<FormControl>
											<Input
												placeholder="my-export-bucket"
												{...field}
												onChange={(e) => {
													field.onChange(e);
													setHasUnsavedChanges(true);
												}}
											/>
										</FormControl>
										<FormDescription>The S3 bucket where exports will be stored</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="region"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Region</FormLabel>
										<FormControl>
											<Input
												placeholder="us-east-1"
												{...field}
												onChange={(e) => {
													field.onChange(e);
													setHasUnsavedChanges(true);
												}}
											/>
										</FormControl>
										<FormDescription>AWS region or MinIO region</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>

						<FormField
							control={form.control}
							name="endpoint"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Custom Endpoint (Optional)</FormLabel>
									<FormControl>
										<Input
											placeholder="https://minio.example.com"
											{...field}
											onChange={(e) => {
												field.onChange(e);
												setHasUnsavedChanges(true);
											}}
										/>
									</FormControl>
									<FormDescription>
										For MinIO or other S3-compatible services. Leave empty for AWS S3.
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>

						<div className="grid gap-4 md:grid-cols-2">
							<FormField
								control={form.control}
								name="accessKeyId"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Access Key ID</FormLabel>
										<FormControl>
											<Input
												type="password"
												placeholder={config ? "••••••••••••" : "AKIAIOSFODNN7EXAMPLE"}
												{...field}
												onChange={(e) => {
													field.onChange(e);
													setHasUnsavedChanges(true);
												}}
											/>
										</FormControl>
										<FormDescription>
											{config ? "Leave empty to keep existing credentials" : "Your S3 access key"}
										</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="secretAccessKey"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Secret Access Key</FormLabel>
										<FormControl>
											<Input
												type="password"
												placeholder={
													config ? "••••••••••••" : "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
												}
												{...field}
												onChange={(e) => {
													field.onChange(e);
													setHasUnsavedChanges(true);
												}}
											/>
										</FormControl>
										<FormDescription>
											{config ? "Leave empty to keep existing credentials" : "Your S3 secret key"}
										</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>

						{config?.lastVerifiedAt && (
							<p className="text-muted-foreground text-sm">
								Last verified: {new Date(config.lastVerifiedAt).toLocaleString()}
							</p>
						)}
					</CardContent>
					<CardFooter className="flex justify-between">
						<Button
							type="button"
							variant="outline"
							onClick={handleTestConnection}
							disabled={isPending || isTesting || (!config && !form.formState.isValid)}
						>
							{isTesting ? (
								<>
									<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
									Testing...
								</>
							) : (
								<>
									<IconPlugConnected className="mr-2 h-4 w-4" />
									Test Connection
								</>
							)}
						</Button>
						<Button type="submit" disabled={isPending || !form.formState.isValid}>
							{isPending ? (
								<>
									<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
									Saving...
								</>
							) : (
								"Save Configuration"
							)}
						</Button>
					</CardFooter>
				</form>
			</Form>
		</Card>
	);
}
