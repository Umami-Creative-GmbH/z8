"use client";

import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { toast } from "sonner";
import {
	addSocialOAuthConfigAction,
	type SocialOAuthConfigResponse,
	updateSocialOAuthConfigAction,
} from "@/app/[locale]/(app)/settings/enterprise/actions";
import type { SocialOAuthProvider } from "@/db/schema";
import { Apple } from "@/components/ui/svgs/apple";
import { GithubDark } from "@/components/ui/svgs/githubDark";
import { Google } from "@/components/ui/svgs/google";
import { Linkedin } from "@/components/ui/svgs/linkedin";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";

interface SocialOAuthDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	availableProviders?: SocialOAuthProvider[];
	editConfig?: SocialOAuthConfigResponse;
	onConfigAdded?: (config: SocialOAuthConfigResponse) => void;
	onConfigUpdated?: (config: SocialOAuthConfigResponse) => void;
}

const PROVIDER_INFO: Record<
	SocialOAuthProvider,
	{ name: string; icon: typeof Google; docsUrl: string }
> = {
	google: {
		name: "Google",
		icon: Google,
		docsUrl: "https://console.cloud.google.com/apis/credentials",
	},
	github: {
		name: "GitHub",
		icon: GithubDark,
		docsUrl: "https://github.com/settings/developers",
	},
	linkedin: {
		name: "LinkedIn",
		icon: Linkedin,
		docsUrl: "https://www.linkedin.com/developers/apps",
	},
	apple: {
		name: "Apple",
		icon: Apple,
		docsUrl: "https://developer.apple.com/account/resources/identifiers/list",
	},
};

export function SocialOAuthDialog({
	open,
	onOpenChange,
	availableProviders = [],
	editConfig,
	onConfigAdded,
	onConfigUpdated,
}: SocialOAuthDialogProps) {
	const [isSubmitting, setIsSubmitting] = useState(false);
	const isEditing = !!editConfig;

	const form = useForm({
		defaultValues: {
			provider: editConfig?.provider || availableProviders[0] || "google",
			clientId: editConfig?.clientId || "",
			clientSecret: "",
			isActive: editConfig?.isActive ?? true,
			// Apple-specific fields
			appleTeamId: "",
			appleKeyId: "",
		},
		onSubmit: async ({ value }) => {
			setIsSubmitting(true);
			try {
				// Build provider config for Apple
				const providerConfig =
					value.provider === "apple" && value.appleTeamId && value.appleKeyId
						? {
								apple: {
									teamId: value.appleTeamId,
									keyId: value.appleKeyId,
								},
							}
						: undefined;

				if (isEditing && editConfig) {
					const updated = await updateSocialOAuthConfigAction(editConfig.id, {
						clientId: value.clientId,
						clientSecret: value.clientSecret || undefined,
						isActive: value.isActive,
						providerConfig,
					});
					onConfigUpdated?.(updated);
				} else {
					if (!value.clientSecret) {
						toast.error("Client Secret is required");
						return;
					}
					const config = await addSocialOAuthConfigAction({
						provider: value.provider as SocialOAuthProvider,
						clientId: value.clientId,
						clientSecret: value.clientSecret,
						providerConfig,
					});
					onConfigAdded?.(config);
				}
				form.reset();
			} catch (error) {
				if (error instanceof Error) {
					toast.error(error.message);
				} else {
					toast.error(isEditing ? "Failed to update config" : "Failed to add provider");
				}
			} finally {
				setIsSubmitting(false);
			}
		},
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{isEditing
							? `Edit ${PROVIDER_INFO[editConfig.provider].name} OAuth`
							: "Add Social OAuth Provider"}
					</DialogTitle>
					<DialogDescription>
						{isEditing
							? "Update your OAuth credentials."
							: "Configure your own OAuth app for social login."}
					</DialogDescription>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
					className="space-y-4"
				>
					{!isEditing && (
						<form.Field name="provider">
							{(field) => {
								const providerInfo = PROVIDER_INFO[field.state.value as SocialOAuthProvider];
								return (
									<div className="space-y-2">
										<Label htmlFor="provider">Provider</Label>
										<Select
											value={field.state.value}
											onValueChange={(value) => field.handleChange(value as SocialOAuthProvider)}
										>
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{availableProviders.map((provider) => {
													const info = PROVIDER_INFO[provider];
													return (
														<SelectItem key={provider} value={provider}>
															<div className="flex items-center gap-2">
																<info.icon className="h-4 w-4" />
																{info.name}
															</div>
														</SelectItem>
													);
												})}
											</SelectContent>
										</Select>
										{providerInfo && (
											<p className="text-sm text-muted-foreground">
												Create an OAuth app at{" "}
												<a
													href={providerInfo.docsUrl}
													target="_blank"
													rel="noopener noreferrer"
													className="text-primary underline"
												>
													{providerInfo.name} Developer Console
												</a>
											</p>
										)}
									</div>
								);
							}}
						</form.Field>
					)}

					<form.Field
						name="clientId"
						validators={{
							onChange: ({ value }) => {
								if (!value) return "Client ID is required";
								return undefined;
							},
						}}
					>
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor="clientId">Client ID</Label>
								<Input
									id="clientId"
									placeholder="Your OAuth client ID"
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
								/>
								{field.state.meta.errors.length > 0 && (
									<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
								)}
							</div>
						)}
					</form.Field>

					{/* Subscribe to provider changes for client secret field */}
					<form.Subscribe selector={(state) => state.values.provider}>
						{(selectedProvider) => (
							<form.Field
								name="clientSecret"
								validators={{
									onChange: ({ value }) => {
										if (!isEditing && !value) return "Client Secret is required";
										return undefined;
									},
								}}
							>
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor="clientSecret">
											{selectedProvider === "apple" ? "Private Key (.p8)" : "Client Secret"}
										</Label>
										{selectedProvider === "apple" ? (
											<Textarea
												id="clientSecret"
												placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
												rows={4}
											/>
										) : (
											<Input
												id="clientSecret"
												type="password"
												placeholder={
													isEditing ? "Leave blank to keep existing" : "Your OAuth client secret"
												}
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
											/>
										)}
										{isEditing && (
											<p className="text-sm text-muted-foreground">
												Leave blank to keep the existing secret
											</p>
										)}
										{field.state.meta.errors.length > 0 && (
											<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
										)}
									</div>
								)}
							</form.Field>
						)}
					</form.Subscribe>

					{/* Apple-specific fields - subscribe to provider changes */}
					<form.Subscribe selector={(state) => state.values.provider}>
						{(selectedProvider) =>
							selectedProvider === "apple" && (
								<>
									<form.Field
										name="appleTeamId"
										validators={{
											onChange: ({ value }) => {
												if (!isEditing && !value) {
													return "Team ID is required for Apple";
												}
												return undefined;
											},
										}}
									>
										{(field) => (
											<div className="space-y-2">
												<Label htmlFor="appleTeamId">Team ID</Label>
												<Input
													id="appleTeamId"
													placeholder="ABCD1234EF"
													value={field.state.value}
													onChange={(e) => field.handleChange(e.target.value)}
													onBlur={field.handleBlur}
												/>
												<p className="text-sm text-muted-foreground">
													Found in your Apple Developer account
												</p>
												{field.state.meta.errors.length > 0 && (
													<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
												)}
											</div>
										)}
									</form.Field>

									<form.Field
										name="appleKeyId"
										validators={{
											onChange: ({ value }) => {
												if (!isEditing && !value) {
													return "Key ID is required for Apple";
												}
												return undefined;
											},
										}}
									>
										{(field) => (
											<div className="space-y-2">
												<Label htmlFor="appleKeyId">Key ID</Label>
												<Input
													id="appleKeyId"
													placeholder="ZYXW9876VU"
													value={field.state.value}
													onChange={(e) => field.handleChange(e.target.value)}
													onBlur={field.handleBlur}
												/>
												<p className="text-sm text-muted-foreground">
													The Key ID associated with your private key
												</p>
												{field.state.meta.errors.length > 0 && (
													<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
												)}
											</div>
										)}
									</form.Field>
								</>
							)
						}
					</form.Subscribe>

					{isEditing && (
						<form.Field name="isActive">
							{(field) => (
								<div className="flex items-center justify-between">
									<div className="space-y-0.5">
										<Label htmlFor="isActive">Active</Label>
										<p className="text-sm text-muted-foreground">Enable or disable this provider</p>
									</div>
									<Switch
										id="isActive"
										checked={field.state.value}
										onCheckedChange={field.handleChange}
									/>
								</div>
							)}
						</form.Field>
					)}

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={isSubmitting}>
							{isSubmitting
								? isEditing
									? "Updating..."
									: "Adding..."
								: isEditing
									? "Update"
									: "Add Provider"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
