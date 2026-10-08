import { useEffect, useRef } from "react";
import { useI18n } from "../lib/i18n";
export function TimezoneDialog({
	deviceZone,
	savedZone,
	onContinue,
	onCancel,
	onUpdate,
}: {
	deviceZone: string | undefined;
	savedZone: string | undefined;
	onContinue: () => Promise<void>;
	onCancel: () => void;
	onUpdate: () => Promise<void>;
}) {
	const { t } = useI18n();
	const modal = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		if (!deviceZone) return;
		const previous = document.activeElement;
		modal.current?.showModal();
		return () => {
			modal.current?.close();
			if (previous instanceof HTMLElement) previous.focus();
		};
	}, [deviceZone]);
	if (!deviceZone) return null;
	return (
		<dialog
			ref={modal}
			className="companion-dialog"
			aria-labelledby="timezone-heading"
			onCancel={(event) => {
				event.preventDefault();
				onCancel();
			}}
		>
			<h2 id="timezone-heading">{t("Your device timezone has changed")}</h2>
			<p>
				{t("Device timezone")}: {deviceZone}
			</p>
			<p>
				{t("Saved timezone")}: {savedZone}
			</p>
			<p className="field-hint">
				{t(
					"This action uses the device timezone. Your day total uses your saved timezone.",
				)}
			</p>
			<div className="dialog-actions">
				<button type="button" className="secondary-action" onClick={onCancel}>
					{t("Cancel")}
				</button>
				<button type="button" className="secondary-action" onClick={onUpdate}>
					{t("Update saved timezone in Z8")}
				</button>
				<button type="button" className="primary-action" onClick={onContinue}>
					{t("Continue once")}
				</button>
			</div>
		</dialog>
	);
}
