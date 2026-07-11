import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));
const webappDirectory = `${workspaceRoot}apps/webapp`;
const testFiles = [
	"src/lib/datetime/temporal-source-guard.test.ts",
	"src/components/calendar/schedule-x-calendar.test.tsx",
	"src/components/reports/date-range-picker.test.tsx",
	"src/app/[locale]/(app)/scheduling/actions/shift-actions.timezone.test.ts",
	"src/app/[locale]/(app)/approvals/actions.canonical.test.ts",
	"src/lib/reports/report-date-range.test.ts",
	"src/lib/effect/services/coverage.service.timezone.test.ts",
];

for (const timeZone of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"]) {
	console.log(`\nRunning Core timezone smoke tests with TZ=${timeZone}`);
	execFileSync("pnpm", ["exec", "vitest", "run", ...testFiles], {
		cwd: webappDirectory,
		env: { ...process.env, TZ: timeZone },
		stdio: "inherit",
	});
}
