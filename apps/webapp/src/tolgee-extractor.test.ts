import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import extractor from "../tolgee-extractor.mjs";

describe("tolgee extractor", () => {
	it("does not mistake catalog path arrays for key/fallback tuples", () => {
		const result = extractor(
			`keys("timeTracking", ["timeTracking.errors", "timeTracking.quickBreak"]);`,
			"shell-catalog.ts",
		);

		expect(result.keys).toEqual([]);
	});

	it("does not use a namespaced translation key as a tuple fallback", () => {
		const result = extractor(
			`const paths = ["approvals:approvals.types", "approvals:approvals.title"];`,
			"catalog.ts",
		);

		expect(result.keys).not.toContainEqual(
			expect.objectContaining({ keyName: "approvals.types" }),
		);
		expect(result.keys.every((key) => key.defaultValue === undefined)).toBe(
			true,
		);
	});

	it("keeps dotted fallback text that is not a translation key", () => {
		const result = extractor(
			`const messages = { invalid: ["auth.invalid-file", "file.name"] };`,
			"messages.ts",
		);

		expect(result.keys).toEqual([
			expect.objectContaining({
				keyName: "auth.invalid-file",
				defaultValue: "file.name",
			}),
		]);
	});

	it("retains explicitly declared lists of translation keys without invented defaults", () => {
		const result = extractor(
			`const LABEL_KEYS = ["approvals:approvals.title", "approvals:approvals.pending"];`,
			"labels.ts",
		);

		expect(result.keys).toEqual([
			expect.objectContaining({
				keyName: "approvals.title",
				defaultValue: undefined,
			}),
			expect.objectContaining({
				keyName: "approvals.pending",
				defaultValue: undefined,
			}),
		]);
	});

	it("does not create shell catalog subtree translations", () => {
		const source = readFileSync(
			new URL("./tolgee/shell-catalog.ts", import.meta.url),
			"utf8",
		);
		const result = extractor(source, "src/tolgee/shell-catalog.ts");

		for (const keyName of [
			"timeTracking.errors",
			"dashboard.customize",
			"organization.role",
		]) {
			expect(result.keys).not.toContainEqual(
				expect.objectContaining({ keyName }),
			);
		}
	});

	it("uses adjacent fallback values for data-driven key properties", () => {
		const result = extractor(
			`
			export const STEPS = [{
				titleKey: "tour.sidebar.title",
				titleDefault: "Navigate Z8",
				descriptionKey: "tour.sidebar.description",
				descriptionDefault: "Use the sidebar to move around.",
			}];
		`,
			"tour-steps.ts",
		);

		expect(result.keys).toEqual([
			expect.objectContaining({
				defaultValue: "Navigate Z8",
				keyName: "tour.sidebar.title",
				namespace: "common",
			}),
			expect.objectContaining({
				defaultValue: "Use the sidebar to move around.",
				keyName: "tour.sidebar.description",
				namespace: "common",
			}),
		]);
	});

	it("uses adjacent fallback values for namespaced notification metadata keys", () => {
		const result = extractor(
			`
			const notificationCopy = {
				passwordChanged: {
					titleKey: "common:notifications.content.passwordChanged.title",
					titleDefault: "Password changed",
					messageKey: "common:notifications.content.passwordChanged.message",
					messageDefault: "Your password was successfully changed.",
				},
			};
		`,
			"triggers.ts",
		);

		expect(result.keys).toEqual([
			expect.objectContaining({
				defaultValue: "Password changed",
				keyName: "notifications.content.passwordChanged.title",
				namespace: "common",
			}),
			expect.objectContaining({
				defaultValue: "Your password was successfully changed.",
				keyName: "notifications.content.passwordChanged.message",
				namespace: "common",
			}),
		]);
	});

	it("infers namespaces for module translation prefixes that should not be ungrouped", () => {
		const result = extractor(
			`
			import { useTranslate } from "@tolgee/react";

			export function Example() {
				const { t } = useTranslate();
				return [
					t("approvals:approvals.inbox", "Approval Inbox"),
					t("compliance:compliance.restPeriodRequired", "Rest Period Required"),
					t("myRequests:myRequests.title", "My Requests"),
					t("scheduling:scheduling.coverage.toggleLabel", "Coverage"),
					t("setup:setup.title", "Create Platform Admin"),
					t("webhooks:webhooks.title", "Webhooks"),
					t("setup:init.checking", "Checking session..."),
				];
			}
		`,
			"example.tsx",
		);

		expect(result.keys).toEqual([
			expect.objectContaining({ keyName: "approvals.inbox", namespace: "approvals" }),
			expect.objectContaining({
				keyName: "compliance.restPeriodRequired",
				namespace: "compliance",
			}),
			expect.objectContaining({ keyName: "myRequests.title", namespace: "myRequests" }),
			expect.objectContaining({
				keyName: "scheduling.coverage.toggleLabel",
				namespace: "scheduling",
			}),
			expect.objectContaining({ keyName: "setup.title", namespace: "setup" }),
			expect.objectContaining({ keyName: "webhooks.title", namespace: "webhooks" }),
			expect.objectContaining({ keyName: "init.checking", namespace: "setup" }),
		]);
	});

	it("keeps global billing banner keys in the common namespace", () => {
		const result = extractor(
			`
			import { useTranslate } from "@tolgee/react";

			export function TrialBanner() {
				const { t } = useTranslate();
				return t("billing.trialBanner.title", "14-day trial active");
			}
		`,
			"trial-banner.tsx",
		);

		expect(result.keys).toEqual([
			expect.objectContaining({
				defaultValue: "14-day trial active",
				keyName: "billing.trialBanner.title",
				namespace: "common",
			}),
		]);
	});

	it("keeps shared app search, validation, and work balance keys in the common namespace", () => {
		const result = extractor(
			`
			import { useTranslate } from "@tolgee/react";

			export function SharedStrings() {
				const { t } = useTranslate();
				return [
					t("appSearch.searchOrRunCommand", "Search or run command"),
					t("validation.invalid-email", "Invalid email address"),
					t("workBalance.label", "All-time balance"),
				];
			}
		`,
			"shared-strings.tsx",
		);

		expect(result.keys).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					keyName: "appSearch.searchOrRunCommand",
					namespace: "common",
				}),
				expect.objectContaining({
					keyName: "validation.invalid-email",
					namespace: "common",
				}),
				expect.objectContaining({
					keyName: "workBalance.label",
					namespace: "common",
				}),
			]),
		);
	});

	it("routes analytics and today route keys to dedicated namespaces", () => {
		const result = extractor(
			`
			import { useTranslate } from "@tolgee/react";

			export function RouteStrings() {
				const { t } = useTranslate();
				return [
					t("analytics.layout.title", "Analytics"),
					t("today.briefing.title", "Manager Daily Briefing"),
				];
			}
		`,
			"route-strings.tsx",
		);

		expect(result.keys).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					keyName: "analytics.layout.title",
					namespace: "analytics",
				}),
				expect.objectContaining({
					keyName: "today.briefing.title",
					namespace: "today",
				}),
			]),
		);
	});

	it("extracts billing page keys into the billing namespace", () => {
		const result = extractor(
			`
			import { useTranslate } from "@tolgee/react";

			export function BillingFaq() {
				const { t } = useTranslate();
				return t("billing.faq.title", "Frequently Asked Questions");
			}
		`,
			"billing-page-client.tsx",
		);

		expect(result.keys).toEqual([
			expect.objectContaining({
				defaultValue: "Frequently Asked Questions",
				keyName: "billing.faq.title",
				namespace: "billing",
			}),
		]);
	});

	it("extracts nested settings keys into focused settings namespaces", () => {
		const result = extractor(
			`
			import { useTranslate } from "@tolgee/react";

			export function SettingsExample() {
				const { t } = useTranslate();
				return [
					t("settings.enterprise.email.title", "Email Configuration"),
					t("settings.payrollExport.title", "Payroll Export"),
					t("settings.holidays.title", "Holidays"),
					t("settings.title", "Settings"),
				];
			}
		`,
			"settings-example.tsx",
		);

		expect(result.keys).toEqual([
			expect.objectContaining({
				keyName: "settings.enterprise.email.title",
				namespace: "settings/enterprise",
			}),
			expect.objectContaining({
				keyName: "settings.payrollExport.title",
				namespace: "settings/payrollExport",
			}),
			expect.objectContaining({
				keyName: "settings.holidays.title",
				namespace: "settings/holidays",
			}),
			expect.objectContaining({ keyName: "settings.title", namespace: "settings/generic" }),
		]);
	});

	it("extracts surcharge report keys into the settings rules namespace", () => {
		const result = extractor(
			`
			import { useTranslate } from "@tolgee/react";

			export function SurchargeReports() {
				const { t } = useTranslate();
				return t("settings.surcharges.reports.title", "Surcharge reports");
			}
		`,
			"surcharge-reports.tsx",
		);

		expect(result.keys).toEqual([
			expect.objectContaining({
				defaultValue: "Surcharge reports",
				keyName: "settings.surcharges.reports.title",
				namespace: "settings/rules",
			}),
		]);
	});

	it("extracts Teams bot keys from injected translator functions", () => {
		const result = extractor(
			`
			export function buildApprovalCard(t = (_key: string, fallback: string) => fallback) {
				return t("teamsBot:approval.absenceRequest", "Absence Request");
			}
		`,
			"approval-card.ts",
		);

		expect(result.keys).toEqual([
			expect.objectContaining({
				defaultValue: "Absence Request",
				keyName: "approval.absenceRequest",
				namespace: "teamsBot",
			}),
		]);
	});

	it("extracts travel expense view keys into the travel expenses namespace", () => {
		const result = extractor(
			`
			import { useTranslate } from "@tolgee/react";

			export function TravelExpenseHeader() {
				const { t } = useTranslate();
				return t("travelExpenses.title", "Travel Expenses");
			}
		`,
			"travel-expense-management.tsx",
		);

		expect(result.keys).toEqual([
			expect.objectContaining({
				defaultValue: "Travel Expenses",
				keyName: "travelExpenses.title",
				namespace: "travelExpenses",
			}),
		]);
	});

	it("extracts payroll workspace keys into the payroll namespace", () => {
		const result = extractor(
			`
			import { useTranslate } from "@tolgee/react";

			export function PayrollHeader() {
				const { t } = useTranslate();
				return t("payroll.title", "Payroll");
			}
		`,
			"payroll-workspace.tsx",
		);

		expect(result.keys).toEqual([
			expect.objectContaining({
				defaultValue: "Payroll",
				keyName: "payroll.title",
				namespace: "payroll",
			}),
		]);
	});

	it("extracts namespace-qualified keys from data-driven key maps", () => {
		const result = extractor(
			`
			const REQUEST_STATUS_KEYS = {
				pending: { key: "myRequests:myRequests.status.pending", default: "Pending" },
			};

			const TOUR_STEPS = [{
				titleKey: "setup:init.selectOrganization",
				titleDefault: "Select Organization",
			}];
		`,
			"data.ts",
		);

		expect(result.keys).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					defaultValue: "Pending",
					keyName: "myRequests.status.pending",
					namespace: "myRequests",
				}),
				expect.objectContaining({
					defaultValue: "Select Organization",
					keyName: "init.selectOrganization",
					namespace: "setup",
				}),
			]),
		);
	});

	it("extracts compliance command-center descriptor maps used by dynamic renderers", () => {
		const result = extractor(
			`
			export const COMPLIANCE_COMMAND_CENTER_I18N = {
				summaryHealthy: {
					key: "compliance.commandCenter.summary.healthy",
					default: "No active issues detected in monitored signals",
				},
				statusHealthy: {
					key: "compliance.commandCenter.status.healthy",
					default: "healthy",
				},
			};
		`,
			"localized-text.ts",
		);

		expect(result.keys).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					defaultValue: "No active issues detected in monitored signals",
					keyName: "compliance.commandCenter.summary.healthy",
					namespace: "compliance",
				}),
				expect.objectContaining({
					defaultValue: "healthy",
					keyName: "compliance.commandCenter.status.healthy",
					namespace: "compliance",
				}),
			]),
		);
	});

	// A key the extractor misses is deleted from Tolgee by `tolgee sync`, together with every
	// translation of it; the next pull then drops it from the catalogs.
	describe("keeps keys that tolgee sync would otherwise delete", () => {
		it("extracts t() calls in helpers that receive the translator as a parameter", () => {
			const result = extractor(
				`
				import type { TFnType } from "@tolgee/react";

				export function beyondWindowMessage(t: TFnType) {
					return t("calendar.edit.time.beyondWindow", "Too far in the past");
				}
			`,
				"work-period-time-edit-section.tsx",
			);

			expect(result.keys).toEqual([
				expect.objectContaining({
					defaultValue: "Too far in the past",
					keyName: "calendar.edit.time.beyondWindow",
					namespace: "calendar",
				}),
			]);
		});

		it("extracts key/fallback lookup tables of any name", () => {
			const result = extractor(
				`
				const REQUEST_TEXT = {
					edit: { key: "bot.approval.card.correctionEdit", fallback: "Change times" },
				};
				const REVIEW_MESSAGES = {
					clock_out: {
						label: "Needs review: offboarding clock-out",
						key: "common:notifications.content.employeeOffboardingReview.clock_out",
					},
				};
			`,
				"time-card.ts",
			);

			expect(result.keys).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						defaultValue: "Change times",
						keyName: "bot.approval.card.correctionEdit",
						namespace: "bot",
					}),
					expect.objectContaining({
						defaultValue: "Needs review: offboarding clock-out",
						keyName: "notifications.content.employeeOffboardingReview.clock_out",
						namespace: "common",
					}),
				]),
			);
		});

		it("prefers a lookup-table fallback over a label declared before it", () => {
			const result = extractor(
				`
				const REVIEW_MESSAGES = {
					clock_out: {
						label: "Needs review: offboarding clock-out",
						key: "common:notifications.content.employeeOffboardingReview.clock_out",
						fallback: "{employeeName}: Needs review: offboarding clock-out ({cutoff}).",
					},
				};
			`,
				"notifications.ts",
			);

			expect(result.keys).toEqual([
				expect.objectContaining({
					defaultValue: "{employeeName}: Needs review: offboarding clock-out ({cutoff}).",
					keyName: "notifications.content.employeeOffboardingReview.clock_out",
				}),
			]);
		});

		it("keeps lookup-table fallbacks that contain ICU placeholders", () => {
			const result = extractor(
				`
				const OUTCOME_TEXT = {
					request_approved: {
						title: { key: "bot.approval.outcome.requestApprovedTitle", fallback: "Request approved" },
						text: {
							key: "bot.approval.outcome.requestApproved",
							fallback: "Approved by {actor} on {time}. The request is approved.",
						},
					},
				};
			`,
				"approval-notice.ts",
			);

			expect(result.keys).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						defaultValue: "Request approved",
						keyName: "bot.approval.outcome.requestApprovedTitle",
					}),
					expect.objectContaining({
						defaultValue: "Approved by {actor} on {time}. The request is approved.",
						keyName: "bot.approval.outcome.requestApproved",
						namespace: "bot",
					}),
				]),
			);
		});

		it("extracts [key, fallback] message tuples", () => {
			const result = extractor(
				`
				const MESSAGES = {
					collision: [
						"timeTracking.manualEntry.errors.collision",
						"This entry conflicts with an earlier submission.",
					],
				};
			`,
				"manual-time-entry-dialog.tsx",
			);

			expect(result.keys).toEqual([
				expect.objectContaining({
					defaultValue: "This entry conflicts with an earlier submission.",
					keyName: "timeTracking.manualEntry.errors.collision",
					namespace: "timeTracking",
				}),
			]);
		});

		it("extracts JSX translation key props with their fallback", () => {
			const result = extractor(
				`<LocalizedLoadingLabel translationKey="common:loading.calendar" fallback="Loading calendar" />`,
				"page.tsx",
			);

			expect(result.keys).toEqual([
				expect.objectContaining({
					defaultValue: "Loading calendar",
					keyName: "loading.calendar",
					namespace: "common",
				}),
			]);
		});

		it("extracts namespace-qualified keys passed through local helpers", () => {
			const result = extractor(
				`
				function text(key: string, fallback: string) {
					return { key, fallback };
				}
				const rows = [{ label: text("approvals:approvals.evidence.clockIn", "Clock in") }];
			`,
				"time-review.ts",
			);

			expect(result.keys).toEqual([
				expect.objectContaining({
					defaultValue: "Clock in",
					keyName: "approvals.evidence.clockIn",
					namespace: "approvals",
				}),
			]);
		});

		it("ignores dotted strings without a known namespace outside t() calls", () => {
			const result = extractor(
				`
				const config = { key: "row.id", fallback: "none" };
				const pair = ["file.name", "value"];
			`,
				"config.ts",
			);

			expect(result.keys).toEqual([]);
		});
	});

	it("puts keys with unmapped prefixes in the default namespace, never in a root catalog", () => {
		const result = extractor(
			`const label = t("worksCouncil.loadingLabel", "Loading works council");`,
			"page.tsx",
		);

		expect(result.keys).toEqual([
			expect.objectContaining({ keyName: "worksCouncil.loadingLabel", namespace: "common" }),
		]);
	});

	it("skips test files so mock keys are never pushed", () => {
		const code = `
			import { useTranslate } from "@tolgee/react";
			const title = t("notifications.birthday.title", "Birthday");
		`;

		expect(extractor(code, "src/lib/notifications/email-notifications.test.ts").keys).toEqual([]);
		expect(extractor(code, "src/lib/__tests__/helpers.ts").keys).toEqual([]);
	});

	it("drops template-literal defaults with a warning instead of pushing JS source", () => {
		const result = extractor(
			`
			import { useTranslate } from "@tolgee/react";
			const label = t("approvals:fastLanes.approveGroup", \`Approve \${actionLabel}\`, {
				label: actionLabel,
			});
		`,
			"approval-fast-lanes.tsx",
		);

		expect(result.keys).toEqual([
			expect.objectContaining({
				defaultValue: undefined,
				keyName: "fastLanes.approveGroup",
				namespace: "approvals",
			}),
		]);
		expect(result.warnings).toEqual([
			expect.objectContaining({ warning: expect.stringContaining("fastLanes.approveGroup") }),
		]);
	});
});
