import { afterEach, describe, expect, it, vi } from "vitest";
import { PersonioApiClient, PersonioApiError } from "./api-client";
import type {
	PersonioAbsenceRequest,
	PersonioAttendanceRequest,
} from "./types";

const logger = vi.hoisted(() => ({
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => logger,
}));

const credentials = {
	clientId: "personio-client-id",
	clientSecret: "personio-client-secret",
};

const attendance: PersonioAttendanceRequest = {
	employee: 42,
	date: "2026-07-28",
	start_time: "09:00",
	end_time: "17:00",
	break: 30,
};

const absence: PersonioAbsenceRequest = {
	employee_id: 42,
	time_off_type_id: 7,
	start_date: "2026-07-28",
	end_date: "2026-07-29",
	half_day_start: true,
	comment: "Annual leave",
};

const authSuccess = (expiresIn?: number) =>
	jsonResponse({
		success: true,
		data: {
			token: "personio-token",
			...(expiresIn === undefined ? {} : { expires_in: expiresIn }),
		},
	});

const attendanceSuccess = (id: number) =>
	jsonResponse({
		success: true,
		data: { id: [id], message: "Attendance created" },
	});

const timeOffSuccess = (id: number) =>
	jsonResponse({
		success: true,
		data: {
			type: "TimeOffPeriod",
			attributes: { id },
		},
	});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe("PersonioApiClient authentication", () => {
	it("authenticates once, caches the token, and keeps request metadata unchanged", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(authSuccess())
			.mockResolvedValueOnce(attendanceSuccess(101))
			.mockResolvedValueOnce(attendanceSuccess(102));
		vi.stubGlobal("fetch", fetchMock);
		const client = new PersonioApiClient(credentials);

		await expect(client.createAttendance(attendance)).resolves.toEqual({
			success: true,
			externalId: 101,
		});
		await expect(client.createAttendance(attendance)).resolves.toEqual({
			success: true,
			externalId: 102,
		});

		expect(fetchMock).toHaveBeenCalledTimes(3);
		const [authUrl, authOptions] = fetchMock.mock.calls[0] as [
			string,
			RequestInit,
		];
		expect(authUrl).toBe("https://api.personio.de/v1/auth");
		expect(authOptions).toMatchObject({
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
		});
		expect(authOptions.body).toBe(
			JSON.stringify({
				client_id: credentials.clientId,
				client_secret: credentials.clientSecret,
			}),
		);

		const [requestUrl, requestOptions] = fetchMock.mock.calls[1] as [
			string,
			RequestInit,
		];
		expect(requestUrl).toBe("https://api.personio.de/v1/company/attendances");
		expect(requestOptions.method).toBe("POST");
		const requestHeaders = new Headers(requestOptions.headers);
		expect(requestHeaders.get("Authorization")).toBe("Bearer personio-token");
		expect(requestHeaders.get("Content-Type")).toBe("application/json");
		expect(requestHeaders.get("Accept")).toBe("application/json");
		expect(JSON.parse(requestOptions.body as string)).toEqual({
			attendances: [attendance],
		});

		const loggedValues = JSON.stringify([
			...logger.info.mock.calls,
			...logger.warn.mock.calls,
			...logger.error.mock.calls,
		]);
		expect(loggedValues).not.toContain(credentials.clientId);
		expect(loggedValues).not.toContain(credentials.clientSecret);
		expect(loggedValues).not.toContain("personio-token");
	});

	it("uses a positive expires_in value for token expiry", async () => {
		vi.useFakeTimers();
		vi.setSystemTime("2026-07-28T12:00:00.000Z");
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(authSuccess(3600)));
		const client = new PersonioApiClient(credentials);

		await authenticate(client);

		expect(getAuthToken(client)).toEqual({
			token: "personio-token",
			expiresAt: Date.parse("2026-07-28T13:00:00.000Z"),
		});
	});

	it("falls back to a 24 hour token expiry", async () => {
		vi.useFakeTimers();
		vi.setSystemTime("2026-07-28T12:00:00.000Z");
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(authSuccess()));
		const client = new PersonioApiClient(credentials);

		await authenticate(client);

		expect(getAuthToken(client)).toEqual({
			token: "personio-token",
			expiresAt: Date.parse("2026-07-29T12:00:00.000Z"),
		});
	});

	it.each([0, -1])("rejects invalid expires_in value %i", async (expiresIn) => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(authSuccess(expiresIn)));

		const error = await capturePersonioError(() =>
			authenticate(new PersonioApiClient(credentials)),
		);

		expect(error).toMatchObject({
			message: "Authentication failed: Invalid response",
			statusCode: 200,
			isRetryable: false,
		});
	});

	it("preserves a structured non-2xx authentication error", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				jsonResponse(
					{
						success: false,
						error: { code: 1001, message: "Invalid credentials" },
					},
					401,
				),
			),
		);

		const error = await capturePersonioError(() =>
			authenticate(new PersonioApiClient(credentials)),
		);

		expect(error).toMatchObject({
			message: "Authentication failed: Invalid credentials",
			statusCode: 401,
			isRetryable: false,
			errorCode: 1001,
		});
	});

	it("uses the HTTP status for a non-JSON authentication failure", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("Bad gateway", { status: 502 })),
		);

		const error = await capturePersonioError(() =>
			authenticate(new PersonioApiClient(credentials)),
		);

		expect(error).toMatchObject({
			message: "Authentication failed: HTTP 502",
			statusCode: 502,
			isRetryable: true,
		});
	});

	it.each([
		408, 429, 500,
	])("marks authentication HTTP %i as retryable", async (status) => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				jsonResponse(
					{
						success: false,
						error: { code: 1002, message: "Authentication unavailable" },
					},
					status,
				),
			),
		);

		const error = await capturePersonioError(() =>
			authenticate(new PersonioApiClient(credentials)),
		);

		expect(error).toMatchObject({
			message: "Authentication failed: Authentication unavailable",
			statusCode: status,
			isRetryable: true,
			errorCode: 1002,
		});
	});

	it("returns a typed non-retryable error for a malformed successful authentication response", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("not json", { status: 200 })),
		);

		const error = await capturePersonioError(() =>
			authenticate(new PersonioApiClient(credentials)),
		);

		expect(error).toMatchObject({
			message: "Authentication failed: Invalid response",
			statusCode: 200,
			isRetryable: false,
		});
	});

	it.each([
		"",
		"   ",
	])("rejects an empty token before caching it", async (token) => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(jsonResponse({ success: true, data: { token } })),
		);

		const error = await capturePersonioError(() =>
			authenticate(new PersonioApiClient(credentials)),
		);

		expect(error).toMatchObject({
			message: "Authentication failed: Invalid response",
			statusCode: 200,
			isRetryable: false,
		});
	});

	it("keeps authentication timeouts retryable", async () => {
		const timeoutError = new Error("timed out");
		timeoutError.name = "TimeoutError";
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeoutError));

		const error = await capturePersonioError(() =>
			authenticate(new PersonioApiClient(credentials)),
		);

		expect(error).toMatchObject({
			message: "Authentication error: timed out",
			isRetryable: true,
		});
	});
});

describe("PersonioApiClient authenticated requests", () => {
	it("preserves structured JSON errors through a public method", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(authSuccess())
				.mockResolvedValueOnce(
					jsonResponse(
						{
							success: false,
							error: { code: 2007, message: "Attendance rejected" },
						},
						422,
					),
				),
		);

		await expect(
			new PersonioApiClient(credentials).createAttendance(attendance),
		).resolves.toEqual({
			success: false,
			error: { message: "Attendance rejected", code: 422, isRetryable: false },
		});
	});

	it("preserves status, code, message, and retryability on PersonioApiError", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(authSuccess())
				.mockResolvedValueOnce(
					jsonResponse(
						{ success: false, error: { code: 2007, message: "Rate limited" } },
						429,
					),
				),
		);
		const client = new PersonioApiClient(credentials);

		const error = await capturePersonioError(() =>
			request(client, "/company/attendances"),
		);

		expect(error).toMatchObject({
			message: "Rate limited",
			statusCode: 429,
			isRetryable: true,
			errorCode: 2007,
		});
	});

	it("uses the HTTP status for a non-JSON request failure", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(authSuccess())
				.mockResolvedValueOnce(
					new Response("Service unavailable", { status: 503 }),
				),
		);

		await expect(
			new PersonioApiClient(credentials).createAttendance(attendance),
		).resolves.toEqual({
			success: false,
			error: { message: "HTTP 503", code: 503, isRetryable: true },
		});
	});

	it.each([
		[408, true],
		[429, true],
		[500, true],
		[400, false],
	])("marks HTTP %i retryability as %s", async (status, isRetryable) => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(authSuccess())
				.mockResolvedValueOnce(
					jsonResponse(
						{
							success: false,
							error: { code: 2000, message: "Request failed" },
						},
						status,
					),
				),
		);

		await expect(
			new PersonioApiClient(credentials).createAttendance(attendance),
		).resolves.toEqual({
			success: false,
			error: { message: "Request failed", code: status, isRetryable },
		});
	});

	it("returns successful response data through a public method", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(authSuccess())
				.mockResolvedValueOnce(attendanceSuccess(321)),
		);

		await expect(
			new PersonioApiClient(credentials).createAttendance(attendance),
		).resolves.toEqual({
			success: true,
			externalId: 321,
		});
	});

	it("rejects attendance success data without a finite numeric id", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(authSuccess())
				.mockResolvedValueOnce(
					jsonResponse({
						success: true,
						data: { id: [], message: "No attendance created" },
					}),
				),
		);

		await expect(
			new PersonioApiClient(credentials).createAttendance(attendance),
		).resolves.toEqual({
			success: false,
			error: {
				message: "Invalid Personio API response",
				code: 200,
				isRetryable: false,
			},
		});
	});

	it("rejects absence success data without a finite numeric id", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(authSuccess())
				.mockResolvedValueOnce(
					jsonResponse({
						success: true,
						data: {
							type: "TimeOffPeriod",
							attributes: { id: "not-a-number" },
						},
					}),
				),
		);

		await expect(
			new PersonioApiClient(credentials).createAbsence(absence),
		).resolves.toEqual({
			success: false,
			error: {
				message: "Invalid Personio API response",
				code: 200,
				isRetryable: false,
			},
		});
	});

	it("returns a validated absence id", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(authSuccess())
			.mockResolvedValueOnce(timeOffSuccess(654));
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			new PersonioApiClient(credentials).createAbsence(absence),
		).resolves.toEqual({ success: true, externalId: 654 });

		const [, requestOptions] = fetchMock.mock.calls[1] as [string, RequestInit];
		const headers = new Headers(requestOptions.headers);
		expect(headers.get("Content-Type")).toBe(
			"application/x-www-form-urlencoded",
		);
		expect(headers.get("Authorization")).toBe("Bearer personio-token");
		expect(
			Object.fromEntries(new URLSearchParams(requestOptions.body as string)),
		).toEqual({
			employee_id: "42",
			time_off_type_id: "7",
			start_date: "2026-07-28",
			end_date: "2026-07-29",
			half_day_start: "1",
			half_day_end: "0",
			comment: "Annual leave",
		});
	});

	it("rejects malformed employee arrays during connection testing", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(authSuccess())
				.mockResolvedValueOnce(
					jsonResponse({
						success: true,
						data: [
							{
								type: "Employee",
								attributes: {
									id: { value: 7 },
									email: "missing-value-wrapper@example.com",
									first_name: { value: "Alex" },
									last_name: { value: "Example" },
								},
							},
						],
					}),
				),
		);

		await expect(
			new PersonioApiClient(credentials).testConnection(),
		).resolves.toEqual({
			success: false,
			error: "Invalid Personio API response",
		});
		expect(logger.error).toHaveBeenCalledWith(
			{
				error: expect.objectContaining({
					message: "Invalid Personio API response",
					statusCode: 200,
					isRetryable: false,
				}),
			},
			"Connection test failed",
		);
	});

	it("normalizes an official employee resource", async () => {
		const employee = {
			id: 7,
			email: "alex@example.com",
		};
		const employeeResource = {
			type: "Employee",
			attributes: {
				id: { value: employee.id },
				email: { value: employee.email },
				first_name: { value: "Alex" },
				last_name: { value: "Example" },
				personnel_number: { value: "P-7" },
			},
		};
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(authSuccess())
				.mockResolvedValueOnce(
					jsonResponse({ success: true, data: [employeeResource] }),
				),
		);

		await expect(
			new PersonioApiClient(credentials).getEmployeeByEmail(employee.email),
		).resolves.toEqual(employee);
	});

	it("normalizes a null personnel number as absent", async () => {
		const employeeResource = {
			type: "Employee",
			attributes: {
				id: { value: 8 },
				email: { value: "sam@example.com" },
				first_name: { value: "Sam" },
				last_name: { value: "Example" },
				personnel_number: { value: null },
			},
		};
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(authSuccess())
				.mockResolvedValueOnce(
					jsonResponse({ success: true, data: [employeeResource] }),
				),
		);

		await expect(
			new PersonioApiClient(credentials).getEmployeeByEmail("sam@example.com"),
		).resolves.toEqual({
			id: 8,
			email: "sam@example.com",
		});
	});

	it("redacts a missing email identifier from result errors and logs", async () => {
		const privateEmail = "unique.personio.pii@example.invalid";
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(authSuccess())
				.mockResolvedValueOnce(jsonResponse({ success: true, data: [] })),
		);

		const result = await new PersonioApiClient(credentials).createAttendance(
			{ ...attendance, employee: privateEmail },
			"email",
		);

		expect(result).toEqual({
			success: false,
			error: {
				message: "Personio employee not found",
				code: undefined,
				isRetryable: false,
			},
		});
		const observableDiagnostics = JSON.stringify({
			result,
			info: logger.info.mock.calls,
			warn: logger.warn.mock.calls,
			error: logger.error.mock.calls,
		});
		expect(observableDiagnostics).not.toContain(privateEmail);
	});

	it("redacts a missing personnel number from result errors and logs", async () => {
		const privatePersonnelNumber = "UNIQUE-PERSONNEL-PII-84721";
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(authSuccess())
				.mockResolvedValueOnce(jsonResponse({ success: true, data: [] })),
		);

		const result = await new PersonioApiClient(credentials).createAbsence(
			{ ...absence, employee_id: privatePersonnelNumber },
			"employeeNumber",
		);

		expect(result).toEqual({
			success: false,
			error: {
				message: "Personio employee not found",
				code: undefined,
				isRetryable: false,
			},
		});
		const observableDiagnostics = JSON.stringify({
			result,
			info: logger.info.mock.calls,
			warn: logger.warn.mock.calls,
			error: logger.error.mock.calls,
		});
		expect(observableDiagnostics).not.toContain(privatePersonnelNumber);
	});

	it("resolves an attendance email to a numeric employee ID before POST", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(authSuccess())
			.mockResolvedValueOnce(
				jsonResponse({
					success: true,
					data: [personioEmployeeResource(71, "alex@example.com", "P-71")],
				}),
			)
			.mockResolvedValueOnce(attendanceSuccess(901));
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			new PersonioApiClient(credentials).createAttendance(
				{
					...attendance,
					employee: "alex@example.com",
				},
				"email",
			),
		).resolves.toEqual({ success: true, externalId: 901 });

		const [lookupUrl] = fetchMock.mock.calls[1] as [string, RequestInit];
		expectEmailLookupUrl(lookupUrl, "alex@example.com");
		const [, postOptions] = fetchMock.mock.calls[2] as [string, RequestInit];
		expect(JSON.parse(postOptions.body as string)).toEqual({
			attendances: [{ ...attendance, employee: 71 }],
		});
	});

	it.each([
		"123abc",
		"123",
		"OPS@BERLIN",
	])("resolves the exact personnel number %s without numeric coercion", async (personnelNumber) => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(authSuccess())
			.mockResolvedValueOnce(
				jsonResponse({
					success: true,
					data: [
						personioEmployeeResource(72, "person@example.com", personnelNumber),
					],
				}),
			)
			.mockResolvedValueOnce(attendanceSuccess(902));
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			new PersonioApiClient(credentials).createAttendance(
				{
					...attendance,
					employee: personnelNumber,
				},
				"employeeNumber",
			),
		).resolves.toEqual({ success: true, externalId: 902 });

		const [lookupUrl] = fetchMock.mock.calls[1] as [string, RequestInit];
		expect(new URL(lookupUrl).searchParams.has("email")).toBe(false);
		expectEmployeePageUrl(lookupUrl, 0);
		const [, postOptions] = fetchMock.mock.calls[2] as [string, RequestInit];
		expect(JSON.parse(postOptions.body as string)).toEqual({
			attendances: [{ ...attendance, employee: 72 }],
		});
	});

	it("finds a personnel number beyond the first employee page", async () => {
		const firstPage = Array.from({ length: 100 }, (_, index) =>
			personioEmployeeResource(
				index + 1,
				`employee-${index}@example.com`,
				`P-${index}`,
			),
		);
		const target = personioEmployeeResource(
			501,
			"target@example.com",
			"TARGET-501",
		);
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(authSuccess())
			.mockResolvedValueOnce(jsonResponse({ success: true, data: firstPage }))
			.mockResolvedValueOnce(jsonResponse({ success: true, data: [target] }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			new PersonioApiClient(credentials).getEmployeeByPersonnelNumber(
				"TARGET-501",
			),
		).resolves.toMatchObject({ id: 501, personnel_number: "TARGET-501" });

		const [firstUrl] = fetchMock.mock.calls[1] as [string, RequestInit];
		const [secondUrl] = fetchMock.mock.calls[2] as [string, RequestInit];
		expectEmployeePageUrl(firstUrl, 0);
		expectEmployeePageUrl(secondUrl, 100);
	});

	it("shares strategy-specific lookups across concurrent and repeated records", async () => {
		const fetchMock = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			if (url.endsWith("/auth")) return authSuccess();
			if (url.includes("/company/employees")) {
				return jsonResponse({
					success: true,
					data: [
						personioEmployeeResource(81, "shared@example.com", "SHARED-81"),
					],
				});
			}
			if (url.endsWith("/company/attendances")) return attendanceSuccess(904);
			if (url.endsWith("/company/time-offs")) return timeOffSuccess(905);
			throw new Error(`Unexpected URL: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);
		const client = new PersonioApiClient(credentials);

		const [attendanceResult, duplicateAttendanceResult, absenceResult] =
			await Promise.all([
				client.createAttendance(
					{ ...attendance, employee: " Shared@Example.com " },
					"email",
				),
				client.createAttendance(
					{ ...attendance, employee: "shared@example.com" },
					"email",
				),
				client.createAbsence(
					{ ...absence, employee_id: "SHARED-81" },
					"employeeNumber",
				),
			]);
		const repeatedEmailResult = await client.createAttendance(
			{ ...attendance, employee: "shared@example.com" },
			"email",
		);
		const repeatedPersonnelResult = await client.createAttendance(
			{ ...attendance, employee: "SHARED-81" },
			"employeeNumber",
		);

		expect(attendanceResult).toEqual({ success: true, externalId: 904 });
		expect(duplicateAttendanceResult).toEqual({
			success: true,
			externalId: 904,
		});
		expect(absenceResult).toEqual({ success: true, externalId: 905 });
		expect(repeatedEmailResult).toEqual({ success: true, externalId: 904 });
		expect(repeatedPersonnelResult).toEqual({ success: true, externalId: 904 });
		const employeeCalls = fetchMock.mock.calls.filter(([input]) =>
			String(input).includes("/company/employees"),
		);
		expect(employeeCalls).toHaveLength(2);
		const employeeUrls = employeeCalls.map(([input]) => String(input));
		expectEmailLookupUrl(
			employeeUrls.find((url) =>
				new URL(url).searchParams.has("email"),
			) as string,
			"shared@example.com",
		);
		expectEmployeePageUrl(
			employeeUrls.find(
				(url) => !new URL(url).searchParams.has("email"),
			) as string,
			0,
		);
	});

	it.each([
		{
			strategy: "email" as const,
			identifier: "retry429@example.com",
			resource: personioEmployeeResource(83, "retry429@example.com", null),
		},
		{
			strategy: "employeeNumber" as const,
			identifier: "RETRY-429",
			resource: personioEmployeeResource(84, "unused@example.com", "RETRY-429"),
		},
	])("waits 1000ms and retries one $strategy lookup after 429", async (testCase) => {
		vi.useFakeTimers();
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(authSuccess())
			.mockResolvedValueOnce(
				jsonResponse(
					{
						success: false,
						error: { code: 2007, message: "Directory rate limited" },
					},
					429,
				),
			)
			.mockResolvedValueOnce(
				jsonResponse({ success: true, data: [testCase.resource] }),
			)
			.mockResolvedValueOnce(attendanceSuccess(907));
		vi.stubGlobal("fetch", fetchMock);

		const resultPromise = new PersonioApiClient(credentials).createAttendance(
			{ ...attendance, employee: testCase.identifier },
			testCase.strategy,
		);
		await vi.advanceTimersByTimeAsync(999);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1);

		await expect(resultPromise).resolves.toEqual({
			success: true,
			externalId: 907,
		});
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	it.each([
		{ strategy: "email" as const, identifier: "double429@example.com" },
		{ strategy: "employeeNumber" as const, identifier: "DOUBLE-429" },
	])("propagates a second 429 and caches the failed $strategy lookup", async ({
		strategy,
		identifier,
	}) => {
		vi.useFakeTimers();
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(authSuccess())
			.mockResolvedValueOnce(
				jsonResponse(
					{
						success: false,
						error: { code: 2007, message: "Directory rate limited" },
					},
					429,
				),
			)
			.mockResolvedValueOnce(
				jsonResponse(
					{
						success: false,
						error: { code: 2007, message: "Still rate limited" },
					},
					429,
				),
			);
		vi.stubGlobal("fetch", fetchMock);
		const client = new PersonioApiClient(credentials);

		const firstResultPromise = client.createAttendance(
			{ ...attendance, employee: identifier },
			strategy,
		);
		await vi.advanceTimersByTimeAsync(1000);
		await expect(firstResultPromise).resolves.toEqual({
			success: false,
			error: { message: "Still rate limited", code: 429, isRetryable: true },
		});
		await expect(
			client.createAttendance(
				{ ...attendance, employee: identifier },
				strategy,
			),
		).resolves.toEqual({
			success: false,
			error: { message: "Still rate limited", code: 429, isRetryable: true },
		});
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("does not retry an unrelated employee lookup 5xx", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(authSuccess())
			.mockResolvedValueOnce(
				jsonResponse(
					{
						success: false,
						error: { code: 2008, message: "Directory unavailable" },
					},
					503,
				),
			);
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			new PersonioApiClient(credentials).createAttendance(
				{ ...attendance, employee: "no-retry@example.com" },
				"email",
			),
		).resolves.toEqual({
			success: false,
			error: { message: "Directory unavailable", code: 503, isRetryable: true },
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("propagates a directory network failure without POSTing", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(authSuccess())
			.mockRejectedValueOnce(new Error("directory offline"));
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			new PersonioApiClient(credentials).createAbsence(
				{ ...absence, employee_id: "OFFLINE" },
				"employeeNumber",
			),
		).resolves.toEqual({
			success: false,
			error: {
				message: "API request failed: directory offline",
				code: undefined,
				isRetryable: true,
			},
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("clears a rejected directory load so a later action can retry", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(authSuccess())
			.mockRejectedValueOnce(new Error("temporary directory failure"))
			.mockResolvedValueOnce(
				jsonResponse({
					success: true,
					data: [personioEmployeeResource(82, "retry@example.com", "RETRY-82")],
				}),
			)
			.mockResolvedValueOnce(attendanceSuccess(906));
		vi.stubGlobal("fetch", fetchMock);
		const client = new PersonioApiClient(credentials);

		await client.createAttendance(
			{ ...attendance, employee: "RETRY-82" },
			"employeeNumber",
		);
		await expect(
			client.createAttendance(
				{ ...attendance, employee: "RETRY-82" },
				"employeeNumber",
			),
		).resolves.toEqual({ success: true, externalId: 906 });

		const employeeCalls = fetchMock.mock.calls.filter(([input]) =>
			String(input).includes("/company/employees"),
		);
		expect(employeeCalls).toHaveLength(2);
	});

	it("stops after a short unmatched page and does not POST", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(authSuccess())
			.mockResolvedValueOnce(
				jsonResponse({
					success: true,
					data: [personioEmployeeResource(73, "other@example.com", "OTHER")],
				}),
			);
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			new PersonioApiClient(credentials).createAttendance({
				...attendance,
				employee: "MISSING",
			}),
		).resolves.toEqual({
			success: false,
			error: {
				message: "Personio employee not found",
				code: undefined,
				isRetryable: false,
			},
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expectEmployeePageUrl((fetchMock.mock.calls[1] as [string])[0], 0);
	});

	it("resolves a time-off personnel number and preserves all date strings", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(authSuccess())
			.mockResolvedValueOnce(
				jsonResponse({
					success: true,
					data: [
						personioEmployeeResource(74, "absence@example.com", "ABS@BERLIN"),
					],
				}),
			)
			.mockResolvedValueOnce(timeOffSuccess(903));
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			new PersonioApiClient(credentials).createAbsence(
				{
					...absence,
					employee_id: "ABS@BERLIN",
				},
				"employeeNumber",
			),
		).resolves.toEqual({ success: true, externalId: 903 });

		const [lookupUrl] = fetchMock.mock.calls[1] as [string, RequestInit];
		expect(new URL(lookupUrl).searchParams.has("email")).toBe(false);
		const [, postOptions] = fetchMock.mock.calls[2] as [string, RequestInit];
		expect(
			Object.fromEntries(new URLSearchParams(postOptions.body as string)),
		).toMatchObject({
			employee_id: "74",
			start_date: absence.start_date,
			end_date: absence.end_date,
		});
	});

	it("rejects malformed time-off type arrays", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(authSuccess())
				.mockResolvedValueOnce(
					jsonResponse({
						success: true,
						data: [
							{
								type: "TimeOffType",
								attributes: { id: "7", name: "Vacation" },
							},
						],
					}),
				),
		);

		await expect(
			new PersonioApiClient(credentials).getTimeOffTypes(),
		).resolves.toEqual([]);
		expect(logger.warn).toHaveBeenCalledWith(
			{
				error: expect.objectContaining({
					message: "Invalid Personio API response",
					statusCode: 200,
					isRetryable: false,
				}),
			},
			"Failed to get time-off types",
		);
	});

	it("normalizes official time-off type resources", async () => {
		const timeOffTypes = [
			{ id: 7, name: "Vacation" },
			{ id: 8, name: "Sick leave" },
		];
		const timeOffTypeResources = timeOffTypes.map((timeOffType) => ({
			type: "TimeOffType",
			attributes: { ...timeOffType, category: "paid" },
		}));
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(authSuccess())
				.mockResolvedValueOnce(
					jsonResponse({ success: true, data: timeOffTypeResources }),
				),
		);

		await expect(
			new PersonioApiClient(credentials).getTimeOffTypes(),
		).resolves.toEqual(timeOffTypes);
	});

	it("returns a typed non-retryable error for a malformed successful response", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(authSuccess())
				.mockResolvedValueOnce(jsonResponse({ unexpected: true })),
		);
		const client = new PersonioApiClient(credentials);

		const error = await capturePersonioError(() =>
			request(client, "/company/attendances"),
		);

		expect(error).toMatchObject({
			message: "Invalid Personio API response",
			statusCode: 200,
			isRetryable: false,
		});
	});

	it("keeps network failures retryable through a public method", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(authSuccess())
				.mockRejectedValueOnce(new Error("connection reset")),
		);

		await expect(
			new PersonioApiClient(credentials).createAttendance(attendance),
		).resolves.toEqual({
			success: false,
			error: {
				message: "API request failed: connection reset",
				code: undefined,
				isRetryable: true,
			},
		});
	});
});

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function personioEmployeeResource(
	id: number,
	email: string,
	personnelNumber: string | null,
) {
	return {
		type: "Employee",
		attributes: {
			id: { value: id },
			email: { value: email },
			personnel_number: { value: personnelNumber },
		},
	};
}

function expectEmployeePageUrl(url: string, offset: number): void {
	const parsedUrl = new URL(url);
	expect(parsedUrl.pathname).toBe("/v1/company/employees");
	expect(parsedUrl.searchParams.get("limit")).toBe("100");
	expect(parsedUrl.searchParams.get("offset")).toBe(String(offset));
	expect(parsedUrl.searchParams.getAll("attributes[]")).toEqual([
		"id",
		"personnel_number",
	]);
	expect(parsedUrl.searchParams.has("email")).toBe(false);
}

function expectEmailLookupUrl(url: string, email: string): void {
	const parsedUrl = new URL(url);
	expect(parsedUrl.pathname).toBe("/v1/company/employees");
	expect(parsedUrl.searchParams.get("email")).toBe(email);
	expect(parsedUrl.searchParams.get("limit")).toBe("1");
	expect(parsedUrl.searchParams.get("offset")).toBe("0");
	expect(parsedUrl.searchParams.getAll("attributes[]")).toEqual([
		"id",
		"email",
	]);
}

function authenticate(client: PersonioApiClient): Promise<void> {
	return (
		client as unknown as {
			authenticate(): Promise<void>;
		}
	).authenticate();
}

function getAuthToken(
	client: PersonioApiClient,
): { token: string; expiresAt: number } | null {
	return (
		client as unknown as {
			authToken: { token: string; expiresAt: number } | null;
		}
	).authToken;
}

function request<T>(
	client: PersonioApiClient,
	endpoint: string,
): Promise<{ data: T; durationMs: number }> {
	return (
		client as unknown as {
			request<TResult>(
				requestedEndpoint: string,
				options?: RequestInit,
			): Promise<{ data: TResult; durationMs: number }>;
		}
	).request<T>(endpoint);
}

async function capturePersonioError(
	operation: () => Promise<unknown>,
): Promise<PersonioApiError> {
	try {
		await operation();
	} catch (error) {
		expect(error).toBeInstanceOf(PersonioApiError);
		return error as PersonioApiError;
	}

	throw new Error("Expected PersonioApiError");
}
