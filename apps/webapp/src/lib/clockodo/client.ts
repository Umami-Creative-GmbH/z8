import { createLogger } from "@/lib/logger";
import type {
	ClockodoAbsence,
	ClockodoEntry,
	ClockodoHolidayQuota,
	ClockodoNonBusinessDay,
	ClockodoService,
	ClockodoSurcharge,
	ClockodoTargetHours,
	ClockodoTeam,
	ClockodoUser,
} from "./types";

const logger = createLogger("ClockodoClient");

const BASE_URL = "https://my.clockodo.com/api";
const APP_HEADER = "Z8 Import;support@z8.works";

/**
 * REST client for the Clockodo API.
 * Handles authentication, pagination, and rate limiting.
 */
export class ClockodoClient {
	private email: string;
	private apiKey: string;

	constructor(email: string, apiKey: string) {
		this.email = email;
		this.apiKey = apiKey;
	}

	private async request<T>(path: string, params?: Record<string, string>): Promise<T> {
		const url = new URL(`${BASE_URL}${path}`);
		if (params) {
			for (const [key, value] of Object.entries(params)) {
				url.searchParams.set(key, value);
			}
		}

		const response = await fetch(url.toString(), {
			headers: {
				"X-ClockodoApiUser": this.email,
				"X-ClockodoApiKey": this.apiKey,
				"X-Clockodo-External-Application": APP_HEADER,
				Accept: "application/json",
			},
		});

		if (response.status === 429) {
			// Rate limited - wait and retry once
			const retryAfter = Number(response.headers.get("Retry-After") || "5");
			logger.warn({ path, retryAfter }, "Rate limited, retrying");
			await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
			return this.request<T>(path, params);
		}

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(`Clockodo API error ${response.status}: ${text}`);
		}

		return response.json() as Promise<T>;
	}

	/**
	 * Fetch all pages of a paginated resource.
	 * Clockodo uses page-based pagination with a default page size.
	 */
	private async fetchAllPages<T>(
		path: string,
		resourceKey: string,
		params?: Record<string, string>,
	): Promise<T[]> {
		const allItems: T[] = [];
		let page = 1;

		while (true) {
			const data = await this.request<Record<string, unknown>>(path, {
				...params,
				page: String(page),
			});

			const items = data[resourceKey] as T[] | undefined;
			if (!items || items.length === 0) break;

			allItems.push(...items);

			// Check if there's a paging object indicating more pages
			const paging = data.paging as
				| { items_per_page?: number; current_page?: number; count_pages?: number }
				| undefined;
			if (!paging || page >= (paging.count_pages ?? page)) break;

			page++;
		}

		return allItems;
	}

	/** Test the connection by fetching the current user */
	async testConnection(): Promise<boolean> {
		try {
			await this.request("/v2/aggregates/users/me");
			return true;
		} catch {
			return false;
		}
	}

	/** Get all users/co-workers */
	async getUsers(): Promise<ClockodoUser[]> {
		const data = await this.request<{ users: ClockodoUser[] }>("/v2/users");
		return data.users ?? [];
	}

	/** Get all teams */
	async getTeams(): Promise<ClockodoTeam[]> {
		const data = await this.request<{ teams: ClockodoTeam[] }>("/v2/teams");
		return data.teams ?? [];
	}

	/** Get all services */
	async getServices(): Promise<ClockodoService[]> {
		const data = await this.request<{ services: ClockodoService[] }>("/v2/services");
		return data.services ?? [];
	}

	/**
	 * Get all time entries.
	 * Entries are paginated and require a date range.
	 * We fetch all entries by using a wide date range.
	 */
	async getEntries(timeSince?: string, timeUntil?: string): Promise<ClockodoEntry[]> {
		const params: Record<string, string> = {
			// Fetch with enhanced list mode for text and names
			enhanced_list: "true",
		};
		if (timeSince) params.time_since = timeSince;
		if (timeUntil) params.time_until = timeUntil;

		// Default: fetch last 10 years of entries
		if (!timeSince) {
			const since = new Date();
			since.setFullYear(since.getFullYear() - 10);
			params.time_since = `${since.toISOString().slice(0, 19)}Z`;
		}
		if (!timeUntil) {
			params.time_until = `${new Date().toISOString().slice(0, 19)}Z`;
		}

		return this.fetchAllPages<ClockodoEntry>("/v2/entries", "entries", params);
	}

	/** Get the count of entries without fetching all data */
	async getEntriesCount(): Promise<number> {
		const since = new Date();
		since.setFullYear(since.getFullYear() - 10);

		const data = await this.request<{ paging?: { count_items?: number }; entries?: unknown[] }>(
			"/v2/entries",
			{
				time_since: `${since.toISOString().slice(0, 19)}Z`,
				time_until: `${new Date().toISOString().slice(0, 19)}Z`,
				page: "1",
			},
		);

		return data.paging?.count_items ?? data.entries?.length ?? 0;
	}

	/** Get all absences */
	async getAbsences(year?: number): Promise<ClockodoAbsence[]> {
		const currentYear = new Date().getFullYear();
		const allAbsences: ClockodoAbsence[] = [];

		// Fetch absences year by year (API requires year parameter)
		const startYear = year ?? currentYear - 10;
		const endYear = year ?? currentYear;

		for (let y = startYear; y <= endYear; y++) {
			try {
				const data = await this.request<{ absences: ClockodoAbsence[] }>("/absences", {
					year: String(y),
				});
				if (data.absences) {
					allAbsences.push(...data.absences);
				}
			} catch (error) {
				// Some years may have no data, continue
				logger.debug({ year: y, error }, "No absences for year");
			}
		}

		return allAbsences;
	}

	/** Get absences count for preview */
	async getAbsencesCount(): Promise<number> {
		try {
			const currentYear = new Date().getFullYear();
			const data = await this.request<{ absences: ClockodoAbsence[] }>("/absences", {
				year: String(currentYear),
			});
			// Return current year count as estimate
			return data.absences?.length ?? 0;
		} catch {
			return 0;
		}
	}

	/** Get all target hours configurations */
	async getTargetHours(): Promise<ClockodoTargetHours[]> {
		const data = await this.request<{ targethours: ClockodoTargetHours[] }>("/targethours");
		return data.targethours ?? [];
	}

	/** Get all holiday quotas */
	async getHolidayQuotas(): Promise<ClockodoHolidayQuota[]> {
		const data = await this.request<{ holidaysquota: ClockodoHolidayQuota[] }>("/holidaysquota");
		return data.holidaysquota ?? [];
	}

	/** Get non-business days for a specific year */
	async getNonBusinessDays(year?: number): Promise<ClockodoNonBusinessDay[]> {
		const y = year ?? new Date().getFullYear();
		const data = await this.request<{ nonbusinessdays: ClockodoNonBusinessDay[] }>(
			"/nonbusinessdays",
			{ year: String(y) },
		);
		return data.nonbusinessdays ?? [];
	}

	/** Get all surcharge models */
	async getSurcharges(): Promise<ClockodoSurcharge[]> {
		const data = await this.request<{ surcharges: ClockodoSurcharge[] }>("/v2/surcharges");
		return data.surcharges ?? [];
	}
}
