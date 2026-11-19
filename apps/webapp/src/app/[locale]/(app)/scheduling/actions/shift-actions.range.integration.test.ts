import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
	createShiftDatabaseFixture,
	type ShiftDatabaseFixture,
} from "@/lib/scheduling/testing/shift-database.test.fixture";

// Synthetic session-provider boundary; employee scope, action, date conversion,
// ShiftService and the disposable PostgreSQL reader are all real.
const caller = vi.hoisted(() => ({ userId: "", organizationId: "" }));

vi.mock("@/lib/effect/runtime", async () => {
	const { Layer } = await import("effect");
	const { db } = await import("@/db");
	const { ShiftServiceLive } = await import("@/lib/effect/services/shift.service");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	const boundary = organizationActionStubLayer(
		() => ({
			userId: caller.userId,
			activeOrganizationId: caller.organizationId,
			membershipRole: "owner",
			employee: null,
		}),
		{ db },
	);
	return (await import("@/test/effect-runtime")).runtimeModuleOver(
		ShiftServiceLive.pipe(Layer.provideMerge(boundary)),
	);
});

const { getShifts } = await import("./shift-actions");

let fixture: ShiftDatabaseFixture;
beforeAll(async () => {
	fixture = await createShiftDatabaseFixture();
});
afterAll(async () => {
	await fixture?.close();
});

it("returns only the selected organization-local week through the public getShifts action", async () => {
	const org = await fixture.organization("Europe/Berlin");
	const foreign = await fixture.organization("Europe/Berlin");
	caller.userId = org.creator.userId;
	caller.organizationId = org.organizationId;
	await fixture.shift(org, {
		employeeId: null,
		stored: "2026-11-14T23:00:00Z",
		status: "draft",
	});
	const inside = await fixture.shift(org, {
		employeeId: null,
		stored: "2026-11-15T23:00:00Z",
		status: "draft",
	});
	await fixture.shift(org, {
		employeeId: null,
		stored: "2026-11-22T23:00:00Z",
		status: "draft",
	});
	await fixture.shift(foreign, {
		employeeId: null,
		stored: "2026-11-15T23:00:00Z",
		status: "draft",
	});

	const result = await getShifts({
		startDate: "2026-11-16",
		endDateExclusive: "2026-11-23",
		status: "draft",
		includeOpenShifts: true,
	});
	expect(result).toMatchObject({ success: true, data: [{ id: inside }] });
	if (!result.success) throw new Error("Expected admitted synthetic caller");
	expect(result.data.map((record) => record.id)).toEqual([inside]);
});

it("preserves an unbounded own-organization read when no range is requested", async () => {
	const org = await fixture.organization("Europe/Berlin");
	caller.userId = org.creator.userId;
	caller.organizationId = org.organizationId;
	const ids = await Promise.all([
		fixture.shift(org, { employeeId: null, stored: "2026-11-14T23:00:00Z", status: "draft" }),
		fixture.shift(org, { employeeId: null, stored: "2026-11-22T23:00:00Z", status: "draft" }),
	]);
	const result = await getShifts({ status: "draft", includeOpenShifts: true });
	if (!result.success) throw new Error("Expected admitted synthetic caller");
	expect(new Set(result.data.map((record) => record.id))).toEqual(new Set(ids));
});

it("keeps an employee's week published-only and refuses a different employee filter", async () => {
	const org = await fixture.organization("Europe/Berlin");
	const person = await fixture.seedEmployee({ organizationId: org.organizationId });
	const peer = await fixture.seedEmployee({ organizationId: org.organizationId });
	caller.userId = person.userId;
	caller.organizationId = org.organizationId;
	const inside = await fixture.shift(org, {
		employeeId: person.employeeId,
		stored: "2026-11-15T23:00:00Z",
	});
	await fixture.shift(org, { employeeId: person.employeeId, stored: "2026-11-14T23:00:00Z" });
	await fixture.shift(org, { employeeId: person.employeeId, stored: "2026-11-22T23:00:00Z" });
	await fixture.shift(org, {
		employeeId: person.employeeId,
		stored: "2026-11-15T23:00:00Z",
		status: "draft",
	});
	await fixture.shift(org, { employeeId: peer.employeeId, stored: "2026-11-15T23:00:00Z" });
	const range = { startDate: "2026-11-16", endDateExclusive: "2026-11-23" };
	const result = await getShifts({ ...range, status: "draft", includeOpenShifts: false });
	if (!result.success) throw new Error("Expected admitted synthetic caller");
	expect(result.data.map((record) => record.id)).toEqual([inside]);
	expect(await getShifts({ ...range, employeeId: peer.employeeId })).toMatchObject({
		success: false,
		code: "AuthorizationError",
	});
});
