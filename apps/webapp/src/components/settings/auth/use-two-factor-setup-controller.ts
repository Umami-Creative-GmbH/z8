import { useTransition } from "react";
import { toast } from "sonner";
import { getAuthErrorMessage } from "@/lib/auth/error-message";
import { authClient } from "@/lib/auth-client";
import { useTwoFactorSetupState } from "./use-two-factor-setup-state";

type TranslateFn = (
	key: string,
	defaultValue?: string,
	params?: Record<string, string | number>,
) => string;

export function useTwoFactorSetupController(initialIsEnabled: boolean, t: TranslateFn) {
	const [isPending, startTransition] = useTransition();
	const { state, actions } = useTwoFactorSetupState(initialIsEnabled);

	const handleRequestEnable = () => {
		actions.setShowPasswordDialog(true);
	};

	const handleEnable2FA = () => {
		if (!state.password) {
			toast.error(t("settings.security.twoFactor.passwordRequired", "Password required"), {
				description: t(
					"settings.security.twoFactor.enablePasswordRequiredDescription",
					"Please enter your password to enable 2FA",
				),
			});
			return;
		}

		startTransition(async () => {
			try {
				const result = await authClient.twoFactor.enable({
					password: state.password,
				});

				if (result.error) {
					toast.error(t("settings.security.twoFactor.setupFailed", "Failed to setup 2FA"), {
						description: getAuthErrorMessage(
							result.error,
							t("settings.security.twoFactor.setupFailed", "Failed to setup 2FA"),
						),
					});
				} else if (result.data) {
					actions.setTotpUri(result.data.totpURI);
					actions.setBackupCodes(result.data.backupCodes);
					actions.setShowPasswordDialog(false);
					actions.setSetupDialogOpen(true);
					actions.setPassword("");
				}
			} catch (error) {
				toast.error(t("settings.security.twoFactor.setupFailed", "Failed to setup 2FA"), {
					description:
						error instanceof Error
							? error.message
							: t("settings.security.twoFactor.unexpectedError", "An unexpected error occurred"),
				});
			}
		});
	};

	const handleVerifyAndEnable = () => {
		if (state.otpValue.length !== 6) {
			toast.error(t("settings.security.twoFactor.invalidCode", "Invalid code"), {
				description: t(
					"settings.security.twoFactor.enterSixDigitCode",
					"Please enter a 6-digit code",
				),
			});
			return;
		}

		startTransition(async () => {
			try {
				const result = await authClient.twoFactor.verifyTotp({
					code: state.otpValue,
				});

				if (result.error) {
					toast.error(t("settings.security.twoFactor.verificationFailed", "Verification failed"), {
						description: getAuthErrorMessage(
							result.error,
							t("settings.security.twoFactor.verificationFailed", "Verification failed"),
						),
					});
				} else {
					actions.setSetupDialogOpen(false);
					actions.setBackupCodesDialogOpen(true);
					actions.setOtpValue("");
					actions.setIsEnabled(true);
					toast.success(
						t("settings.security.twoFactor.enabledToast", "Two-factor authentication enabled"),
					);
				}
			} catch (error) {
				toast.error(t("settings.security.twoFactor.verificationFailed", "Verification failed"), {
					description:
						error instanceof Error
							? error.message
							: t("settings.security.twoFactor.unexpectedError", "An unexpected error occurred"),
				});
			}
		});
	};

	const handleDisable2FA = () => {
		if (!state.disablePassword) {
			toast.error(t("settings.security.twoFactor.passwordRequired", "Password required"));
			return;
		}

		startTransition(async () => {
			try {
				const result = await authClient.twoFactor.disable({
					password: state.disablePassword,
				});

				if (result.error) {
					toast.error(t("settings.security.twoFactor.disableFailed", "Failed to disable 2FA"), {
						description: getAuthErrorMessage(
							result.error,
							t("settings.security.twoFactor.disableFailed", "Failed to disable 2FA"),
						),
					});
				} else {
					actions.setDisableDialogOpen(false);
					actions.setDisablePassword("");
					actions.setIsEnabled(false);
					toast.success(
						t("settings.security.twoFactor.disabledToast", "Two-factor authentication disabled"),
					);
				}
			} catch (error) {
				toast.error(t("settings.security.twoFactor.disableFailed", "Failed to disable 2FA"), {
					description:
						error instanceof Error
							? error.message
							: t("settings.security.twoFactor.unexpectedError", "An unexpected error occurred"),
				});
			}
		});
	};

	const handleRequestRegenerate = () => {
		actions.setShowRegenerateDialog(true);
	};

	const handleRegenerateBackupCodes = () => {
		if (!state.regeneratePassword) {
			toast.error(t("settings.security.twoFactor.passwordRequired", "Password required"));
			return;
		}

		startTransition(async () => {
			try {
				const result = await authClient.twoFactor.generateBackupCodes({
					password: state.regeneratePassword,
				});

				if (result.error) {
					toast.error(
						t("settings.security.twoFactor.regenerateFailed", "Failed to regenerate backup codes"),
						{
							description: getAuthErrorMessage(
								result.error,
								t(
									"settings.security.twoFactor.regenerateFailed",
									"Failed to regenerate backup codes",
								),
							),
						},
					);
				} else if (result.data) {
					actions.setBackupCodes(result.data.backupCodes);
					actions.setShowRegenerateDialog(false);
					actions.setBackupCodesDialogOpen(true);
					actions.setRegeneratePassword("");
					toast.success(
						t("settings.security.twoFactor.backupCodesRegenerated", "Backup codes regenerated"),
					);
				}
			} catch (error) {
				toast.error(
					t("settings.security.twoFactor.regenerateFailed", "Failed to regenerate backup codes"),
					{
						description:
							error instanceof Error
								? error.message
								: t(
										"settings.security.twoFactor.unexpectedError",
										"An unexpected error occurred",
									),
					},
				);
			}
		});
	};

	const handleCopyBackupCodes = () => {
		void navigator.clipboard.writeText(state.backupCodes.join("\n"));
		toast.success(
			t("settings.security.twoFactor.backupCodesCopied", "Backup codes copied to clipboard"),
		);
	};

	return {
		isPending,
		state,
		actions,
		handlers: {
			handleRequestEnable,
			handleEnable2FA,
			handleVerifyAndEnable,
			handleDisable2FA,
			handleRequestRegenerate,
			handleRegenerateBackupCodes,
			handleCopyBackupCodes,
		},
	};
}
