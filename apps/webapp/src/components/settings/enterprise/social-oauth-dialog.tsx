"use client";

import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	addSocialOAuthConfigAction,
	type SocialOAuthConfigResponse,
	updateSocialOAuthConfigAction,
} from "@/app/[locale]/(app)/settings/enterprise/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Apple } from "@/components/ui/svgs/apple";
import { GithubDark } from "@/components/ui/svgs/githubDark";
import { Google } from "@/components/ui/svgs/google";
import { Linkedin } from "@/components/ui/svgs/linkedin";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { SocialOAuthProvider } from "@/db/schema";

interface SocialOAuthDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	availableProviders?: SocialOAuthProvider[];
	editConfig?: SocialOAuthConfigResponse;
	onConfigAdded?: (config: SocialOAuthConfigResponse) => void;
	onConfigUpdated?: (config: SocialOAuthConfigResponse) => void;
}

const EMPTY_PROVIDERS: SocialOAuthProvider[] = [];

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
	availableProviders = EMPTY_PROVIDERS,
	editConfig,
	onConfigAdded,
	onConfigUpdated,
}: SocialOAuthDialogProps) {
	const { t } = useTranslate();
	const [isSubmitting, setIsSubmitting] = useState(false);
	const isEditing = !!editConfig;

	const handleSubmissionError = (error: unknown) => {
		if (error instanceof Error) {
			toast.error(error.message);
			return;
		}

		toast.error(
			isEditing
				? t("settings.enterprise.socialOAuth.updateConfigError", "Failed to update config")
				: t("settings.enterprise.socialOAuth.addProviderError", "Failed to add provider"),
		);
	};

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
				}).catch((error: unknown) => {
					handleSubmissionError(error);
					return null;
				});

				if (!updated) {
					setIsSubmitting(false);
					return;
				}

				onConfigUpdated?.(updated);
				form.reset();
				setIsSubmitting(false);
				return;
			}

			if (!value.clientSecret) {
				toast.error(t("settings.enterprise.clientSecretRequired", "Client Secret is required"));
				setIsSubmitting(false);
				return;
			}

			const config = await addSocialOAuthConfigAction({
				provider: value.provider as SocialOAuthProvider,
				clientId: value.clientId,
				clientSecret: value.clientSecret,
				providerConfig,
			}).catch((error: unknown) => {
				handleSubmissionError(error);
				return null;
			});

			if (!config) {
				setIsSubmitting(false);
				return;
			}

			onConfigAdded?.(config);
			form.reset();
			setIsSubmitting(false);
		},
	});

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{isEditing
							? t("settings.enterprise.socialOAuth.editTitle", "Edit {provider} OAuth", {
									provider: PROVIDER_INFO[editConfig.provider].name,
								})
							: t("settings.enterprise.socialOAuth.addTitle", "Add Social OAuth Provider")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{isEditing
							? t(
									"settings.enterprise.socialOAuth.editDescription",
									"Update your OAuth credentials.",
								)
							: t(
									"settings.enterprise.socialOAuth.addDescription",
									"Configure your own OAuth app for social login.",
								)}
					</ActionPanelDescription>
				</ActionPanelHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
					className="flex min-h-0 flex-1 flex-col"
				>
					<ActionPanelBody className="space-y-4">
						{!isEditing && (
							<form.Field name="provider">
								{(field) => {
									const providerInfo = PROVIDER_INFO[field.state.value as SocialOAuthProvider];
									return (
										<div className="space-y-2">
											<Label htmlFor="provider">
												{t("settings.enterprise.provider", "Provider")}
											</Label>
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
																	<info.icon className="size-4" />
																	{info.name}
																</div>
															</SelectItem>
														);
													})}
												</SelectContent>
											</Select>
											{providerInfo && (
												<p className="text-sm text-muted-foreground">
													{t(
														"settings.enterprise.socialOAuth.createAppAt",
														"Create an OAuth app at",
													)}{" "}
													<a
														href={providerInfo.docsUrl}
														target="_blank"
														rel="noopener noreferrer"
														className="text-primary underline"
													>
														{t(
															"settings.enterprise.socialOAuth.developerConsole",
															"{provider} Developer Console",
															{ provider: providerInfo.name },
														)}
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
									if (!value)
										return t("settings.enterprise.clientIdRequired", "Client ID is required");
									return undefined;
								},
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="clientId">{t("settings.enterprise.clientId", "Client ID")}</Label>
									<Input
										id="clientId"
										placeholder={t(
											"settings.enterprise.socialOAuth.clientIdPlaceholder",
											"Your OAuth client ID",
										)}
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
											if (!isEditing && !value)
												return t(
													"settings.enterprise.clientSecretRequired",
													"Client Secret is required",
												);
											return undefined;
										},
									}}
								>
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor="clientSecret">
												{selectedProvider === "apple"
													? t("settings.enterprise.socialOAuth.privateKey", "Private Key (.p8)")
													: t("settings.enterprise.clientSecret", "Client Secret")}
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
														isEditing
															? t(
																	"settings.enterprise.leaveBlankKeepExisting",
																	"Leave blank to keep existing",
																)
															: t(
																	"settings.enterprise.socialOAuth.clientSecretPlaceholder",
																	"Your OAuth client secret",
																)
													}
													value={field.state.value}
													onChange={(e) => field.handleChange(e.target.value)}
													onBlur={field.handleBlur}
												/>
											)}
											{isEditing && (
												<p className="text-sm text-muted-foreground">
													{t(
														"settings.enterprise.keepExistingSecretHelp",
														"Leave blank to keep the existing secret",
													)}
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
														return t(
															"settings.enterprise.socialOAuth.appleTeamIdRequired",
															"Team ID is required for Apple",
														);
													}
													return undefined;
												},
											}}
										>
											{(field) => (
												<div className="space-y-2">
													<Label htmlFor="appleTeamId">
														{t("settings.enterprise.socialOAuth.teamId", "Team ID")}
													</Label>
													<Input
														id="appleTeamId"
														placeholder="ABCD1234EF"
														value={field.state.value}
														onChange={(e) => field.handleChange(e.target.value)}
														onBlur={field.handleBlur}
													/>
													<p className="text-sm text-muted-foreground">
														{t(
															"settings.enterprise.socialOAuth.appleTeamIdHelp",
															"Found in your Apple Developer account",
														)}
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
														return t(
															"settings.enterprise.socialOAuth.appleKeyIdRequired",
															"Key ID is required for Apple",
														);
													}
													return undefined;
												},
											}}
										>
											{(field) => (
												<div className="space-y-2">
													<Label htmlFor="appleKeyId">
														{t("settings.enterprise.socialOAuth.keyId", "Key ID")}
													</Label>
													<Input
														id="appleKeyId"
														placeholder="ZYXW9876VU"
														value={field.state.value}
														onChange={(e) => field.handleChange(e.target.value)}
														onBlur={field.handleBlur}
													/>
													<p className="text-sm text-muted-foreground">
														{t(
															"settings.enterprise.socialOAuth.appleKeyIdHelp",
															"The Key ID associated with your private key",
														)}
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
											<Label htmlFor="isActive">{t("common.active", "Active")}</Label>
											<p className="text-sm text-muted-foreground">
												{t(
													"settings.enterprise.enableProviderHelp",
													"Enable or disable this provider",
												)}
											</p>
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
					</ActionPanelBody>

					<ActionPanelFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={isSubmitting}>
							{isSubmitting
								? isEditing
									? t("common.updating", "Updating...")
									: t("common.adding", "Adding...")
								: isEditing
									? t("common.update", "Update")
									: t("settings.enterprise.addProvider", "Add Provider")}
						</Button>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
