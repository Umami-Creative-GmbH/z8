/**
 * Teams Background Jobs
 *
 * Export job processors for Teams integration.
 */

export { type DailyDigestResult, runDailyDigestJob } from "./daily-digest";
export { type EscalationCheckerResult, runEscalationCheckerJob } from "./escalation-checker";
