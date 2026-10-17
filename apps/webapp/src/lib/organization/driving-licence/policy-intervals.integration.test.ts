import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const harness = vi.hoisted(() => ({
	userId: "",
	organizationId: "",
	now: "2026-01-31T11:00:00Z",
}));
vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: async () =>
		harness.userId
			? {
					user: { id: harness.userId },
					session: { activeOrganizationId: harness.organizationId },
				}
			: null,
}));
vi.mock("@/lib/datetime/temporal-core", async (original) => {
	const actual =
		await original<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...actual,
		systemClock: { nowInstant: () => actual.parseInstant(harness.now) },
	};
});
const policy = await import("./policy-actions");
const checks = await import("./check-actions");
const grants = await import("./verifier-actions");
const intervals = await import("./interval-actions");
let fixture: LifecycleDatabaseFixture;
let verifier: SeededEmployee;
const initialPolicy = {
	enabled: true,
	intervalMonths: 6,
	timezone: "Europe/Berlin",
	reminderLeadDays: [30, 7],
	retentionMonths: 36,
	retentionJustification:
		"Our justified evidence retention for original checks",
};
function original(code = "B", expiryDate: string | null = null) {
	return {
		employeeId: fixture.employeeId,
		commandId: crypto.randomUUID(),
		originalInspected: true,
		identityConfirmed: true,
		employeeDeclaration: true,
		verifierConfirmed: true,
		documentIssuedOn: "2020-01-01",
		documentExpiresOn: "2035-01-01",
		classes: [{ code, result: "successful", expiryDate, restrictions: "" }],
	};
}
async function record() {
	harness.userId = verifier.userId;
	const result = await checks.getDrivingLicenceEmployeeRecordAction({
		employeeId: fixture.employeeId,
	});
	if (!result.success) throw new Error(result.error);
	return result.data;
}
beforeEach(async () => {
	fixture = await createLifecycleDatabaseFixture();
	verifier = await fixture.seedEmployee();
	harness.organizationId = fixture.organizationId;
	harness.now = "2026-01-31T11:00:00Z";
	harness.userId = fixture.ownerUserId;
	expect(
		(await policy.saveDrivingLicencePolicyAction(initialPolicy)).success,
	).toBe(true);
	expect(
		(
			await policy.enrollDrivingLicenceEmployeeAction({
				employeeId: fixture.employeeId,
			})
		).success,
	).toBe(true);
	expect(
		(
			await grants.saveDrivingLicenceVerifierGrantAction({
				verifierEmployeeId: verifier.employeeId,
				scope: "all",
				teamIds: [],
				employeeIds: [],
			})
		).success,
	).toBe(true);
	harness.userId = verifier.userId;
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(true);
});
afterEach(async () => {
	await fixture?.close();
});
it("previews and applies each class's own successful anchor while preserving original confirmations", async () => {
	harness.now = "2026-02-15T11:00:00Z";
	expect(
		(
			await checks.completeDrivingLicenceCheckAction(
				original("C", "2026-04-01"),
			)
		).success,
	).toBe(true);
	const before = await record();
	harness.now = "2026-03-01T23:00:00Z";
	harness.userId = fixture.ownerUserId;
	const preview = await intervals.previewDrivingLicenceIntervalAction({
		intervalMonths: 1,
	});
	expect(preview.success).toBe(true);
	if (!preview.success) return;
	expect(preview.data.classes).toEqual([
		expect.objectContaining({
			employeeId: fixture.employeeId,
			classCode: "B",
			routineValidThrough: "2026-02-28",
			validThrough: "2026-02-28",
			newlyOverdue: true,
			deadlineTimezone: "Europe/Berlin",
		}),
		expect.objectContaining({
			classCode: "C",
			routineValidThrough: "2026-03-15",
			validThrough: "2026-03-15",
			newlyOverdue: false,
		}),
	]);
	expect(JSON.stringify(preview.data)).not.toContain("documentIssuedOn");
	expect(
		await intervals.applyDrivingLicenceIntervalAction({
			intervalMonths: 1,
			previewToken: preview.data.previewToken,
		}),
	).toMatchObject({ success: true });
	const after = await record();
	expect(after.events).toContainEqual(
		expect.objectContaining({
			kind: "suspended",
			effectiveAt: "2026-03-01T23:00:00.000Z",
		}),
	);
	expect(after.authorizedClasses).toEqual(["C"]);
	expect(after.checks).toEqual(before.checks);
	expect(after.events).toContainEqual(
		expect.objectContaining({
			kind: "policy_interval_changed",
			actorUserId: fixture.ownerUserId,
			reason: "policy_version:2",
		}),
	);
});
it("refuses the raw-save bypass and preserves an overdue suspension when an extension races a delayed worker", async () => {
	harness.userId = fixture.ownerUserId;
	expect(
		await policy.saveDrivingLicencePolicyAction({
			...initialPolicy,
			intervalMonths: 12,
		}),
	).toEqual({ success: false, error: "interval_preview_required" });
	harness.now = "2026-07-31T21:59:59Z";
	const preview = await intervals.previewDrivingLicenceIntervalAction({
		intervalMonths: 12,
	});
	expect(preview.success).toBe(true);
	if (!preview.success) return;
	harness.now = "2026-07-31T22:00:00Z";
	expect(
		await intervals.applyDrivingLicenceIntervalAction({
			intervalMonths: 12,
			previewToken: preview.data.previewToken,
		}),
	).toEqual({ success: false, error: "stale_preview" });
	const fresh = await intervals.previewDrivingLicenceIntervalAction({
		intervalMonths: 12,
	});
	if (!fresh.success) throw new Error(fresh.error);
	expect(fresh.data.classes[0].remainsSuspended).toBe(true);
	expect(
		(
			await intervals.applyDrivingLicenceIntervalAction({
				intervalMonths: 12,
				previewToken: fresh.data.previewToken,
			})
		).success,
	).toBe(true);
	const after = await record();
	expect(after.authorizedClasses).toEqual([]);
	expect(after.classes[0]).toMatchObject({
		status: "suspended",
		reason: "check_overdue",
		validThrough: "2027-01-31",
	});
	expect(after.events).toContainEqual(
		expect.objectContaining({
			kind: "suspended",
			effectiveAt: "2026-07-31T22:00:00.000Z",
		}),
	);
});
it("rejects intervening checks and employee reports, keeps failures suspended, and denies unrelated actors", async () => {
	harness.userId = fixture.ownerUserId;
	const preview = await intervals.previewDrivingLicenceIntervalAction({
		intervalMonths: 12,
	});
	if (!preview.success) throw new Error(preview.error);
	harness.userId = verifier.userId;
	harness.now = "2026-02-01T11:00:00Z";
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(true);
	expect(
		await intervals.previewDrivingLicenceIntervalAction({ intervalMonths: 12 }),
	).toEqual({ success: false, error: "forbidden" });
	harness.userId = fixture.ownerUserId;
	expect(
		await intervals.applyDrivingLicenceIntervalAction({
			intervalMonths: 12,
			previewToken: preview.data.previewToken,
		}),
	).toEqual({ success: false, error: "stale_preview" });
	const fresh = await intervals.previewDrivingLicenceIntervalAction({
		intervalMonths: 12,
	});
	if (!fresh.success) throw new Error(fresh.error);
	const subject = await fixture.db.query.employee.findFirst({
		where: (employee, { eq }) => eq(employee.id, fixture.employeeId),
	});
	if (!subject) throw new Error("Missing subject");
	harness.userId = subject.userId;
	const impediments = await import("./impediment-actions");
	expect(
		(
			await impediments.reportDrivingImpedimentAction({
				commandId: crypto.randomUUID(),
			})
		).success,
	).toBe(true);
	harness.userId = fixture.ownerUserId;
	expect(
		await intervals.applyDrivingLicenceIntervalAction({
			intervalMonths: 12,
			previewToken: fresh.data.previewToken,
		}),
	).toEqual({ success: false, error: "stale_preview" });
	const reported = await intervals.previewDrivingLicenceIntervalAction({
		intervalMonths: 12,
	});
	if (!reported.success) throw new Error(reported.error);
	expect(
		(
			await intervals.applyDrivingLicenceIntervalAction({
				intervalMonths: 12,
				previewToken: reported.data.previewToken,
			})
		).success,
	).toBe(true);
	expect((await record()).authorizedClasses).toEqual([]);
	harness.userId = fixture.ownerUserId;
	const foreign = await createLifecycleDatabaseFixture();
	try {
		harness.organizationId = foreign.organizationId;
		expect(
			await intervals.applyDrivingLicenceIntervalAction({
				intervalMonths: 12,
				previewToken: reported.data.previewToken,
			}),
		).toEqual({ success: false, error: "forbidden" });
	} finally {
		await foreign.close();
	}
});
it("preserves earlier class and document expiry, failed-class anchors and inclusive DST deadlines", async () => {
	harness.now = "2026-03-28T22:30:00Z";
	expect(
		(
			await checks.completeDrivingLicenceCheckAction(
				original("C", "2026-03-29"),
			)
		).success,
	).toBe(true);
	harness.userId = fixture.ownerUserId;
	const preview = await intervals.previewDrivingLicenceIntervalAction({
		intervalMonths: 12,
	});
	if (!preview.success) throw new Error(preview.error);
	expect(
		preview.data.classes.find((row) => row.classCode === "C"),
	).toMatchObject({
		validThrough: "2026-03-29",
		expiresAt: "2026-03-29T22:00:00Z",
		newlyOverdue: false,
	});
	expect(
		(
			await intervals.applyDrivingLicenceIntervalAction({
				intervalMonths: 12,
				previewToken: preview.data.previewToken,
			})
		).success,
	).toBe(true);
	harness.now = "2026-03-29T22:00:00Z";
	harness.userId = verifier.userId;
	const failed = original();
	failed.classes[0].result = "unsuccessful";
	expect((await checks.completeDrivingLicenceCheckAction(failed)).success).toBe(
		true,
	);
	harness.userId = fixture.ownerUserId;
	const next = await intervals.previewDrivingLicenceIntervalAction({
		intervalMonths: 24,
	});
	if (!next.success) throw new Error(next.error);
	expect(next.data.classes.find((row) => row.classCode === "B")).toMatchObject({
		routineValidThrough: "2028-01-31",
		remainsSuspended: true,
	});
	expect(
		(
			await intervals.applyDrivingLicenceIntervalAction({
				intervalMonths: 24,
				previewToken: next.data.previewToken,
			})
		).success,
	).toBe(true);
	const after = await record();
	expect(after.authorizedClasses).toEqual([]);
	expect(after.classes.find((row) => row.code === "B")?.reason).toBe(
		"check_unsuccessful",
	);
	expect(after.classes.find((row) => row.code === "C")?.reason).toBe(
		"class_expired",
	);
});

it("keeps previews independent of viewer timezone, rejects policy changes and malformed client state", async () => {
	harness.userId = fixture.ownerUserId;
	const oldZone = process.env.TZ;
	try {
		process.env.TZ = "Pacific/Honolulu";
		const first = await intervals.previewDrivingLicenceIntervalAction({
			intervalMonths: 1,
		});
		process.env.TZ = "Asia/Tokyo";
		const second = await intervals.previewDrivingLicenceIntervalAction({
			intervalMonths: 1,
		});
		expect(second).toEqual(first);
		if (!first.success) throw new Error(first.error);
		expect(
			await intervals.applyDrivingLicenceIntervalAction({
				intervalMonths: 1,
				previewToken: first.data.previewToken,
				classes: [],
			}),
		).toEqual({ success: false, error: "invalid_interval" });
		expect(
			(
				await policy.saveDrivingLicencePolicyAction({
					...initialPolicy,
					reminderLeadDays: [7],
				})
			).success,
		).toBe(true);
		expect(
			await intervals.applyDrivingLicenceIntervalAction({
				intervalMonths: 1,
				previewToken: first.data.previewToken,
			}),
		).toEqual({ success: false, error: "stale_preview" });
		expect(
			await intervals.previewDrivingLicenceIntervalAction({
				intervalMonths: 0,
			}),
		).toEqual({ success: false, error: "invalid_interval" });
	} finally {
		process.env.TZ = oldZone;
	}
});
it("keeps an earlier document expiry after extending the routine interval", async () => {
	const check = original();
	check.documentExpiresOn = "2026-02-28";
	expect((await checks.completeDrivingLicenceCheckAction(check)).success).toBe(
		true,
	);
	harness.userId = fixture.ownerUserId;
	const preview = await intervals.previewDrivingLicenceIntervalAction({
		intervalMonths: 12,
	});
	if (!preview.success) throw new Error(preview.error);
	expect(preview.data.classes[0]).toMatchObject({
		routineValidThrough: "2027-01-31",
		validThrough: "2026-02-28",
	});
	expect(
		(
			await intervals.applyDrivingLicenceIntervalAction({
				intervalMonths: 12,
				previewToken: preview.data.previewToken,
			})
		).success,
	).toBe(true);
	harness.now = "2026-02-28T23:00:00Z";
	expect((await record()).classes[0]).toMatchObject({
		status: "suspended",
		reason: "document_expired",
	});
});
