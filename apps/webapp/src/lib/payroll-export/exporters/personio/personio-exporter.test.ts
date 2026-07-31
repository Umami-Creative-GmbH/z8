import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AbsenceData, WageTypeMapping, WorkPeriodData } from "../../types";
import {
	PersonioExporter,
	selectPersonioEmployeeIdentifier,
} from "./personio-exporter";
import type {
	PersonioAbsenceRequest,
	PersonioAttendanceRequest,
	PersonioConfig,
} from "./types";

const apiClientMocks = vi.hoisted(() => ({
	createAttendances: vi.fn(),
	createAbsences: vi.fn(),
}));

vi.mock("./api-client", () => ({
	PersonioApiClient: class {
		createAttendances = apiClientMocks.createAttendances;
		createAbsences = apiClientMocks.createAbsences;
	},
}));

vi.mock("@/lib/vault/secrets", () => ({
	getOrgSecret: vi.fn().mockResolvedValue("personio-credential"),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	}),
}));

beforeEach(() => {
	vi.clearAllMocks();
	apiClientMocks.createAttendances.mockResolvedValue([
		{ success: true, externalId: 1 },
	]);
	apiClientMocks.createAbsences.mockResolvedValue([
		{ success: true, externalId: 2 },
	]);
});

describe("selectPersonioEmployeeIdentifier", () => {
	it("selects the available email for email matching", () => {
		expect(
			selectPersonioEmployeeIdentifier(
				{ employeeNumber: "E-42", email: "employee@example.com" },
				"email",
			),
		).toBe("employee@example.com");
	});

	it.each([
		"123abc",
		"123",
	])("preserves employee number %s exactly", (employeeNumber) => {
		expect(
			selectPersonioEmployeeIdentifier(
				{ employeeNumber, email: "employee@example.com" },
				"employeeNumber",
			),
		).toBe(employeeNumber);
	});

	it("returns null when the selected identifier is unavailable", () => {
		expect(
			selectPersonioEmployeeIdentifier(
				{ employeeNumber: "E-42", email: null },
				"email",
			),
		).toBeNull();
	});
});

describe("PersonioExporter identifier wiring", () => {
	it("uses work period email without changing attendance wall-clock fields", () => {
		const period: WorkPeriodData = {
			id: "period-1",
			employeeId: "employee-1",
			employeeNumber: "E-1",
			email: "period@example.com",
			firstName: "Pat",
			lastName: "Example",
			startTime: DateTime.fromISO("2026-07-28T09:15:00+02:00", {
				setZone: true,
			}),
			endTime: DateTime.fromISO("2026-07-28T17:45:00+02:00", { setZone: true }),
			durationMinutes: 510,
			workCategoryId: null,
			workCategoryName: null,
			workCategoryFactor: null,
			projectId: null,
			projectName: null,
		};

		const result = transformWorkPeriods([period], "email");

		expect(result[0]?.request).toMatchObject({
			employee: "period@example.com",
			date: "2026-07-28",
			start_time: "09:15",
			end_time: "17:45",
		});
	});

	it("uses absence email without changing date strings", () => {
		const absence: AbsenceData = {
			id: "absence-1",
			employeeId: "employee-1",
			employeeNumber: "E-1",
			email: "absence@example.com",
			firstName: "Pat",
			lastName: "Example",
			startDate: "2026-07-28",
			endDate: "2026-07-29",
			absenceCategoryId: "category-1",
			absenceCategoryName: "Vacation",
			absenceType: "vacation",
			status: "approved",
		};
		const mapping = createMapping();

		const result = transformAbsences(
			[absence],
			new Map([["category-1", mapping]]),
			"email",
		);

		expect(result[0]).toMatchObject({
			employee_id: "absence@example.com",
			start_date: "2026-07-28",
			end_date: "2026-07-29",
		});
	});

	it("passes the configured strategy to attendance and absence batches", async () => {
		const period: WorkPeriodData = {
			id: "period-batch",
			employeeId: "employee-1",
			employeeNumber: "OPS@BERLIN",
			email: "employee@example.com",
			firstName: "Pat",
			lastName: "Example",
			startTime: DateTime.fromISO("2026-07-28T09:15:00+02:00", {
				setZone: true,
			}),
			endTime: DateTime.fromISO("2026-07-28T17:45:00+02:00", {
				setZone: true,
			}),
			durationMinutes: 510,
			workCategoryId: null,
			workCategoryName: null,
			workCategoryFactor: null,
			projectId: null,
			projectName: null,
		};
		const absence: AbsenceData = {
			id: "absence-batch",
			employeeId: "employee-1",
			employeeNumber: "OPS@BERLIN",
			email: "employee@example.com",
			firstName: "Pat",
			lastName: "Example",
			startDate: "2026-07-28",
			endDate: "2026-07-29",
			absenceCategoryId: "category-1",
			absenceCategoryName: "Vacation",
			absenceType: "vacation",
			status: "approved",
		};

		await new PersonioExporter().export(
			"org-1",
			[period],
			[absence],
			[createMapping()],
			{ employeeMatchStrategy: "employeeNumber" },
		);

		expect(apiClientMocks.createAttendances).toHaveBeenCalledWith(
			[expect.objectContaining({ employee: "OPS@BERLIN" })],
			"employeeNumber",
		);
		expect(apiClientMocks.createAbsences).toHaveBeenCalledWith(
			[expect.objectContaining({ employee_id: "OPS@BERLIN" })],
			"employeeNumber",
		);
	});
});

type TestableExporter = {
	transformWorkPeriods(
		periods: WorkPeriodData[],
		config: PersonioConfig,
	): Array<{ request: PersonioAttendanceRequest; workPeriod: WorkPeriodData }>;
	transformAbsences(
		absences: AbsenceData[],
		mappings: Map<string, WageTypeMapping>,
		config: PersonioConfig,
	): Array<PersonioAbsenceRequest | null>;
};

function config(
	strategy: PersonioConfig["employeeMatchStrategy"],
): PersonioConfig {
	return {
		employeeMatchStrategy: strategy,
		includeZeroHours: false,
		batchSize: 100,
		apiTimeoutMs: 30_000,
	};
}

function transformWorkPeriods(
	periods: WorkPeriodData[],
	strategy: PersonioConfig["employeeMatchStrategy"],
) {
	return (
		new PersonioExporter() as unknown as TestableExporter
	).transformWorkPeriods(periods, config(strategy));
}

function transformAbsences(
	absences: AbsenceData[],
	mappings: Map<string, WageTypeMapping>,
	strategy: PersonioConfig["employeeMatchStrategy"],
) {
	return (
		new PersonioExporter() as unknown as TestableExporter
	).transformAbsences(absences, mappings, config(strategy));
}

function createMapping(): WageTypeMapping {
	return {
		id: "mapping-1",
		workCategoryId: null,
		absenceCategoryId: "category-1",
		specialCategory: null,
		wageTypeCode: "7",
		wageTypeName: "Vacation",
		datevWageTypeCode: null,
		datevWageTypeName: null,
		lexwareWageTypeCode: null,
		lexwareWageTypeName: null,
		sageWageTypeCode: null,
		sageWageTypeName: null,
		successFactorsTimeTypeCode: null,
		successFactorsTimeTypeName: null,
		factor: "1",
		isActive: true,
	};
}
