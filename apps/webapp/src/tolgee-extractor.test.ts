import { describe, expect, it } from "vitest";
import extractor from "../tolgee-extractor.mjs";

describe("tolgee extractor", () => {
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
});
