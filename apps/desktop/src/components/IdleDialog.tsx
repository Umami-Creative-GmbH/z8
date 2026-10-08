import { useEffect, useRef } from "react";
import { useI18n } from "../lib/i18n";
import type { IdleEvent } from "../types";
interface IdleDialogProps {
	isOpen: boolean;
	idleEvent: IdleEvent | null;
	onBreak: () => void;
	onResume: () => void;
	isLoading?: boolean;
	canRecord?: boolean;
}
export function IdleDialog(props: IdleDialogProps) {
	return props.isOpen && props.idleEvent ? (
		<IdleQuestion {...props} idleEvent={props.idleEvent} />
	) : null;
}
function IdleQuestion({
	idleEvent,
	onBreak,
	onResume,
	isLoading,
	canRecord = true,
}: IdleDialogProps & { idleEvent: IdleEvent }) {
	const { t, language } = useI18n();
	const dialog = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const modal = dialog.current;
		const previous = document.activeElement;
		modal?.showModal();
		return () => {
			modal?.close();
			if (previous instanceof HTMLElement) previous.focus();
		};
	}, []);
	const format = (instant: string, zone: string | null | undefined) =>
		new Intl.DateTimeFormat(language, {
			timeStyle: "short",
			dateStyle: "medium",
			timeZone: zone ?? "UTC",
		}).format(new Date(instant)) +
		" (" +
		(zone ?? "UTC") +
		")";
	return (
		<dialog
			ref={dialog}
			className="companion-dialog"
			aria-labelledby="idle-heading"
			onCancel={(event) => {
				event.preventDefault();
				if (!isLoading) onResume();
			}}
		>
			<h2 id="idle-heading">{t("Was this a break?")}</h2>
			<p>
				{format(idleEvent.idleStartTime, idleEvent.startTimezone)} –{" "}
				{format(idleEvent.returnedAt, idleEvent.returnTimezone)}
			</p>
			<p className="field-hint">
				{t("Work resumes at the detected return, not when you answer.")}
			</p>
			{idleEvent.review && (
				<p role="alert">
					{t(
						"This interval needs a reviewed correction in Z8. Nothing is recorded automatically.",
					)}
				</p>
			)}
			{!canRecord && !idleEvent.review && (
				<p role="status">{t("Refresh status before confirming a break.")}</p>
			)}
			<div className="dialog-actions">
				{!idleEvent.review && (
					<button
						type="button"
						className="primary-action"
						onClick={onBreak}
						disabled={isLoading || !canRecord}
					>
						{t("I was on break")}
					</button>
				)}
				<button
					type="button"
					className="secondary-action"
					onClick={onResume}
					disabled={isLoading}
				>
					{t(idleEvent.review ? "Continue" : "I was still working")}
				</button>
			</div>
		</dialog>
	);
}
