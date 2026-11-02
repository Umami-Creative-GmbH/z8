import { loadGoLivePayrollSetup, payrollPrerequisitesOf } from "../payroll-prerequisites";
import type {
	GoLiveAffectedMember,
	GoLiveFailureGroup,
	GoLiveMember,
	GoLiveMessage,
} from "../types";
import type { GoLiveCheck } from "./types";

/** Where export targets and wage-type mappings are set up. */
export const PAYROLL_EXPORT_SETTINGS_HREF = "/settings/payroll-export";
/** Where employment terms and personnel identifiers are fixed. */
export const EMPLOYEES_SETTINGS_HREF = "/settings/employees";

type EmployeeMember = Extract<GoLiveMember, { kind: "employee" }>;

/**
 * Payroll setup: payroll readiness's setup checks (export target, wage-type
 * mappings, confirmed employment terms, personnel identifier clashes), never
 * its period-bound ones. Mandatory only while the organization has an active
 * payroll export target; otherwise an optional integration that never blocks.
 * Missing terms are advisory, as payroll readiness rates them. Invitees are
 * skipped for the per-employee checks until they join.
 */
export const payrollSetupGoLiveCheck: GoLiveCheck = {
	id: "payroll-setup",
	itemId: "payroll-readiness",
	// A failed lookup can't tell whether a target exists, so it counts as mandatory.
	severity: "mandatory",
	async run({ db, organizationId, asOf, group, fixLink }) {
		const employees = group.members.filter(
			(member): member is EmployeeMember => member.kind === "employee",
		);
		const setup = await loadGoLivePayrollSetup(db, {
			organizationId,
			asOf,
			employeeIds: employees.map((member) => member.employeeId),
		});
		if (setup.personnelIdentifiers.status === "unavailable") return { outcome: "unavailable" };

		if (setup.exportTargetCount === 0) {
			return {
				outcome: "passed",
				configured: false,
				failures: [],
				warnings: [],
				notes: [
					{
						key: "settings.implementationChecklist.goLive.payrollSetup.optional",
						fallback:
							"No active payroll export target, so payroll export is an optional integration and doesn't block going live.",
					},
				],
				severity: "advisory",
			};
		}

		const payrollExportFix = fixLink(PAYROLL_EXPORT_SETTINGS_HREF, {
			key: "settings.implementationChecklist.goLive.payrollSetup.fixPayrollExport",
			fallback: "Open payroll export settings",
		});
		const employeesFix = fixLink(EMPLOYEES_SETTINGS_HREF, {
			key: "settings.implementationChecklist.goLive.payrollSetup.fixEmployees",
			fallback: "Review employees",
		});
		const failures: GoLiveFailureGroup[] = [];
		const warnings: GoLiveFailureGroup[] = [];

		// Without mappings no export can classify anyone's hours, invitees' included.
		if (setup.wageTypeMappings.status === "fail") {
			failures.push({
				cause: "payroll-setup:wage-type-mappings",
				reason: {
					key: "settings.implementationChecklist.goLive.payrollSetup.noWageTypeMappings",
					fallback:
						"No active wage-type mappings, so payroll exports can't classify hours: {count, plural, one {# member} other {# members}}",
					params: { count: group.members.length },
				},
				members: group.members.map((member) => ({ member })),
				fix: payrollExportFix,
			});
		}

		const shared: GoLiveAffectedMember[] = [];
		const missingTerms: GoLiveAffectedMember[] = [];
		for (const member of employees) {
			const prerequisites = payrollPrerequisitesOf(setup, member);
			if (prerequisites.personnelIdentifier.status === "shared") {
				shared.push({
					member,
					detail: {
						key: "settings.implementationChecklist.goLive.payrollSetup.sharedPersonnelIdentifierDetail",
						fallback: "{identifier}, shared with {others}",
						params: {
							identifier: prerequisites.personnelIdentifier.identifier,
							others: prerequisites.personnelIdentifier.sharedWith.join(", "),
						},
					},
				});
			}
			if (prerequisites.employmentTerms === "missing") missingTerms.push({ member });
		}
		if (shared.length) {
			failures.push({
				cause: "payroll-setup:personnel-identifiers",
				reason: {
					key: "settings.implementationChecklist.goLive.payrollSetup.sharedPersonnelIdentifiers",
					fallback:
						"Payroll exports would merge employees under a shared personnel identifier: {count, plural, one {# employee} other {# employees}}",
					params: { count: shared.length },
				},
				members: shared,
				fix: employeesFix,
			});
		}
		if (missingTerms.length) {
			warnings.push({
				cause: "payroll-setup:employment-terms",
				reason: {
					key: "settings.implementationChecklist.goLive.payrollSetup.missingEmploymentTerms",
					fallback:
						"No confirmed employment terms covering today: {count, plural, one {# employee} other {# employees}}",
					params: { count: missingTerms.length },
				},
				members: missingTerms,
				fix: employeesFix,
			});
		}

		const inviteeCount = group.members.length - employees.length;
		const notes: GoLiveMessage[] = inviteeCount
			? [
					{
						key: "settings.implementationChecklist.goLive.payrollSetup.inviteesSkipped",
						fallback:
							"{count, plural, one {# invited person is} other {# invited people are}} skipped for employment terms and personnel identifiers until they join.",
						params: { count: inviteeCount },
					},
				]
			: [];

		return {
			outcome: failures.length ? "failed" : "passed",
			configured: true,
			failures,
			warnings,
			notes,
		};
	},
};
