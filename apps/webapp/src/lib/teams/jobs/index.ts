/**
 * Teams Background Jobs
 *
 * Export job processors for Teams integration.
 */

export { runDailyDigestJob, type DailyDigestResult } from "./daily-digest";
export { runEscalationCheckerJob, type EscalationCheckerResult } from "./escalation-checker";
