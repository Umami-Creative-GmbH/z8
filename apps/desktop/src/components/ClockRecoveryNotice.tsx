import { useMemo, useState } from "react";
import { isUnresolved } from "../lib/saved-commands";
import { useI18n } from "../lib/i18n";
import type {
	ClockJournal,
	CommandFailure,
	SavedClockCommand,
	WaitingFor,
} from "../types";
interface ClockRecoveryNoticeProps {
	journal: ClockJournal | undefined;
	journalError: boolean;
	actionError: string | null;
	savedCommandError: string | null;
	needsStatusRefresh: boolean;
	onRefresh: () => void;
	onRetry: (id: string) => void;
	onArchive: (id: string) => void;
	isUpdating: boolean;
}
const waiting: Record<WaitingFor, string> = {
	signIn: "Waiting for sign-in",
	access: "Waiting for organization access",
	subscription: "Waiting for subscription",
	originalContext: "Waiting for original context",
	serverAdoption: "Waiting for server setup",
	appUpdate: "App update required",
	server: "Waiting for server",
};
/** The server's stable task refusal reasons (`ProjectTaskIneligibility`, #873). */
type TaskRefusalReason =
	| "task_done"
	| "task_other_project"
	| "task_not_found"
	| "project_not_bookable";
const taskReasons: Record<TaskRefusalReason, string> = {
	task_done: "The chosen task was marked done.",
	task_other_project: "The chosen task belongs to another project.",
	task_not_found: "The chosen task no longer exists.",
	project_not_bookable: "The chosen project is not open for booking.",
};
function isTaskRefusalReason(value: unknown): value is TaskRefusalReason {
	return (
		typeof value === "string" &&
		Object.prototype.hasOwnProperty.call(taskReasons, value)
	);
}
/** Why the server refused a closing attribution (v2 422 `field`/`reason`). */
function attributionRefusal(failure: CommandFailure | null): string | null {
	if (failure?.code !== "attribution_not_allowed") return null;
	const response =
		failure.response && typeof failure.response === "object"
			? (failure.response as { field?: unknown; reason?: unknown })
			: {};
	switch (response.field) {
		case "taskId":
			return isTaskRefusalReason(response.reason)
				? taskReasons[response.reason]
				: "The chosen task is not available.";
		case "projectId":
			// Any refused project: not assigned, inactive or closed alike.
			return "Time cannot be booked to the chosen project.";
		case "workCategoryId":
			return "The chosen work category is not available.";
		default:
			return null;
	}
}
function SavedCommand({
	command,
	onRetry,
	onArchive,
	isUpdating,
}: {
	command: SavedClockCommand;
	onRetry: (id: string) => void;
	onArchive: (id: string) => void;
	isUpdating: boolean;
}) {
	const { t, language } = useI18n();
	const [copied, setCopied] = useState<string | null>(null);
	const copy = async () => {
		try {
			// Keep original bytes even if a retained response is malformed.
			await navigator.clipboard.writeText(JSON.stringify(command, null, 2));
			setCopied(t("Details copied"));
		} catch {
			setCopied(t("Details could not be copied"));
		}
	};
	const when = useMemo(() => {
		try {
			return new Intl.DateTimeFormat(language, {
				dateStyle: "medium",
				timeStyle: "medium",
				timeZone: command.timezone,
			}).format(new Date(command.occurredAt));
		} catch {
			return command.occurredAt;
		}
	}, [language, command.timezone, command.occurredAt]);
	const labels = {
		clock_in: "Clock in",
		clock_out: "Clock out",
		break: "Break recorded",
	};
	const states = {
		pending: "Saved on this device",
		committed: "Confirmed by server",
		archived: "Archived evidence stays on this device.",
		stalled: "Retry checks the original action before sending it again.",
		rejected:
			"The server refused this action. Review it in Z8; the evidence stays here.",
	};
	const label = labels[command.kind];
	const refusal = attributionRefusal(command.failure);
	const state = command.waitingFor
		? waiting[command.waitingFor]
		: states[command.state];
	return (
		<li>
			<strong>{t(label)}</strong> · {when} ({command.timezone})<p>{t(state)}</p>
			{command.failure && <p className="field-hint">{command.failure.code}</p>}
			{refusal && <p>{t(refusal)}</p>}
			<div className="clock-recovery-actions">
				{command.state === "stalled" && (
					<button
						type="button"
						className="clock-recovery-action"
						disabled={isUpdating}
						onClick={() => onRetry(command.operationId)}
					>
						{t("Retry")}
					</button>
				)}
				{command.archivable && (
					<button
						type="button"
						className="clock-recovery-action"
						disabled={isUpdating}
						onClick={() => onArchive(command.operationId)}
					>
						{t("Archive")}
					</button>
				)}
				<button type="button" className="clock-recovery-action" onClick={copy}>
					{t("Copy details")}
				</button>
			</div>
			{copied && <p role="status">{copied}</p>}
		</li>
	);
}
export function ClockRecoveryNotice({
	journal,
	journalError,
	actionError,
	savedCommandError,
	needsStatusRefresh,
	onRefresh,
	onRetry,
	onArchive,
	isUpdating,
}: ClockRecoveryNoticeProps) {
	const { t } = useI18n();
	const unresolved = journal?.commands.filter(isUnresolved) ?? [],
		resolved =
			journal?.commands.filter((command) => !isUnresolved(command)) ?? [];
	if (
		!journalError &&
		!actionError &&
		!savedCommandError &&
		!needsStatusRefresh &&
		!journal?.workChangedElsewhere &&
		!unresolved.length &&
		!journal?.otherContexts &&
		!journal?.legacy.total &&
		!resolved.some((command) => command.state === "archived")
	)
		return null;
	return (
		<section
			className="clock-recovery"
			aria-label={t("Clock recovery")}
			aria-live="polite"
		>
			{journal?.workChangedElsewhere && (
				<p role="alert">
					{t(
						"Work changed on another device. Resolve the earlier saved action before clocking again.",
					)}
				</p>
			)}
			{actionError && (
				<p>
					{t("Clock action failed")}: {actionError}
				</p>
			)}
			{savedCommandError && (
				<p>
					{t("Saved action paused")}: {savedCommandError}
				</p>
			)}
			{journalError && (
				<p>
					{t("Local clock storage is unavailable. Clock actions are paused.")}
				</p>
			)}
			{!!unresolved.length && (
				<details open>
					<summary>
						{unresolved.length} · {t("Saved actions")}
					</summary>
					<ul>
						{unresolved.map((command) => (
							<SavedCommand
								key={command.operationId}
								{...{ command, onRetry, onArchive, isUpdating }}
							/>
						))}
					</ul>
				</details>
			)}
			{!!resolved.length && (
				<details>
					<summary>{t("Recently resolved")}</summary>
					<ul>
						{resolved.map((command) => (
							<SavedCommand
								key={command.operationId}
								{...{ command, onRetry, onArchive, isUpdating }}
							/>
						))}
					</ul>
				</details>
			)}
			{!!journal?.otherContexts && (
				<p>
					{journal.otherContexts} · {t("Actions in another context")}.{" "}
					{t(
						"Switch back to their original account, organization and server to synchronize.",
					)}
				</p>
			)}
			{!!journal?.legacy.total && (
				<details>
					<summary>
						{journal.legacy.total} ·{" "}
						{t("Legacy records require authorized recovery before clocking.")}
					</summary>
					<p>
						{t(
							"Ownership is unverified. Original records are retained; no automatic replay or deletion.",
						)}
					</p>
					<dl className="field-hint">
						<dt>{t("Malformed records")}</dt>
						<dd>{journal.legacy.malformed}</dd>
						<dt>{t("Retry limit reached")}</dt>
						<dd>{journal.legacy.exhausted}</dd>
						<dt>{t("Possible partial breaks")}</dt>
						<dd>{journal.legacy.possiblePartialBreaks}</dd>
						<dt>{t("Break closes acknowledged")}</dt>
						<dd>{journal.legacy.breaksWithAcknowledgedClose}</dd>
					</dl>
				</details>
			)}
			{needsStatusRefresh && (
				<p>{t("Refresh current status before another action.")}</p>
			)}
			<button
				type="button"
				className="clock-recovery-refresh"
				onClick={onRefresh}
			>
				{t("Refresh status")}
			</button>
		</section>
	);
}
