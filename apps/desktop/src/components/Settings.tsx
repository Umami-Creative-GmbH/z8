import { useEffect, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { IconX, IconLogout2 } from "@tabler/icons-react";
import type { Settings as SettingsType } from "../types";
import { useI18n } from "../lib/i18n";
import { UpdateCheck } from "./UpdateCheck";
interface SettingsProps {
	isOpen: boolean;
	onClose: () => void;
	settings: SettingsType | undefined;
	onSave: (settings: Omit<SettingsType, "version">) => Promise<void>;
	onLogout: () => Promise<void>;
	isSaving: boolean;
	isAuthenticated: boolean;
}
export function Settings(props: SettingsProps) {
	return props.isOpen && props.settings ? (
		<SettingsForm
			key={JSON.stringify(props.settings)}
			{...props}
			settings={props.settings}
		/>
	) : null;
}
function SettingsForm({
	settings,
	onSave,
	onClose,
	onLogout,
	isSaving,
	isAuthenticated,
}: SettingsProps & { settings: SettingsType }) {
	const { t } = useI18n();
	const modal = useRef<HTMLDialogElement>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		const dialog = modal.current;
		const previous = document.activeElement;
		dialog?.showModal();
		return () => {
			dialog?.close();
			if (previous instanceof HTMLElement) previous.focus();
		};
	}, []);
	const form = useForm({
		defaultValues: {
			webappUrl: settings.webappUrl,
			alwaysOnTop: settings.alwaysOnTop,
			autoStartup: settings.autoStartup,
			idleEnabled: settings.idleEnabled,
			idleThresholdMinutes: settings.idleThresholdMinutes,
			language: settings.language,
		},
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				await onSave(value);
				onClose();
			} catch (error) {
				setError(String(error));
			}
		},
	});
	const signOut = async () => {
		try {
			await onLogout();
			onClose();
		} catch (error) {
			setError(String(error));
		}
	};
	return (
		<dialog
			ref={modal}
			className="companion-dialog"
			aria-labelledby="settings-heading"
			onCancel={(event) => {
				event.preventDefault();
				if (!isSaving) onClose();
			}}
		>
			<header className="dialog-header">
				<h2 id="settings-heading">{t("Settings")}</h2>
				<button
					type="button"
					className="settings-button"
					aria-label={t("Close settings")}
					disabled={isSaving}
					onClick={onClose}
				>
					<IconX size={18} aria-hidden="true" />
				</button>
			</header>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					void form.handleSubmit();
				}}
			>
				<form.Field name="webappUrl">
					{(field) => (
						<label className="form-field">
							{t("Server")}
							<input
								name={field.name}
								type="url"
								required
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
								disabled={isSaving}
								autoComplete="url"
							/>
						</label>
					)}
				</form.Field>
				<form.Field name="alwaysOnTop">
					{(field) => (
						<label className="form-toggle">
							<input
								name={field.name}
								type="checkbox"
								checked={field.state.value}
								onChange={(event) => field.handleChange(event.target.checked)}
								disabled={isSaving}
							/>
							{t("Always on top")}
						</label>
					)}
				</form.Field>
				<form.Field name="autoStartup">
					{(field) => (
						<label className="form-toggle">
							<input
								name={field.name}
								type="checkbox"
								checked={field.state.value}
								onChange={(event) => field.handleChange(event.target.checked)}
								disabled={isSaving}
							/>
							{t("Launch at Windows sign-in")}
						</label>
					)}
				</form.Field>
				<form.Field name="idleEnabled">
					{(field) => (
						<label className="form-toggle">
							<input
								name={field.name}
								type="checkbox"
								checked={field.state.value}
								onChange={(event) => field.handleChange(event.target.checked)}
								disabled={isSaving}
							/>
							{t("Idle reminders")}
						</label>
					)}
				</form.Field>
				<p className="field-hint">
					{t("Inactivity is not recorded until you confirm a break.")}
				</p>
				<form.Field name="idleThresholdMinutes">
					{(field) => (
						<label className="form-field">
							{t("Minutes before reminder")}
							<input
								name={field.name}
								type="number"
								required
								min={1}
								max={240}
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) =>
									field.handleChange(event.target.valueAsNumber)
								}
								disabled={isSaving}
							/>
						</label>
					)}
				</form.Field>
				<form.Field name="language">
					{(field) => (
						<label className="form-field">
							{t("Language")}
							<select
								name={field.name}
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								disabled={isSaving}
							>
								<option value="auto">{t("Z8 preference")}</option>
								<option value="de">{t("German")}</option>
								<option value="en">{t("English")}</option>
							</select>
						</label>
					)}
				</form.Field>
				{error && (
					<p role="alert" className="login-error">
						{t("Preferences could not be saved")}: {error}
					</p>
				)}
				<div className="dialog-actions">
					<button
						type="button"
						className="secondary-action"
						disabled={isSaving}
						onClick={onClose}
					>
						{t("Cancel")}
					</button>
					<button type="submit" className="primary-action" disabled={isSaving}>
						{t(isSaving ? "Processing…" : "Save")}
					</button>
				</div>
			</form>
			<UpdateCheck />
			<div className="settings-footer">
				<span>z8 Timer {settings.version}</span>
				{isAuthenticated && (
					<button
						type="button"
						className="secondary-action"
						disabled={isSaving}
						onClick={signOut}
					>
						<IconLogout2 size={16} aria-hidden="true" />
						{t("Sign out")}
					</button>
				)}
			</div>
		</dialog>
	);
}
