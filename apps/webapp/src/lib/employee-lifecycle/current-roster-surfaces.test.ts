import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript/unstable/ast";
import { describe, expect, it } from "vitest";
import { withNativeSource } from "@/lib/typescript/native-source-analysis";

/**
 * Every view that answers "who works here now" filters with the current-roster
 * rule (#1438, Organization ADR 0006). The guard has three layers:
 *
 * 1. Each roster surface is listed by file and function, and fails when it stops
 *    applying the rule or goes back to a hand-written active check on the
 *    employee, which misses due departures.
 * 2. Every other employee query in a listed module must apply the rule too, be
 *    listed as a view of the past, or be exempted with a reason. A new
 *    unfiltered query next to a roster surface fails.
 * 3. Across the whole app, no file may gain hand-written active checks on the
 *    employee beyond the recorded baseline, so new code reaches for the rule.
 *
 * Views of the past keep former employees on purpose and are listed apart, so
 * that the choice is visible and the entries can't silently rot.
 */

const SRC_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * The calls that apply the rule: the predicate, its marking twin (lists that
 * keep a saved former holder and mark it), the role-save guards, readers built
 * on them, and the access rule the roster rule itself builds on.
 * `formerEmployeesAmong` is the marking reader that also dates former rows (#1439).
 */
const ROSTER_RULE =
	/\b\w*[oO]nCurrentRoster\(|\bisFormerEmployee\(|\bcurrentRoster[A-Z]\w*\(|\bformerEmployeesAmong\(|\bemployeeHasOrganizationAccess\(/;
/** A hand-written active check on the employee instead of the rule. */
const RAW_EMPLOYEE_ACTIVE_CHECK =
	/\bemployee\.isActive\b|"employee"\."is_active"|\bemployee\.is_active\b/;
/** A query that reads employees or manager links. */
const EMPLOYEE_QUERY =
	/\.from\(\s*employee\b|Join\(\s*employee\b|\.query\.employee\.find|\.query\.employeeManagers\.find|\.from\(\s*employeeManagers\b/;

type Surface = { file: string; functions: string[]; note: string };

const ROSTER_SURFACES: Surface[] = [
	{
		file: "lib/effect/services/manager.service.ts",
		functions: ["managedEmployeeRows"],
		note: "a manager's direct reports, both sides on the roster unless authority scoping asks for all links",
	},
	{
		file: "components/dashboard/actions.ts",
		functions: [
			"getUpcomingAbsences",
			"getTeamCalendarData",
			"getWhosOutToday",
			"getTeamOverviewStats",
		],
		note: "dashboard widgets about the current team",
	},
	{
		file: "components/dashboard/current-roster-queries.ts",
		functions: [
			"currentRosterEmployeeIds",
			"currentRosterCount",
			"currentRosterAverageWeeklyHours",
		],
		note: "the dashboard's roster readers",
	},
	{
		file: "app/[locale]/(app)/team/actions.ts",
		functions: ["getManagedEmployees", "getCurrentEmployee"],
		note: "/team: current reports unless former employees are asked for, and the viewer",
	},
	{
		file: "lib/bot-platform/current-roster-team.ts",
		functions: ["currentRosterReportIds", "currentRosterDigestManager", "currentRosterEmployees"],
		note: "bot commands, digests and escalation targets",
	},
	{
		file: "lib/notifications/manager-notice-recipients.ts",
		functions: ["currentRosterManagerRecipients"],
		note: "manager notices, with the admin fallback for actionable ones",
	},
	{
		file: "lib/teams/commands/whos-out.ts",
		functions: ["handler"],
		note: "/whosout",
	},
	{
		file: "lib/teams/commands/clockedin.ts",
		functions: ["handler"],
		note: "/clockedin",
	},
	{
		file: "lib/teams/jobs/daily-digest.ts",
		functions: ["processTenantDigest", "buildDigestDataForManager"],
		note: "Teams manager digest",
	},
	{
		file: "lib/slack/jobs/daily-digest.ts",
		functions: ["processBotDigest"],
		note: "Slack manager digest",
	},
	{
		file: "lib/discord/jobs/daily-digest.ts",
		functions: ["processBotDigest"],
		note: "Discord manager digest",
	},
	{
		file: "lib/telegram/jobs/daily-digest.ts",
		functions: ["processTelegramBotDigest"],
		note: "Telegram manager digest",
	},
	{
		file: "lib/teams/jobs/escalation-checker.ts",
		functions: ["escalateApproval"],
		note: "Teams escalation target",
	},
	{
		file: "lib/slack/jobs/escalation-checker.ts",
		functions: ["processBotEscalations"],
		note: "Slack escalation targets",
	},
	{
		file: "lib/discord/jobs/escalation-checker.ts",
		functions: ["processBotEscalations"],
		note: "Discord escalation targets",
	},
	{
		file: "lib/telegram/jobs/escalation-checker.ts",
		functions: ["processBotEscalations"],
		note: "Telegram escalation targets",
	},
	{
		file: "lib/teams/shift-pickup-handler.ts",
		functions: ["notifyPrimaryManagerAboutShiftPickup"],
		note: "shift pickup request to the primary manager",
	},
	{
		file: "app/[locale]/(app)/absences/mutations.ts",
		functions: ["notifyManagersOfApprovedSelfCancellation"],
		note: "cancellation notice to managers",
	},
	{
		file: "lib/time-tracking/closed-months/notifications.ts",
		functions: ["listManagerUserIds", "listMonthCloseRecipients"],
		note: "month reopened and month close notices",
	},
	{
		file: "lib/time-tracking/vehicle-use/driving-details-missing-store.ts",
		functions: ["drivingDetailsListedEmployeeCondition"],
		note: "the missing driving details count on Today",
	},
	{
		file: "lib/employee-lifecycle/current-roster-among.ts",
		functions: ["currentRosterAmong"],
		note: "which of some employees are current, for marking lists",
	},
	{
		file: "app/[locale]/(app)/settings/employees/selectable-employees.ts",
		functions: ["employeeStatusCondition"],
		note: "picker and directory status: current is the picker default",
	},
	{
		file: "app/[locale]/(app)/settings/projects/actions.ts",
		functions: ["getEmployeesForSelection", "getProjects"],
		note: "project assignee picker, and assignment lists with former members marked",
	},
	{
		file: "app/[locale]/(app)/settings/teams/actions.ts",
		functions: ["getTeam"],
		note: "team member list with former members marked",
	},
	{
		file: "app/[locale]/(app)/settings/teams/team-settings-page-data.ts",
		functions: ["loadTeamSettingsPageData"],
		note: "teams page members with former members marked",
	},
	{
		file: "lib/employee-lifecycle/current-roster-guard.ts",
		functions: ["findEmployeesNotOnCurrentRoster"],
		note: "the server-side refusal of former employees in role saves",
	},
	{
		file: "lib/organization/driving-licence/verifier-actions.ts",
		functions: ["getDrivingLicenceVerifierAdminDataAction"],
		note: "driving licence verifier picker",
	},
	{
		file: "app/[locale]/(app)/settings/travel-expenses/expense-officer-actions.ts",
		functions: ["getExpenseOfficerAdminData"],
		note: "expense officer picker",
	},
	{
		file: "app/[locale]/(app)/settings/personnel-files/officer-actions.ts",
		functions: ["getPersonnelFileOfficerAdminData"],
		note: "personnel file officer picker",
	},
	{
		file: "app/[locale]/(app)/settings/payroll-access/actions.ts",
		functions: ["getPayrollAccessAdminDataAction"],
		note: "payroll access picker",
	},
	{
		file: "lib/personnel-file/document-request-store.ts",
		functions: ["listDocumentRequestRecipientOptions"],
		note: "bulk document request recipients",
	},
	{
		file: "app/[locale]/(app)/settings/vehicles/actions.ts",
		functions: ["getVehicleSettings"],
		note: "vehicle assigned driver picker",
	},
	{
		file: "app/[locale]/(app)/settings/position-capture/actions.ts",
		functions: ["getPositionCaptureAdminDataAction"],
		note: "position capture assignment picker",
	},
	{
		file: "app/[locale]/(app)/settings/vehicle-use/actions.ts",
		functions: ["getVehicleUseAdminDataAction"],
		note: "vehicle use assignment picker",
	},
];

const HISTORY_VIEWS: Surface[] = [
	{
		file: "app/[locale]/(app)/team/actions.ts",
		functions: ["getCalendarManagedEmployees", "getCachedCalendarManagedEmployeeRecords"],
		note: "historical calendars stay readable; former reports are marked",
	},
	{
		file: "app/api/calendar/ics/[secret]/route.ts",
		functions: ["fetchTeamAbsences"],
		note: "a former employee's past absences stay in the feed, later ones are dropped",
	},
	{
		file: "components/dashboard/actions.ts",
		functions: ["getRecentlyApprovedRequests"],
		note: "approval history",
	},
	{
		file: "lib/time-tracking/vehicle-use/driving-details-team-store.ts",
		functions: ["listScopedPeople", "loadTeamDrivingDetails"],
		note: "work still missing driving details, former drivers marked",
	},
	{
		file: "lib/reports/permissions.ts",
		functions: ["getAccessibleEmployees"],
		note: "report employee selector, former employees marked",
	},
	{
		file: "app/[locale]/(app)/settings/employees/employee-queries.actions.ts",
		functions: ["getEmployeesByIdsAction", "loadEmployeePage"],
		note: "already-selected employees resolve, and the directory filters by the status asked for",
	},
];

/**
 * Employee queries in listed modules that answer neither "who works here now"
 * nor a view of the past, so they neither filter nor mark (#1438).
 */
const EXEMPT_EMPLOYEE_QUERIES: Surface[] = [
	{
		file: "lib/effect/services/manager.service.ts",
		functions: [
			"assignManager",
			"removeManager",
			"getManagers",
			"getPrimaryManager",
			"isManagerOf",
		],
		note: "manager link commands and lookups of one employee's own managers; assignManager refuses former employees through findEmployeesNotOnCurrentRoster",
	},
	{
		file: "components/dashboard/actions.ts",
		functions: [
			"getManagerTodaySummary",
			"getManagedEmployees",
			"getQuickStats",
			"getVacationBalanceResult",
		],
		note: "the viewer's own data; Your team delegates to managedEmployeeRows with the current roster",
	},
	{
		file: "app/[locale]/(app)/team/actions.ts",
		functions: ["load"],
		note: "the calendar selector's cached loader, part of a listed view of the past",
	},
	{
		file: "lib/teams/jobs/daily-digest.ts",
		functions: ["shouldSkipDigestForManager"],
		note: "the digest manager's own absence and schedule",
	},
	{
		file: "app/[locale]/(app)/absences/mutations.ts",
		functions: ["cancelAbsenceRequestForEmployee"],
		note: "cancels one employee's own request",
	},
	{
		file: "lib/time-tracking/closed-months/notifications.ts",
		functions: ["listManagedEmployeeIds"],
		note: "a manager's authority over employees, not a roster",
	},
	{
		file: "lib/time-tracking/vehicle-use/driving-details-missing-store.ts",
		functions: ["loadDrivingDetailsExpectations"],
		note: "expectations for employees the caller already chose",
	},
	{
		file: "app/[locale]/(app)/settings/employees/selectable-employees.ts",
		functions: ["loadSelectableEmployeePage"],
		note: "filters through employeeStatusCondition, current roster by default",
	},
	{
		file: "app/[locale]/(app)/settings/projects/actions.ts",
		functions: ["getProjectRelationshipEmployee"],
		note: "looks up the employee a save names; the save refuses former employees",
	},
	{
		file: "app/[locale]/(app)/settings/teams/actions.ts",
		functions: ["resolveTeamSettingsActor", "writeTeamMemberRemoval", "listTeams"],
		note: "the acting user, and removals, which stay possible for former employees",
	},
	{
		file: "lib/organization/driving-licence/verifier-actions.ts",
		functions: ["getDrivingLicenceVerifierResponsibilityAction"],
		note: "the verifier's own grant and the people it names",
	},
	{
		file: "lib/personnel-file/document-request-store.ts",
		functions: ["listManagedDocumentRequests"],
		note: "document requests already made, a view of the past",
	},
];

type FunctionBody = { name: string; body: string };

function collectFunctionBodies(source: string, fileName: string): FunctionBody[] {
	return withNativeSource(source, fileName, ({ sourceFile }) => {
		const bodies: FunctionBody[] = [];
		const record = (name: string, body: ts.Node | undefined) => {
			if (body) bodies.push({ name, body: source.slice(body.getStart(sourceFile), body.getEnd()) });
		};
		const functionLike = (node: ts.Node | undefined) =>
			node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) ? node : undefined;

		function visit(node: ts.Node) {
			if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) {
				if (ts.isIdentifier(node.name)) record(node.name.text, node.body);
			} else if (
				(ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node)) &&
				ts.isIdentifier(node.name)
			) {
				const fn = functionLike(node.initializer);
				if (fn) record(node.name.text, fn.body);
			}
			node.forEachChild(visit);
		}

		visit(sourceFile);
		return bodies;
	});
}

/**
 * The bodies of the named functions in a source file: declarations, methods,
 * and functions or arrows assigned to a variable or an object property. A name
 * declared twice in one file maps to null, so the list must name it uniquely.
 */
function functionBodies(source: string, fileName: string): Map<string, string | null> {
	const bodies = new Map<string, string | null>();
	for (const { name, body } of collectFunctionBodies(source, fileName)) {
		bodies.set(name, bodies.has(name) ? null : body);
	}
	return bodies;
}

/** Employee queries in a module that neither apply the rule nor are listed. */
function unclassifiedEmployeeQueries(
	source: string,
	fileName: string,
	classified: ReadonlySet<string>,
): string[] {
	return collectFunctionBodies(source, fileName)
		.filter(({ name, body }) => EMPLOYEE_QUERY.test(body) && !classified.has(name))
		.filter(({ body }) => rosterViolation(body) !== null)
		.map(({ name }) => name);
}

/** Hand-written employee active checks per source file, tests excluded. */
function rawActiveCheckCounts(): Record<string, number> {
	const counts: Record<string, number> = {};
	const pattern = new RegExp(RAW_EMPLOYEE_ACTIVE_CHECK, "g");
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir)) {
			const path = join(dir, entry);
			if (statSync(path).isDirectory()) {
				if (entry !== "node_modules" && entry !== "__tests__" && entry !== "testing") walk(path);
				continue;
			}
			if (
				!/\.tsx?$/.test(entry) ||
				/\.(?:test|spec)\.tsx?$/.test(entry) ||
				/\.test\.\w+\.ts$/.test(entry)
			) {
				continue;
			}
			const found = readFileSync(path, "utf8").match(pattern)?.length ?? 0;
			if (found > 0) counts[relative(SRC_ROOT, path).split(sep).join("/")] = found;
		}
	};
	walk(SRC_ROOT);
	return counts;
}

function rosterViolation(body: string): string | null {
	if (!ROSTER_RULE.test(body)) return "does not filter with the current-roster rule";
	if (RAW_EMPLOYEE_ACTIVE_CHECK.test(body)) return "uses a hand-written active check";
	return null;
}

const bodiesByFile = new Map<string, Map<string, string | null>>();

function bodyOf(file: string, fn: string): string | null | undefined {
	let bodies = bodiesByFile.get(file);
	if (!bodies) {
		bodies = functionBodies(readFileSync(join(SRC_ROOT, file), "utf8"), file);
		bodiesByFile.set(file, bodies);
	}
	return bodies.get(fn);
}

const entries = (surfaces: Surface[]) =>
	surfaces.flatMap((surface) => surface.functions.map((fn) => [surface.file, fn] as const));

describe("current-roster surface guard", () => {
	it.each([
		[
			"an unfiltered roster query",
			`async function listTeam(organizationId: string): Promise<{ id: string }[]> {
				return db.select().from(employee).where(eq(employee.organizationId, organizationId));
			}`,
			"does not filter with the current-roster rule",
		],
		[
			"a hand-written active check",
			`const listTeam = async ({ organizationId }: { organizationId: string }) => {
				return db.select().from(employee).where(and(eq(employee.isActive, true), onCurrentRoster(organizationId)));
			};`,
			"uses a hand-written active check",
		],
		[
			"a query filtered with the rule",
			`export async function listTeam(input: { organizationId: string }): Promise<{ id: string }[]> {
				return db.select().from(employee).where(and(onCurrentRoster(input.organizationId), eq(workPeriod.isActive, true)));
			}`,
			null,
		],
		[
			"a reader built on the rule",
			`const service = {
				listTeam: (organizationId: string) => currentRosterEmployeeIds(db, { organizationId }),
			};`,
			null,
		],
	] as const)("classifies %s", (_label, source, expected) => {
		const body = functionBodies(source, "/fixture.ts").get("listTeam");
		expect(body).toBeTruthy();
		expect(rosterViolation(body ?? "")).toBe(expected);
	});

	it("refuses a name declared twice in one file", () => {
		const bodies = functionBodies(
			`const a = { handler: () => onCurrentRoster("o") }; const b = { handler: () => 1 };`,
			"/fixture.ts",
		);
		expect(bodies.get("handler")).toBeNull();
	});

	it.each(entries(ROSTER_SURFACES))("%s %s filters with the current-roster rule", (file, fn) => {
		const body = bodyOf(file, fn);
		expect(body, `${fn} is missing or declared twice in ${file}`).toBeTruthy();
		expect(rosterViolation(body ?? "")).toBeNull();
	});

	it.each(entries(HISTORY_VIEWS))("%s %s still exists as a listed view of the past", (file, fn) => {
		expect(bodyOf(file, fn), `${fn} is missing or declared twice in ${file}`).toBeTruthy();
	});

	it("flags an unlisted employee query next to a roster surface", () => {
		const source = `
			export async function listTeam(organizationId: string) {
				return db.select().from(employee).where(onCurrentRoster(organizationId));
			}
			export async function listEveryone(organizationId: string) {
				return db.select().from(employee).where(eq(employee.organizationId, organizationId));
			}
			export async function workOf(id: string) {
				return db.select().from(workPeriod).where(eq(workPeriod.employeeId, id));
			}`;
		expect(unclassifiedEmployeeQueries(source, "/fixture.ts", new Set(["listTeam"]))).toEqual([
			"listEveryone",
		]);
	});

	it.each([...new Set(ROSTER_SURFACES.map((surface) => surface.file))])(
		"%s has no unclassified employee query",
		(file) => {
			const classified = new Set(
				[...ROSTER_SURFACES, ...HISTORY_VIEWS, ...EXEMPT_EMPLOYEE_QUERIES]
					.filter((surface) => surface.file === file)
					.flatMap((surface) => surface.functions),
			);
			expect(
				unclassifiedEmployeeQueries(readFileSync(join(SRC_ROOT, file), "utf8"), file, classified),
				"apply the current-roster rule, or list the function as a view of the past or an exemption",
			).toEqual([]);
		},
	);

	it("adds no hand-written employee active checks beyond the baseline", () => {
		const baseline = JSON.parse(
			readFileSync(
				join(SRC_ROOT, "lib/employee-lifecycle/raw-employee-active-checks.json"),
				"utf8",
			),
		) as Record<string, number>;
		const grown = Object.entries(rawActiveCheckCounts())
			.filter(([file, count]) => count > (baseline[file] ?? 0))
			.map(([file, count]) => `${file}: ${count} (baseline ${baseline[file] ?? 0})`);
		expect(
			grown,
			"use onCurrentRoster / isFormerEmployee from current-roster.ts instead of employee.isActive",
		).toEqual([]);
	});
});
