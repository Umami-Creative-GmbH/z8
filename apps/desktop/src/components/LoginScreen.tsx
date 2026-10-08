import { useState } from "react";
import {
	IconLogin2,
	IconSettings,
	IconLoader2,
	IconClock,
} from "@tabler/icons-react";
import { useTheme } from "../hooks/useTheme";
import { useI18n } from "../lib/i18n";
import { ThemeToggle } from "./ThemeToggle";
interface LoginScreenProps {
	webappUrl: string;
	authError: string | null;
	onLogin: () => Promise<void>;
	onOpenSettings: () => void;
}
export function LoginScreen({
	webappUrl,
	authError,
	onLogin,
	onOpenSettings,
}: LoginScreenProps) {
	const { t } = useI18n();
	const [opening, setOpening] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { theme, setTheme, resolvedTheme } = useTheme();
	const login = async () => {
		setOpening(true);
		setError(null);
		try {
			await onLogin();
		} catch (error) {
			setError(String(error));
		} finally {
			setOpening(false);
		}
	};
	return (
		<main className="login-screen">
			<div className="login-header-buttons">
				<ThemeToggle
					theme={theme}
					setTheme={setTheme}
					resolvedTheme={resolvedTheme}
				/>
				<button
					type="button"
					className="settings-button"
					aria-label={t("Open settings")}
					onClick={onOpenSettings}
				>
					<IconSettings size={18} />
				</button>
			</div>
			<div className="login-brand">
				<div className="login-logo">
					<IconClock size={36} aria-hidden="true" />
				</div>
				<h1 className="login-title">z8 Timer</h1>
				<p className="login-subtitle">{t("Your time tracking companion")}</p>
			</div>
			<div className="login-content">
				{webappUrl ? (
					<>
						<button
							type="button"
							onClick={login}
							disabled={opening}
							className="login-button"
						>
							{opening ? (
								<IconLoader2 size={20} className="clock-spinner" />
							) : (
								<IconLogin2 size={20} />
							)}
							{t(opening ? "Opening browser…" : "Sign in with Z8")}
						</button>
						<p className="login-hint">
							{t("Complete sign-in in your browser, then return here.")}
						</p>
						<p className="login-hint server-origin">{webappUrl}</p>
					</>
				) : (
					<p>{t("Configure your Z8 server in settings.")}</p>
				)}
				{(error || authError) && (
					<p role="alert" className="login-error">
						{t("Sign-in failed")}: {error || authError}
					</p>
				)}
			</div>
		</main>
	);
}
