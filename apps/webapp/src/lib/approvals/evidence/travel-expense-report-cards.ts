import type { ApprovalPresentationProvider } from "@/db/schema";

/**
 * Providers whose expense report cards may carry controls and whose presses
 * may decide (#623). Reports follow the Telegram-first rollout of legacy
 * absence (#384) and time (#432) cards: Teams and Discord share the bound
 * path but were not exercised for reports, so even an `actionable`
 * presentation control keeps them review-only. Slack never decides.
 */
export const TRAVEL_EXPENSE_REPORT_ACTIONABLE_PROVIDERS: readonly ApprovalPresentationProvider[] = [
	"telegram",
];
