import { useState } from "react";

export interface TwoFactorSetupState {
	isEnabled: boolean;
	setupDialogOpen: boolean;
	backupCodesDialogOpen: boolean;
	disableDialogOpen: boolean;
	totpUri: string;
	backupCodes: string[];
	otpValue: string;
	password: string;
	showPasswordDialog: boolean;
	disablePassword: string;
	regeneratePassword: string;
	showRegenerateDialog: boolean;
}

export interface TwoFactorSetupActions {
	setIsEnabled: (value: boolean) => void;
	setSetupDialogOpen: (value: boolean) => void;
	setBackupCodesDialogOpen: (value: boolean) => void;
	setDisableDialogOpen: (value: boolean) => void;
	setTotpUri: (value: string) => void;
	setBackupCodes: (value: string[]) => void;
	setOtpValue: (value: string) => void;
	setPassword: (value: string) => void;
	setShowPasswordDialog: (value: boolean) => void;
	setDisablePassword: (value: string) => void;
	setRegeneratePassword: (value: string) => void;
	setShowRegenerateDialog: (value: boolean) => void;
}

export function useTwoFactorSetupState(initialIsEnabled: boolean): {
	state: TwoFactorSetupState;
	actions: TwoFactorSetupActions;
} {
	const [isEnabled, setIsEnabled] = useState(initialIsEnabled);
	const [setupDialogOpen, setSetupDialogOpen] = useState(false);
	const [backupCodesDialogOpen, setBackupCodesDialogOpen] = useState(false);
	const [disableDialogOpen, setDisableDialogOpen] = useState(false);
	const [totpUri, setTotpUri] = useState("");
	const [backupCodes, setBackupCodes] = useState<string[]>([]);
	const [otpValue, setOtpValue] = useState("");
	const [password, setPassword] = useState("");
	const [showPasswordDialog, setShowPasswordDialog] = useState(false);
	const [disablePassword, setDisablePassword] = useState("");
	const [regeneratePassword, setRegeneratePassword] = useState("");
	const [showRegenerateDialog, setShowRegenerateDialog] = useState(false);

	return {
		state: {
			isEnabled,
			setupDialogOpen,
			backupCodesDialogOpen,
			disableDialogOpen,
			totpUri,
			backupCodes,
			otpValue,
			password,
			showPasswordDialog,
			disablePassword,
			regeneratePassword,
			showRegenerateDialog,
		},
		actions: {
			setIsEnabled,
			setSetupDialogOpen,
			setBackupCodesDialogOpen,
			setDisableDialogOpen,
			setTotpUri,
			setBackupCodes,
			setOtpValue,
			setPassword,
			setShowPasswordDialog,
			setDisablePassword,
			setRegeneratePassword,
			setShowRegenerateDialog,
		},
	};
}
