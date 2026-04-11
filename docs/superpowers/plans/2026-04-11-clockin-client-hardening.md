# Clockin Client Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the existing `Clockin` provider client so import callers can rely on stable pagination and failure behavior without widening the work beyond the current Task 3 boundary.

**Architecture:** Keep the work inside `apps/webapp/src/lib/clockin/client.ts` and its contract tests. First lock the missing behaviors with failing Vitest coverage, then replace the one-shot request helper with paginated response parsing that preserves the original request method and body across pages. Finish by verifying existing action and orchestrator callers still pass without changing their public contract.

**Tech Stack:** TypeScript, Vitest, native `fetch`, Next.js webapp package.

---

## Execution Context

- Implement this in a dedicated worktree before touching code, for example `/home/kai/projects/z8/.worktrees/clockin-client-hardening`.
- Stay inside the approved `Task 3` hardening slice. Do not add duplicate detection, wizard UI work, or new import orchestration behavior here.
- Keep `apps/webapp/src/lib/clockin/types.ts` unchanged unless TypeScript compilation proves the existing `ClockinPaginatedResponse<T>` type is insufficient.
- Use `pnpm`, not `npm`.

## File Map

- Modify: `apps/webapp/src/lib/clockin/client.test.ts`
  - Add failing coverage for paginated employee fetches, paginated absence searches, and invalid JSON responses.
- Modify: `apps/webapp/src/lib/clockin/client.ts`
  - Replace the single-page request helper with a paginated helper that preserves request shape across pages and emits stable parse errors.
- Verify: `apps/webapp/src/app/[locale]/(app)/settings/import/clockin-actions.test.ts`
  - Confirms the existing server actions still work against the unchanged client contract.
- Verify: `apps/webapp/src/lib/clockin/import-orchestrator.test.ts`
  - Confirms the importer still relies on the same `getEmployees`, `searchWorkdays`, and `searchAbsences` API.

## Implementation Notes

- The current client already sends the correct bearer token and request bodies, so keep the public method names unchanged.
- The current gap is behavioral, not architectural: `getEmployees()` and the search methods only return the first page, and successful non-JSON responses currently bubble raw parse errors.
- When following `links.next`, keep using the original `RequestInit` so paginated POST searches resend the same request body.
- Do not add schedule import behavior in this slice. The existing `schedules: 0` preview behavior lives outside the client and is out of scope here.

### Task 1: Lock the missing client contract behavior with failing tests

**Files:**
- Modify: `apps/webapp/src/lib/clockin/client.test.ts`

- [ ] **Step 1: Add a failing employee pagination test**

Insert this test below the existing `sends bearer-authenticated employee requests` case:

```ts
it("collects all employee pages when Clockin returns a next link", async () => {
	const fetchSpy = vi
		.spyOn(globalThis, "fetch")
		.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					data: [
						{
							id: 1,
							first_name: "Ada",
							last_name: "Lovelace",
							email: "ada@example.com",
							personnel_number: "E-001",
							department_name: null,
							entry_date: null,
							contract_ending: null,
							trial_period_end_date: null,
							created_at: "2026-03-01T00:00:00Z",
							updated_at: "2026-03-01T00:00:00Z",
						},
					],
					links: {
						first: "https://customerapi.clockin.de/v3/employees?page=1",
						last: "https://customerapi.clockin.de/v3/employees?page=2",
						prev: null,
						next: "https://customerapi.clockin.de/v3/employees?page=2",
					},
					meta: {
						current_page: 1,
						from: 1,
						last_page: 2,
						path: "https://customerapi.clockin.de/v3/employees",
						per_page: 1,
						to: 1,
						total: 2,
					},
				}),
				{ status: 200 },
			),
		)
		.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					data: [
						{
							id: 2,
							first_name: "Grace",
							last_name: "Hopper",
							email: "grace@example.com",
							personnel_number: "E-002",
							department_name: null,
							entry_date: null,
							contract_ending: null,
							trial_period_end_date: null,
							created_at: "2026-03-02T00:00:00Z",
							updated_at: "2026-03-02T00:00:00Z",
						},
					],
					links: {
						first: "https://customerapi.clockin.de/v3/employees?page=1",
						last: "https://customerapi.clockin.de/v3/employees?page=2",
						prev: "https://customerapi.clockin.de/v3/employees?page=1",
						next: null,
					},
					meta: {
						current_page: 2,
						from: 2,
						last_page: 2,
						path: "https://customerapi.clockin.de/v3/employees",
						per_page: 1,
						to: 2,
						total: 2,
					},
				}),
				{ status: 200 },
			),
		);

	const client = new ClockinClient("token-value");
	const employees = await client.getEmployees();

	expect(fetchSpy).toHaveBeenCalledTimes(2);
	expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://customerapi.clockin.de/v3/employees");
	expect(fetchSpy.mock.calls[1]?.[0]).toBe(
		"https://customerapi.clockin.de/v3/employees?page=2",
	);
	expect(employees.map((employee) => employee.email)).toEqual([
		"ada@example.com",
		"grace@example.com",
	]);
});
```

- [ ] **Step 2: Add a failing paginated POST search test**

Insert this test below the existing `posts required workday search filters` case:

```ts
it("replays paginated absence searches with the original POST body", async () => {
	const firstPage = {
		scopes: [
			{ key: "starts_at", operator: ">=", value: "2026-03-01" },
			{ key: "ends_at", operator: "<=", value: "2026-03-31" },
			{ key: "employee_id", operator: "in", value: [1] },
		],
	};

	const fetchSpy = vi
		.spyOn(globalThis, "fetch")
		.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					data: [
						{
							id: 10,
							employee_id: 1,
							absencecategory_name: "Vacation",
							approval: "approved",
							duration: 480,
							note: null,
							starts_at: "2026-03-04",
							ends_at: "2026-03-04",
							created_at: "2026-03-01T00:00:00Z",
							updated_at: "2026-03-01T00:00:00Z",
						},
					],
					links: {
						first: "https://customerapi.clockin.de/v3/absences/search?page=1",
						last: "https://customerapi.clockin.de/v3/absences/search?page=2",
						prev: null,
						next: "https://customerapi.clockin.de/v3/absences/search?page=2",
					},
					meta: {
						current_page: 1,
						from: 1,
						last_page: 2,
						path: "https://customerapi.clockin.de/v3/absences/search",
						per_page: 1,
						to: 1,
						total: 2,
					},
				}),
				{ status: 200 },
			),
		)
		.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					data: [
						{
							id: 11,
							employee_id: 1,
							absencecategory_name: "Vacation",
							approval: "approved",
							duration: 480,
							note: null,
							starts_at: "2026-03-05",
							ends_at: "2026-03-05",
							created_at: "2026-03-01T00:00:00Z",
							updated_at: "2026-03-01T00:00:00Z",
						},
					],
					links: {
						first: "https://customerapi.clockin.de/v3/absences/search?page=1",
						last: "https://customerapi.clockin.de/v3/absences/search?page=2",
						prev: "https://customerapi.clockin.de/v3/absences/search?page=1",
						next: null,
					},
					meta: {
						current_page: 2,
						from: 2,
						last_page: 2,
						path: "https://customerapi.clockin.de/v3/absences/search",
						per_page: 1,
						to: 2,
						total: 2,
					},
				}),
				{ status: 200 },
			),
		);

	const client = new ClockinClient("token-value");
	const absences = await client.searchAbsences({
		employeeIds: [1],
		startDate: "2026-03-01",
		endDate: "2026-03-31",
	});

	expect(fetchSpy).toHaveBeenCalledTimes(2);
	expect(fetchSpy).toHaveBeenNthCalledWith(
		1,
		"https://customerapi.clockin.de/v3/absences/search",
		expect.objectContaining({ method: "POST", body: JSON.stringify(firstPage) }),
	);
	expect(fetchSpy).toHaveBeenNthCalledWith(
		2,
		"https://customerapi.clockin.de/v3/absences/search?page=2",
		expect.objectContaining({ method: "POST", body: JSON.stringify(firstPage) }),
	);
	expect(absences.map((absence) => absence.id)).toEqual([10, 11]);
});
```

- [ ] **Step 3: Add a failing invalid JSON test**

Insert this test below the existing `returns structured connection failures` case:

```ts
it("returns a stable Clockin-specific error when a success response is not valid JSON", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		new Response("<html>gateway error</html>", {
			status: 200,
			headers: { "Content-Type": "text/html" },
		}),
	);

	const client = new ClockinClient("token-value");

	await expect(client.testConnection()).resolves.toEqual({
		success: false,
		error: "Clockin API error 200: invalid JSON response",
	});
});
```

- [ ] **Step 4: Run the client test file to confirm the new cases fail**

Run: `pnpm test -- --run apps/webapp/src/lib/clockin/client.test.ts`

Expected: FAIL because `getEmployees()` and `searchAbsences()` only return the first page today, and invalid JSON currently bubbles a raw parse error instead of a stable `Clockin API error 200: invalid JSON response` message.

### Task 2: Harden the Clockin client request helper

**Files:**
- Modify: `apps/webapp/src/lib/clockin/client.ts`

- [ ] **Step 1: Replace the one-shot request helper with paginated response parsing**

Update `apps/webapp/src/lib/clockin/client.ts` to this shape:

```ts
import type {
	ClockinAbsence,
	ClockinAbsenceSearchRequest,
	ClockinEmployee,
	ClockinPaginatedResponse,
	ClockinWorkday,
	ClockinWorkdaySearchRequest,
} from "./types";

const BASE_URL = "https://customerapi.clockin.de";

type ClockinSearchScope = {
	key: string;
	operator: string;
	value: string | number[];
};

export class ClockinClient {
	constructor(private readonly token: string) {}

	private async parseResponse<T>(response: Response): Promise<T> {
		const text = await response.text().catch(() => "");

		if (!response.ok) {
			throw new Error(`Clockin API error ${response.status}: ${text || response.statusText}`);
		}

		try {
			return JSON.parse(text) as T;
		} catch {
			throw new Error(`Clockin API error ${response.status}: invalid JSON response`);
		}
	}

	private async requestPage<T>(url: string, init?: RequestInit): Promise<ClockinPaginatedResponse<T>> {
		const response = await fetch(url, {
			...init,
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${this.token}`,
				"Content-Type": "application/json",
				...init?.headers,
			},
		});

		return this.parseResponse<ClockinPaginatedResponse<T>>(response);
	}

	private async fetchAllPages<T>(path: string, init?: RequestInit): Promise<T[]> {
		let nextUrl: string | null = `${BASE_URL}${path}`;
		const rows: T[] = [];

		while (nextUrl) {
			const page = await this.requestPage<T>(nextUrl, init);
			rows.push(...page.data);
			nextUrl = page.links.next;
		}

		return rows;
	}

	async testConnection(): Promise<{ success: true } | { success: false; error: string }> {
		try {
			await this.getEmployees();
			return { success: true };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Failed to connect to Clockin",
			};
		}
	}

	async getEmployees(): Promise<ClockinEmployee[]> {
		return this.fetchAllPages<ClockinEmployee>("/v3/employees");
	}

	async searchWorkdays(input: ClockinWorkdaySearchRequest): Promise<ClockinWorkday[]> {
		return this.fetchAllPages<ClockinWorkday>("/v3/workdays/search", {
			method: "POST",
			body: JSON.stringify({
				employee_ids: input.employeeIds,
				start_date: input.startDate,
				end_date: input.endDate,
			}),
		});
	}

	async searchAbsences(input: ClockinAbsenceSearchRequest): Promise<ClockinAbsence[]> {
		const scopes: ClockinSearchScope[] = [
			{ key: "starts_at", operator: ">=", value: input.startDate },
			{ key: "ends_at", operator: "<=", value: input.endDate },
		];

		if (input.employeeIds?.length) {
			scopes.push({
				key: "employee_id",
				operator: "in",
				value: input.employeeIds,
			});
		}

		return this.fetchAllPages<ClockinAbsence>("/v3/absences/search", {
			method: "POST",
			body: JSON.stringify({ scopes }),
		});
	}
}
```

- [ ] **Step 2: Run the client tests again**

Run: `pnpm test -- --run apps/webapp/src/lib/clockin/client.test.ts`

Expected: PASS.

- [ ] **Step 3: Commit the client hardening slice**

```bash
git add apps/webapp/src/lib/clockin/client.ts apps/webapp/src/lib/clockin/client.test.ts
git commit -m "fix(clockin): harden paginated client responses"
```

### Task 3: Verify existing Clockin callers still pass unchanged

**Files:**
- Verify: `apps/webapp/src/app/[locale]/(app)/settings/import/clockin-actions.test.ts`
- Verify: `apps/webapp/src/lib/clockin/import-orchestrator.test.ts`

- [ ] **Step 1: Run the focused Clockin compatibility suite**

Run:

```bash
pnpm test -- --run apps/webapp/src/lib/clockin/client.test.ts apps/webapp/src/app/[locale]/(app)/settings/import/clockin-actions.test.ts apps/webapp/src/lib/clockin/import-orchestrator.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the production build check**

Run: `pnpm build`

Expected: PASS.

- [ ] **Step 3: Manual review checkpoint**

Confirm these code-level expectations before calling the work complete:

- `ClockinClient` still exposes `testConnection()`, `getEmployees()`, `searchWorkdays()`, and `searchAbsences()` with the same call signatures.
- paginated GET and POST requests keep the original bearer auth and body payload on every page.
- invalid successful responses now fail with a stable `Clockin API error <status>: invalid JSON response` message instead of a raw parser exception.
