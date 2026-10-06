import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const actionsSource = readFileSync(fileURLToPath(new URL("./actions.ts", import.meta.url)), "utf8");
const serviceSource = readFileSync(
	fileURLToPath(
		new URL("../../../../../lib/effect/services/compliance-guardrail.service.ts", import.meta.url),
	),
	"utf8",
);

function functionBody(source: string, name: string) {
	const start = source.indexOf(`export async function ${name}`);
	expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);
	const nextExport = source.indexOf("export async function", start + 1);
	return source.slice(start, nextExport === -1 ? undefined : nextExport);
}

describe("compliance exception decision authorization", () => {
	it("uses approved active-organization context for all employee compliance actions", () => {
		const start = actionsSource.indexOf("async function getCurrentEmployeeWithTimezone");
		const end = actionsSource.indexOf("function typeEmployeeWithUser", start);
		const body = actionsSource.slice(start, end);

		expect(body).toContain("await requireAuth()");
		expect(body).toContain("eq(employee.organizationId, authContext.employee.organizationId)");
		expect(body).toContain("eq(employee.isActive, true)");
	});

	it.each([
		["approveComplianceException", "approve"],
		["rejectComplianceException", "reject"],
	])("secures %s with tenant-scoped CASL and self-approval checks", (name, action) => {
		const body = functionBody(actionsSource, name);
		const authorizationStart = actionsSource.indexOf(
			"async function authorizeComplianceExceptionDecision",
		);
		const authorizationEnd = actionsSource.indexOf("// Layer composition", authorizationStart);
		const authorizationBody = actionsSource.slice(authorizationStart, authorizationEnd);

		expect(body).toContain("authorizeComplianceExceptionDecision({");
		expect(body).toContain(`action: "${action}"`);
		expect(authorizationBody).toContain("authContext.session.activeOrganizationId");
		expect(authorizationBody).toContain("eq(employee.organizationId, organizationId)");
		expect(authorizationBody).toContain("eq(employee.isActive, true)");
		expect(authorizationBody).toContain("eq(complianceException.organizationId, organizationId)");
		expect(authorizationBody).toContain("exception.employeeId === approver.id");
		expect(authorizationBody).toContain("requireAbility()");
		expect(authorizationBody).toContain("ability.can(");
		expect(authorizationBody).toContain("input.action,");
		expect(authorizationBody).toContain('asAppSubject("Approval"');
	});

	it("enforces tenant and self-approval constraints in the service update", () => {
		for (const name of ["approveException", "rejectException"]) {
			const start = serviceSource.indexOf(`${name}: (params) =>`);
			const next = serviceSource.indexOf("Exception:", start + name.length);
			const body = serviceSource.slice(start, next === -1 ? undefined : next);

			expect(body).toContain("eq(complianceException.organizationId, params.organizationId)");
			expect(body).toContain("ne(complianceException.employeeId, params.approverId)");
		}
	});

	it("authorizes pending-list and expiry actions and applies manager scope in the service", () => {
		expect(functionBody(actionsSource, "getPendingExceptions")).toContain("await requireAbility()");
		expect(functionBody(actionsSource, "expireOldExceptions")).toContain(
			'ability.can("manage", "Compliance")',
		);
		expect(serviceSource).toContain("eq(employeeManagers.managerId, params.managerId)");
		expect(serviceSource).toContain("inArray(complianceException.employeeId, managedEmployeeIds)");
	});
});
