import { describe, expect, it } from "vitest";
import {
	ALL_OFFICER_SCOPE,
	isInOfficerScope,
	mergeOfficerScopes,
	type OfficerScope,
	resolveFinanceScopes,
} from "./officer-scope";

const BERLIN = "00000000-0000-4000-8000-00000000b001";
const MUNICH = "00000000-0000-4000-8000-00000000b002";
const ANNA = "00000000-0000-4000-8000-00000000e001";
const BEN = "00000000-0000-4000-8000-00000000e002";

const berlin: OfficerScope = { kind: "specific", teamIds: [BERLIN], employeeIds: [] };
const ben: OfficerScope = { kind: "specific", teamIds: [], employeeIds: [BEN] };

describe("isInOfficerScope", () => {
	it("covers every report with the all scope", () => {
		expect(isInOfficerScope(ALL_OFFICER_SCOPE, { employeeId: ANNA, approvalTeamIds: [] })).toBe(
			true,
		);
	});

	it("covers a report recorded with one of the grant's teams", () => {
		expect(isInOfficerScope(berlin, { employeeId: ANNA, approvalTeamIds: [MUNICH, BERLIN] })).toBe(
			true,
		);
		expect(isInOfficerScope(berlin, { employeeId: ANNA, approvalTeamIds: [MUNICH] })).toBe(false);
	});

	it("covers a named employee's report whatever teams it recorded", () => {
		expect(isInOfficerScope(ben, { employeeId: BEN, approvalTeamIds: [] })).toBe(true);
		expect(isInOfficerScope(ben, { employeeId: ANNA, approvalTeamIds: [BERLIN] })).toBe(false);
	});

	it("covers nothing without a scope", () => {
		expect(isInOfficerScope(null, { employeeId: ANNA, approvalTeamIds: [BERLIN] })).toBe(false);
	});
});

describe("mergeOfficerScopes", () => {
	it("is the union of two scopes", () => {
		expect(mergeOfficerScopes(berlin, ben)).toEqual({
			kind: "specific",
			teamIds: [BERLIN],
			employeeIds: [BEN],
		});
		expect(mergeOfficerScopes(berlin, ALL_OFFICER_SCOPE)).toEqual(ALL_OFFICER_SCOPE);
		expect(mergeOfficerScopes(null, berlin)).toEqual(berlin);
		expect(mergeOfficerScopes(null, null)).toBeNull();
	});
});

describe("resolveFinanceScopes", () => {
	const none = { read: false, settle: false, export: false };

	it("gives owners and admins everything", () => {
		expect(
			resolveFinanceScopes({
				organizationWide: { read: true, settle: true, export: true },
				grant: null,
			}),
		).toEqual({ read: ALL_OFFICER_SCOPE, settle: ALL_OFFICER_SCOPE, export: ALL_OFFICER_SCOPE });
	});

	it("gives an officer read access and only the capabilities of their grant, in its scope", () => {
		expect(
			resolveFinanceScopes({
				organizationWide: none,
				grant: { scope: berlin, canExport: true, canRecordReimbursements: false },
			}),
		).toEqual({ read: berlin, settle: null, export: berlin });
		expect(
			resolveFinanceScopes({
				organizationWide: none,
				grant: { scope: berlin, canExport: false, canRecordReimbursements: true },
			}),
		).toEqual({ read: berlin, settle: berlin, export: null });
	});

	it("keeps a grant with neither capability as read-only", () => {
		expect(
			resolveFinanceScopes({
				organizationWide: none,
				grant: { scope: ben, canExport: false, canRecordReimbursements: false },
			}),
		).toEqual({ read: ben, settle: null, export: null });
	});

	it("never exports without read access", () => {
		expect(
			resolveFinanceScopes({
				organizationWide: { read: false, settle: false, export: true },
				grant: null,
			}),
		).toEqual({ read: null, settle: null, export: null });
	});

	it("widens each capability separately when organization-wide access and a grant combine", () => {
		// Organization-wide reading and a Berlin grant that records reimbursements:
		// recording stays in Berlin.
		expect(
			resolveFinanceScopes({
				organizationWide: { read: true, settle: false, export: false },
				grant: { scope: berlin, canExport: false, canRecordReimbursements: true },
			}),
		).toEqual({ read: ALL_OFFICER_SCOPE, settle: berlin, export: null });
	});
});
