"use client";

import {
	IconAlertTriangle,
	IconCheck,
	IconCopy,
	IconLoader2,
	IconPlugConnected,
	IconPlugConnectedX,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import type {
	DiscordConnectFormValues,
	DiscordConnectResult,
	DiscordNotificationChannelConfig,
	NotificationChannelSettingsFormValues,
} from "@/app/[locale]/(app)/settings/notification-channels/actions";
import {
	ConfirmActionDialog,
	useConfirmedAction,
} from "@/components/settings/confirm-action-dialog";
import { describeFailure } from "@/components/settings/confirm-action-utils";
import { NotificationChannelSettings } from "@/components/settings/notification-channel-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import type { ServerActionResult } from "@/lib/effect/result";
import {
	actionErrorMessage,
	type RefusalMessages,
} from "@/lib/organization-action/action-error-message";

const DISCORD_CONNECT_REFUSALS = {
	invalid_bot_token: [
		"settings.discord.errors.invalidBotToken",
		"Invalid bot token. Check your Discord bot credentials and try again.",
	],
	application_id_mismatch: [
		"settings.discord.errors.applicationIdMismatch",
		"Application ID does not match the provided bot token.",
	],
	public_key_mismatch: [
		"settings.discord.errors.publicKeyMismatch",
		"Public key does not match the Discord application.",
	],
} satisfies RefusalMessages<
	"invalid_bot_token" | "application_id_mismatch" | "public_key_mismatch"
>;

const DEFAULT_DISCORD_FEATURES: NotificationChannelSettingsFormValues = {
	enableApprovals: true,
	enableCommands: true,
	enableDailyDigest: true,
	enableEscalations: true,
	digestTime: "08:00",
	digestTimezone: "UTC",
	escalationTimeoutHours: 24,
};

interface DiscordChannelSettingsProps {
	config: DiscordNotificationChannelConfig | null;
	updateAction: (
		settings: NotificationChannelSettingsFormValues,
	) => Promise<ServerActionResult<undefined>>;
	connectAction: (
		credentials: DiscordConnectFormValues,
	) => Promise<ServerActionResult<DiscordConnectResult>>;
	disconnectAction: () => Promise<ServerActionResult<undefined>>;
}

function DiscordConnectForm({
	connectAction,
	onConnected,
}: {
	connectAction: (
		credentials: DiscordConnectFormValues,
	) => Promise<ServerActionResult<DiscordConnectResult>>;
	onConnected: (result: DiscordConnectResult) => void;
}) {
	const { t } = useTranslate();
	const [submitError, setSubmitError] = useState<string | null>(null);

	const connectMutation = useMutation({
		mutationFn: (credentials: DiscordConnectFormValues) => connectAction(credentials),
	});

	const form = useForm({
		defaultValues: {
			botToken: "",
			applicationId: "",
			publicKey: "",
		} satisfies DiscordConnectFormValues,
		onSubmit: async ({ value }) => {
			setSubmitError(null);
			const payload: DiscordConnectFormValues = {
				botToken: value.botToken.trim(),
				applicationId: value.applicationId.trim(),
				publicKey: value.publicKey.trim(),
			};

			let result: ServerActionResult<DiscordConnectResult>;
			try {
				result = await connectMutation.mutateAsync(payload);
			} catch {
				const message = t("settings.discord.connectError", "Failed to connect Discord bot");
				setSubmitError(message);
				toast.error(message);
				return;
			}

			if (result.success) {
				if (result.data.commandsRegistered) {
					toast.success(t("settings.discord.connected", "Discord bot connected successfully"));
				} else {
					toast.warning(
						t(
							"settings.discord.commandsRegistrationFailed",
							"Discord bot connected, but slash commands could not be registered automatically. Verify your bot permissions, then disconnect and connect the bot again to retry.",
						),
					);
				}
				onConnected(result.data);
				return;
			}

			const message = actionErrorMessage(t, result, DISCORD_CONNECT_REFUSALS, [
				"settings.discord.connectError",
				"Failed to connect Discord bot",
			]);
			setSubmitError(message);
			toast.error(message);
		},
	});

	const isSubmitting =
		useStore(form.store, (state) => state.isSubmitting) || connectMutation.isPending;

	return (
		<form
			className="space-y-4 border-t pt-4"
			onSubmit={(event) => {
				event.preventDefault();
				form.handleSubmit();
			}}
		>
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.discord.connectDescription",
					"Enter the credentials from your Discord application in the Discord Developer Portal.",
				)}
			</p>

			<form.Field
				name="botToken"
				validators={{
					onBlur: ({ value }) =>
						value.trim()
							? undefined
							: t("settings.discord.validation.botTokenRequired", "Bot token is required."),
				}}
			>
				{(field) => {
					const hasError = fieldHasError(field);
					return (
						<TFormItem>
							<TFormLabel hasError={hasError} required>
								{t("settings.discord.botToken", "Bot Token")}
							</TFormLabel>
							<TFormControl hasError={hasError}>
								<Input
									name="botToken"
									type="password"
									value={field.state.value}
									onChange={(event) => {
										setSubmitError(null);
										field.handleChange(event.target.value);
									}}
									onBlur={field.handleBlur}
									disabled={isSubmitting}
									autoComplete="off"
									spellCheck={false}
								/>
							</TFormControl>
							<TFormDescription>
								{t(
									"settings.discord.botTokenHelp",
									"Stored encrypted in Vault and used to validate and operate your bot.",
								)}
							</TFormDescription>
							<TFormMessage field={field} />
						</TFormItem>
					);
				}}
			</form.Field>

			<div className="grid gap-4 sm:grid-cols-2">
				<form.Field
					name="applicationId"
					validators={{
						onBlur: ({ value }) => {
							const trimmed = value.trim();
							if (!trimmed) {
								return t(
									"settings.discord.validation.applicationIdRequired",
									"Application ID is required.",
								);
							}
							if (!/^\d+$/.test(trimmed)) {
								return t(
									"settings.discord.validation.applicationIdInvalid",
									"Application ID must contain digits only.",
								);
							}
							return undefined;
						},
					}}
				>
					{(field) => {
						const hasError = fieldHasError(field);
						return (
							<TFormItem>
								<TFormLabel hasError={hasError} required>
									{t("settings.discord.applicationId", "Application ID")}
								</TFormLabel>
								<TFormControl hasError={hasError}>
									<Input
										name="applicationId"
										inputMode="numeric"
										value={field.state.value}
										onChange={(event) => {
											setSubmitError(null);
											field.handleChange(event.target.value);
										}}
										onBlur={field.handleBlur}
										disabled={isSubmitting}
										autoComplete="off"
										spellCheck={false}
									/>
								</TFormControl>
								<TFormMessage field={field} />
							</TFormItem>
						);
					}}
				</form.Field>

				<form.Field
					name="publicKey"
					validators={{
						onBlur: ({ value }) => {
							const trimmed = value.trim();
							if (!trimmed) {
								return t(
									"settings.discord.validation.publicKeyRequired",
									"Public key is required.",
								);
							}
							if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
								return t(
									"settings.discord.validation.publicKeyInvalid",
									"Public key must be a 64-character hexadecimal string.",
								);
							}
							return undefined;
						},
					}}
				>
					{(field) => {
						const hasError = fieldHasError(field);
						return (
							<TFormItem>
								<TFormLabel hasError={hasError} required>
									{t("settings.discord.publicKey", "Public Key")}
								</TFormLabel>
								<TFormControl hasError={hasError}>
									<Input
										name="publicKey"
										value={field.state.value}
										onChange={(event) => {
											setSubmitError(null);
											field.handleChange(event.target.value);
										}}
										onBlur={field.handleBlur}
										disabled={isSubmitting}
										autoComplete="off"
										spellCheck={false}
									/>
								</TFormControl>
								<TFormMessage field={field} />
							</TFormItem>
						);
					}}
				</form.Field>
			</div>

			{submitError ? (
				<p role="alert" className="text-sm text-destructive">
					{submitError}
				</p>
			) : null}

			<div>
				<Button type="submit" disabled={isSubmitting}>
					{isSubmitting ? (
						<IconLoader2 className="mr-2 size-4 motion-safe:animate-spin" aria-hidden="true" />
					) : (
						<IconPlugConnected className="mr-2 size-4" aria-hidden="true" />
					)}
					{t("settings.discord.connect", "Connect Discord Bot")}
				</Button>
			</div>
		</form>
	);
}

function DiscordConnectedDetails({
	applicationId,
	interactionUrl,
	commandsRegistrationWarning,
	disconnectAction,
	onDisconnected,
}: {
	applicationId: string | null;
	interactionUrl: string | null;
	commandsRegistrationWarning: boolean;
	disconnectAction: () => Promise<ServerActionResult<undefined>>;
	onDisconnected: () => void;
}) {
	const { t } = useTranslate();
	const interactionUrlId = useId();
	const [copied, setCopied] = useState(false);
	const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const disconnection = useConfirmedAction<"bot">();

	useEffect(() => {
		return () => {
			if (copyResetTimerRef.current !== null) {
				clearTimeout(copyResetTimerRef.current);
			}
		};
	}, []);

	const disconnectMutation = useMutation({
		mutationFn: async () => {
			const result = await disconnectAction();
			if (!result.success) {
				throw new Error(
					actionErrorMessage(t, result, {}, [
						"settings.discord.disconnectError",
						"Failed to disconnect Discord bot",
					]),
				);
			}
		},
		onSuccess: () => {
			toast.success(t("settings.discord.disconnected", "Discord bot disconnected"));
			onDisconnected();
		},
	});

	const handleCopyUrl = async () => {
		if (!interactionUrl) return;
		try {
			await navigator.clipboard.writeText(interactionUrl);
		} catch {
			toast.error(
				t(
					"settings.discord.copyInteractionUrlFailed",
					"The Interaction Endpoint URL could not be copied. Select it and copy it manually.",
				),
			);
			return;
		}
		setCopied(true);
		toast.success(t("settings.discord.interactionUrlCopied", "Interaction Endpoint URL copied"));
		if (copyResetTimerRef.current !== null) {
			clearTimeout(copyResetTimerRef.current);
		}
		copyResetTimerRef.current = setTimeout(() => {
			setCopied(false);
			copyResetTimerRef.current = null;
		}, 2000);
	};

	return (
		<div className="space-y-4 border-t pt-4">
			{commandsRegistrationWarning ? (
				<div
					role="status"
					className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
				>
					<IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
					<p>
						{t(
							"settings.discord.commandsRegistrationFailed",
							"Discord bot connected, but slash commands could not be registered automatically. Verify your bot permissions, then disconnect and connect the bot again to retry.",
						)}
					</p>
				</div>
			) : null}

			{interactionUrl ? (
				<div className="space-y-2">
					<Label htmlFor={interactionUrlId}>
						{t("settings.discord.interactionEndpointUrl", "Interaction Endpoint URL")}
					</Label>
					<div className="flex flex-col gap-2 sm:flex-row">
						<Input
							id={interactionUrlId}
							value={interactionUrl}
							readOnly
							className="font-mono text-xs"
							onFocus={(event) => event.target.select()}
						/>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="shrink-0"
							onClick={handleCopyUrl}
							aria-label={t("settings.discord.copyInteractionUrl", "Copy Interaction Endpoint URL")}
						>
							{copied ? (
								<IconCheck className="mr-2 size-4" aria-hidden="true" />
							) : (
								<IconCopy className="mr-2 size-4" aria-hidden="true" />
							)}
							{copied ? t("settings.discord.copied", "Copied") : t("settings.discord.copy", "Copy")}
						</Button>
					</div>
					<p className="text-xs text-muted-foreground">
						{t(
							"settings.discord.interactionEndpointHelp",
							"Paste this URL into the Interactions Endpoint URL field in your Discord Developer Portal application.",
						)}
					</p>
				</div>
			) : null}

			<div className="flex justify-end">
				<Button
					type="button"
					variant="destructive"
					size="sm"
					disabled={disconnection.isPending}
					onClick={() => disconnection.request("bot")}
				>
					{disconnection.isPending ? (
						<IconLoader2 className="mr-2 size-4 motion-safe:animate-spin" aria-hidden="true" />
					) : (
						<IconPlugConnectedX className="mr-2 size-4" aria-hidden="true" />
					)}
					{t("settings.discord.disconnect", "Disconnect")}
				</Button>
			</div>

			<ConfirmActionDialog
				open={disconnection.open}
				onOpenChange={disconnection.onOpenChange}
				title={t("settings.discord.disconnectConfirm.title", "Disconnect Discord Bot?")}
				description={
					<>
						{applicationId ? (
							<span className="mb-2 block break-words font-medium text-foreground">
								{applicationId}
							</span>
						) : null}
						{t(
							"settings.discord.disconnectConfirm.description",
							"This will remove the stored bot token and disable Discord notifications and slash commands for your organization.",
						)}
					</>
				}
				confirmLabel={t("settings.discord.disconnect", "Disconnect")}
				isPending={disconnection.isPending}
				error={disconnection.error}
				onConfirm={() =>
					void disconnection.confirm(
						() => disconnectMutation.mutateAsync(),
						(failure) =>
							describeFailure(
								failure,
								t("settings.discord.disconnectError", "Failed to disconnect Discord bot"),
							),
					)
				}
			/>
		</div>
	);
}

export function DiscordChannelSettings({
	config: initialConfig,
	updateAction,
	connectAction,
	disconnectAction,
}: DiscordChannelSettingsProps) {
	const router = useRouter();
	const [override, setOverride] = useState<{
		base: DiscordNotificationChannelConfig | null;
		value: DiscordNotificationChannelConfig | null;
	} | null>(null);
	const [commandsRegistrationWarning, setCommandsRegistrationWarning] = useState(false);

	const config = override && override.base === initialConfig ? override.value : initialConfig;

	const handleConnected = (result: DiscordConnectResult) => {
		setCommandsRegistrationWarning(!result.commandsRegistered);
		setOverride({
			base: initialConfig,
			value: {
				...(config ?? DEFAULT_DISCORD_FEATURES),
				setupStatus: "active",
				displayName: result.applicationId,
				interactionUrl: result.interactionUrl,
			},
		});
		router.refresh();
	};

	const handleDisconnected = () => {
		setCommandsRegistrationWarning(false);
		setOverride({
			base: initialConfig,
			value: config
				? {
						...config,
						setupStatus: "disconnected",
						interactionUrl: null,
					}
				: null,
		});
		router.refresh();
	};

	return (
		<NotificationChannelSettings
			key={config?.setupStatus ?? "unconfigured"}
			channelName="Discord"
			config={config}
			updateAction={updateAction}
			connectAction={
				<DiscordConnectForm connectAction={connectAction} onConnected={handleConnected} />
			}
			connectedAction={
				<DiscordConnectedDetails
					applicationId={config?.displayName ?? null}
					interactionUrl={config?.interactionUrl ?? null}
					commandsRegistrationWarning={commandsRegistrationWarning}
					disconnectAction={disconnectAction}
					onDisconnected={handleDisconnected}
				/>
			}
		/>
	);
}
