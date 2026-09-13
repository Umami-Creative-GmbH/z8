import type { RecoverySummary } from "../types";

const countFormatter = new Intl.NumberFormat();

interface ClockRecoveryNoticeProps {
  recovery: RecoverySummary | undefined;
  recoveryError: boolean;
  actionError: string | null;
  needsStatusRefresh: boolean;
  onRefresh: () => void;
}

export function ClockRecoveryNotice({
  recovery,
  recoveryError,
  actionError,
  needsStatusRefresh,
  onRefresh,
}: ClockRecoveryNoticeProps) {
  const hasRetainedRecords = !!recovery && recovery.total > 0;
  if (!hasRetainedRecords && !recoveryError && !actionError && !needsStatusRefresh) return null;

  return (
    <section className="clock-recovery" aria-label="Clock recovery" aria-live="polite">
      {actionError && <p>{actionError}</p>}
      {recoveryError && (
        <p>Local recovery storage could not be read. Clock actions are paused. Check your time entries in Z8 before trying again.</p>
      )}
      {hasRetainedRecords && (
        <details>
          <summary>{countFormatter.format(recovery.total)} local records need review</summary>
          <p>Original records remain on this device. They are not being retried or deleted. Check your time entries in Z8 and arrange authorized recovery before recording replacement work.</p>
          <ul>
            <li>Malformed records: {countFormatter.format(recovery.malformed)}</li>
            <li>Retry limit reached: {countFormatter.format(recovery.exhausted)}</li>
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
