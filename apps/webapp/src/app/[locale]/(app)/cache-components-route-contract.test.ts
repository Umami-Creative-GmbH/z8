import { existsSync, globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const REVIEWED_RETAINED_CONNECTION_FILES = [
	"src/app/[locale]/(app)/absences/page.tsx",
	"src/app/[locale]/(app)/payroll/page.tsx",
	"src/app/[locale]/(app)/settings/payroll-readiness/page.tsx",
	"src/app/[locale]/(app)/settings/vacation/employees/page.tsx",
	"src/app/[locale]/(app)/settings/wellness/page.tsx",
	"src/app/[locale]/(app)/works-council/page.tsx",
	"src/app/[locale]/(auth)/layout.tsx",
	"src/app/[locale]/onboarding/layout.tsx",
] as const;

const PENDING_CONNECTION_FILES = [
	"src/app/[locale]/(admin)/platform-admin/analytics/page.tsx",
	"src/app/[locale]/(admin)/platform-admin/billing/page.tsx",
	"src/app/[locale]/(admin)/platform-admin/diagnostics/page.tsx",
	"src/app/[locale]/(admin)/platform-admin/page.tsx",
	"src/app/[locale]/(admin)/platform-admin/worker-queue/page.tsx",
	"src/app/[locale]/(app)/analytics/layout.tsx",
	"src/app/[locale]/(app)/calendar/page.tsx",
	"src/app/[locale]/(app)/my-requests/page.tsx",
	"src/app/[locale]/(app)/organization/page.tsx",
	"src/app/[locale]/(app)/page.tsx",
	"src/app/[locale]/(app)/reports/page.tsx",
	"src/app/[locale]/(app)/reports/projects/page.tsx",
	"src/app/[locale]/(app)/scheduling/page.tsx",
	"src/app/[locale]/(app)/settings/approval-policies/page.tsx",
	"src/app/[locale]/(app)/settings/audit-export/page.tsx",
	"src/app/[locale]/(app)/settings/avv/page.tsx",
	"src/app/[locale]/(app)/settings/billing/page.tsx",
	"src/app/[locale]/(app)/settings/calendar/page.tsx",
	"src/app/[locale]/(app)/settings/change-policies/page.tsx",
	"src/app/[locale]/(app)/settings/compliance/page.tsx",
	"src/app/[locale]/(app)/settings/compliance/works-council/page.tsx",
	"src/app/[locale]/(app)/settings/coverage-rules/page.tsx",
	"src/app/[locale]/(app)/settings/customers/page.tsx",
	"src/app/[locale]/(app)/settings/demo/page.tsx",
	"src/app/[locale]/(app)/settings/email-templates/page.tsx",
	"src/app/[locale]/(app)/settings/enterprise/email/page.tsx",
	"src/app/[locale]/(app)/settings/export-operations/page.tsx",
	"src/app/[locale]/(app)/settings/export/page.tsx",
	"src/app/[locale]/(app)/settings/holidays/page.tsx",
	"src/app/[locale]/(app)/settings/implementation-checklist/page.tsx",
	"src/app/[locale]/(app)/settings/import/[batchId]/page.tsx",
	"src/app/[locale]/(app)/settings/import/page.tsx",
	"src/app/[locale]/(app)/settings/locations/[locationId]/page.tsx",
	"src/app/[locale]/(app)/settings/locations/page.tsx",
	"src/app/[locale]/(app)/settings/organizations/page.tsx",
	"src/app/[locale]/(app)/settings/payroll-access/page.tsx",
	"src/app/[locale]/(app)/settings/payroll-export/page.tsx",
	"src/app/[locale]/(app)/settings/permissions/page.tsx",
	"src/app/[locale]/(app)/settings/projects/page.tsx",
	"src/app/[locale]/(app)/settings/roles/page.tsx",
	"src/app/[locale]/(app)/settings/scheduled-exports/page.tsx",
	"src/app/[locale]/(app)/settings/shifts/page.tsx",
	"src/app/[locale]/(app)/settings/skills/page.tsx",
	"src/app/[locale]/(app)/settings/statistics/page.tsx",
	"src/app/[locale]/(app)/settings/surcharges/page.tsx",
	"src/app/[locale]/(app)/settings/telegram/page.tsx",
	"src/app/[locale]/(app)/settings/travel-expenses/page.tsx",
	"src/app/[locale]/(app)/settings/vacation/page.tsx",
	"src/app/[locale]/(app)/settings/work-categories/page.tsx",
	"src/app/[locale]/(app)/settings/work-policies/page.tsx",
	"src/app/[locale]/(app)/team/absences/page.tsx",
	"src/app/[locale]/(app)/time-tracking/page.tsx",
	"src/app/[locale]/(app)/today/page.tsx",
	"src/app/[locale]/(app)/travel-expenses/page.tsx",
	"src/app/[locale]/(auth)/verify-2fa/page.tsx",
	"src/app/[locale]/(setup)/setup/page.tsx",
] as const;

const ROUTES_WITH_EXISTING_BOUNDARIES = [
	"src/app/[locale]/(app)/organization/page.tsx",
	"src/app/[locale]/(app)/calendar/page.tsx",
	"src/app/[locale]/(app)/time-tracking/page.tsx",
	"src/app/[locale]/(app)/team/absences/page.tsx",
	"src/app/[locale]/(app)/settings/locations/[locationId]/page.tsx",
	"src/app/[locale]/(app)/settings/approval-policies/page.tsx",
	"src/app/[locale]/(app)/settings/permissions/page.tsx",
	"src/app/[locale]/(app)/settings/work-categories/page.tsx",
] as const;

const ROUTES_REQUIRING_NEW_SHELL = [
	"src/app/[locale]/(app)/settings/locations/page.tsx",
	"src/app/[locale]/(app)/settings/change-policies/page.tsx",
] as const;

function appPath(file: string): string {
	return join(APP_ROOT, file.replace(/^src\/app\//, ""));
}

describe("App Router connection escape hatches", () => {
	it("matches the reviewed and pending page/layout inventory exactly", () => {
		const actualFiles = globSync("**/{page,layout}.tsx", { cwd: APP_ROOT })
			.filter((file) =>
				/\bconnection\s*\(/.test(readFileSync(join(APP_ROOT, file), "utf8")),
			)
			.map((file) => `src/app/${file}`)
			.sort();
		const retainedFiles = [...REVIEWED_RETAINED_CONNECTION_FILES].sort();
		const pendingFiles = [...PENDING_CONNECTION_FILES].sort();
		const overlap = retainedFiles.filter((file) => pendingFiles.includes(file));

		expect(overlap).toEqual([]);
		expect([...retainedFiles, ...pendingFiles].sort()).toEqual(actualFiles);
	});

	it("lists only files that exist", () => {
		for (const file of [
			...REVIEWED_RETAINED_CONNECTION_FILES,
			...PENDING_CONNECTION_FILES,
		]) {
			expect(existsSync(appPath(file)), file).toBe(true);
		}
	});
});

describe("low-risk route streaming boundaries", () => {
	it.each(ROUTES_WITH_EXISTING_BOUNDARIES)(
		"keeps a non-null Suspense fallback in %s",
		(file) => {
			const source = readFileSync(appPath(file), "utf8");
			const suspenseWithFallback =
				/<Suspense\b[\s\S]*?\bfallback\s*=\s*\{\s*(?:\(\s*)?</;

			expect(source).toMatch(suspenseWithFallback);
		},
	);

	it.each(ROUTES_REQUIRING_NEW_SHELL)(
		"records %s as requiring a focused shell",
		(file) => {
			const path = appPath(file);

			expect(existsSync(path), file).toBe(true);

			const source = readFileSync(path, "utf8");

			expect(source).toMatch(/\bconnection\s*\(/);
			expect(source).not.toMatch(/<Suspense\b/);
		},
	);
});
