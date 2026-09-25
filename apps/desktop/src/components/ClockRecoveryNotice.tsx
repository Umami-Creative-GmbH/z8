import { isUnresolved } from "../lib/saved-commands";
import type { ClockJournal, SavedClockCommand, WaitingFor } from "../types";

const countFormatter = new Intl.NumberFormat();

interface ClockRecoveryNoticeProps {
  journal: ClockJournal | undefined;
  journalError: boolean;
  actionError: string | null;
  savedCommandError: string | null;
  needsStatusRefresh: boolean;
  onRefresh: () => void;
  onRetry: (operationId: string) => void;
  onArchive: (operationId: string) => void;
  isUpdating: boolean;
}

const WAITING_FOR: Record<WaitingFor, string> = {
  signIn: "Waiting for you to sign in again.",
  access: "Waiting for access to this organization.",
  subscription: "Waiting for an active subscription.",
  originalContext: "Waiting for the account and organization it was recorded in.",
  serverAdoption: "Waiting until the server accepts saved clock actions.",
  appUpdate: "The server does not support this app version. Update Z8 Timer.",
  server: "Waiting for a server answer this app recognizes.",
};

const KIND_LABEL: Record<SavedClockCommand["kind"], string> = {
  clock_in: "Clock in",
  clock_out: "Clock out",
  break: "Break, work resumed",
};

/** Shown in the zone the action was recorded in, not the viewer's current zone. */
function eventTime(command: SavedClockCommand) {
  const formatted = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: command.timezone,
  }).format(new Date(command.occurredAt));
  return `${formatted} (${command.timezone})`;
}

function describeState(command: SavedClockCommand) {
  const failure = command.failure;
  switch (command.state) {
    case "pending":
      if (command.waitingFor) return WAITING_FOR[command.waitingFor];
      if (command.dependsOn && command.attempts === 0) return "Saved on this device. Sent after the action before it.";
      return "Saved on this device. It is sent as soon as the server is reachable.";
    case "stalled":
      return "Not confirmed after repeated attempts. The server may already have it. Retry checks first, then sends the same action again.";
    case "rejected":
      return command.archivable
        ? `The server did not save this action (${failure?.code ?? "unknown reason"}). Check your time entries in Z8. Archiving keeps this record on the device.`
        : `The server already holds other or changed work under this action (${failure?.code ?? "unknown reason"}). Check your time entries in Z8 and arrange a reviewed correction; this record stays here.`;
    case "committed":
      return "Saved by the server.";
    case "archived":
      return "Archived. Kept on this device; nothing was saved on the server.";
  }
}

function SavedCommand({ command, onRetry, onArchive, isUpdating }: {
  command: SavedClockCommand;
  onRetry: (operationId: string) => void;
  onArchive: (operationId: string) => void;
  isUpdating: boolean;
}) {
  const copyDetails = () => {
    const evidence = { ...command, command: JSON.parse(command.command), receipt: command.receipt && JSON.parse(command.receipt) };
    void navigator.clipboard.writeText(JSON.stringify(evidence, null, 2));
  };
  return (
    <li>
      <strong>{KIND_LABEL[command.kind]}</strong> at {eventTime(command)}
      <br />
      {describeState(command)}
      <div className="clock-recovery-actions">
        {command.state === "stalled" && (
          <button type="button" className="clock-recovery-action" disabled={isUpdating} onClick={() => onRetry(command.operationId)}>Retry</button>
        )}
        {command.archivable && (
          <button type="button" className="clock-recovery-action" disabled={isUpdating} onClick={() => onArchive(command.operationId)}>Archive</button>
        )}
        <button type="button" className="clock-recovery-action" onClick={copyDetails}>Copy details</button>
      </div>
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
  const legacy = journal?.legacy;
  const hasRetainedRecords = !!legacy && legacy.total > 0;
  const unresolved = journal?.commands.filter(isUnresolved) ?? [];
  const resolved = journal?.commands.filter((command) => !isUnresolved(command)) ?? [];
  const otherContexts = journal?.otherContexts ?? 0;
  // Archived evidence stays visible; routine committed actions alone do not open the notice.
  const hasArchived = resolved.some((command) => command.state === "archived");
  if (!hasRetainedRecords && !journalError && !actionError && !needsStatusRefresh && !savedCommandError && unresolved.length === 0 && otherContexts === 0 && !hasArchived) {
    return null;
  }

  return (
    <section className="clock-recovery" aria-label="Clock recovery" aria-live="polite">
      {actionError && <p>{actionError}</p>}
      {savedCommandError && <p>{savedCommandError}</p>}
      {journalError && (
        <p>Local clock storage could not be read. Clock actions are paused. Check your time entries in Z8 before trying again.</p>
      )}
      {unresolved.length > 0 && (
        <details open>
          <summary>{countFormatter.format(unresolved.length)} clock actions saved on this device</summary>
          <ul>
            {unresolved.map((command) => (
              <SavedCommand key={command.operationId} command={command} onRetry={onRetry} onArchive={onArchive} isUpdating={isUpdating} />
            ))}
          </ul>
        </details>
      )}
      {resolved.length > 0 && (
        <details>
          <summary>Recently resolved clock actions</summary>
          <ul>
            {resolved.map((command) => (
              <SavedCommand key={command.operationId} command={command} onRetry={onRetry} onArchive={onArchive} isUpdating={isUpdating} />
            ))}
          </ul>
        </details>
      )}
      {otherContexts > 0 && (
        <p>
          {countFormatter.format(otherContexts)} saved clock actions belong to another account, organization or server.
          They are kept and sent only after you switch back to it.
        </p>
      )}
      {hasRetainedRecords && (
        <details>
          <summary>{countFormatter.format(legacy.total)} local records need review</summary>
          <p>Original records remain on this device. They are not being retried or deleted. Check your time entries in Z8 and arrange authorized recovery before recording replacement work.</p>
          <ul>
            <li>Malformed records: {countFormatter.format(legacy.malformed)}</li>
            <li>Retry limit reached: {countFormatter.format(legacy.exhausted)}</li>
            <li>Breaks that may be partly saved: {countFormatter.format(legacy.possiblePartialBreaks)}</li>
            <li>All retained records have unverified ownership or operation evidence.</li>
          </ul>
          <p>Stored failure times are not original click times. A break may already be partly saved. Record contents and export remain unavailable until ownership can be verified.</p>
        </details>
      )}
      {needsStatusRefresh && (
        <p>Your clock action was saved, but current status could not be refreshed. Refresh status before another action.</p>
      )}
      <button type="button" className="clock-recovery-refresh" onClick={onRefresh}>Refresh Status</button>
    </section>
  );
}
