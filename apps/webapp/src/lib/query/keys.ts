/**
 * Query key factory for TanStack Query
 *
 * Usage:
 * - queryKeys.members.all - all members queries
 * - queryKeys.members.list(orgId) - members for a specific org
 * - queryKeys.teams.all - all teams queries
 * - queryKeys.teams.list(orgId) - teams for a specific org
 * - queryKeys.teams.detail(teamId) - specific team
 */
export const queryKeys = {
	// Organizations
	organizations: {
		all: ["organizations"] as const,
		detail: (orgId: string) => ["organizations", orgId] as const,
	},

	// Organization members
	members: {
		all: ["members"] as const,
		list: <T extends object>(orgId: string, params?: T) => ["members", orgId, params] as const,
	},

	// Invitations
	invitations: {
		all: ["invitations"] as const,
		list: (orgId: string) => ["invitations", orgId] as const,
	},

	// Invite codes (shareable join codes)
	inviteCodes: {
		all: ["invite-codes"] as const,
		list: (orgId: string) => ["invite-codes", orgId] as const,
		detail: (codeId: string) => ["invite-codes", "detail", codeId] as const,
		stats: (codeId: string) => ["invite-codes", "stats", codeId] as const,
	},

	// Pending members (awaiting approval)
	pendingMembers: {
		all: ["pending-members"] as const,
		list: (orgId: string) => ["pending-members", orgId] as const,
		count: (orgId: string) => ["pending-members", "count", orgId] as const,
	},

	// Teams
	teams: {
		all: ["teams"] as const,
		list: (orgId: string) => ["teams", orgId] as const,
		detail: (teamId: string) => ["teams", "detail", teamId] as const,
		members: (teamId: string) => ["teams", teamId, "members"] as const,
	},

	// Approvals
	approvals: {
		all: ["approvals"] as const,
		absences: <T extends object>(params?: T) => ["approvals", "absences", params] as const,
		timeCorrections: <T extends object>(params?: T) =>
			["approvals", "time-corrections", params] as const,
	},

	// Employees
	employees: {
		all: ["employees"] as const,
		list: <T extends object>(orgId: string, params?: T) => ["employees", orgId, params] as const,
		detail: (employeeId: string) => ["employees", "detail", employeeId] as const,
		rateHistory: (employeeId: string) =>
			["employees", "detail", employeeId, "rate-history"] as const,
	},

	// Employee Select (for unified employee selection component)
	employeeSelect: {
		all: ["employee-select"] as const,
		list: <T extends object>(orgId: string, params?: T) =>
			["employee-select", orgId, params] as const,
		byIds: (employeeIds: string[]) => ["employee-select", "by-ids", employeeIds] as const,
	},

	// Managed employees (team page - direct reports)
	managedEmployees: {
		all: ["managed-employees"] as const,
		list: (managerId: string) => ["managed-employees", managerId] as const,
	},

	// User profile
	profile: {
		current: () => ["profile", "current"] as const,
	},

	// Time clock
	timeClock: {
		status: () => ["time-clock", "status"] as const,
		breakStatus: () => ["time-clock", "break-status"] as const,
	},

	// Notifications
	notifications: {
		all: ["notifications"] as const,
		list: (options?: { unreadOnly?: boolean }) => ["notifications", "list", options] as const,
		unreadCount: () => ["notifications", "unread-count"] as const,
		preferences: () => ["notifications", "preferences"] as const,
	},

	// Holiday presets
	holidayPresets: {
		all: ["holiday-presets"] as const,
		list: (orgId: string) => ["holiday-presets", orgId] as const,
		detail: (presetId: string) => ["holiday-presets", "detail", presetId] as const,
	},

	// Holiday preset assignments
	holidayPresetAssignments: {
		all: ["holiday-preset-assignments"] as const,
		list: (orgId: string) => ["holiday-preset-assignments", orgId] as const,
	},

	// Holidays (custom org-wide)
	holidays: {
		all: ["holidays"] as const,
		list: <T extends object>(orgId: string, params?: T) => ["holidays", orgId, params] as const,
	},

	// Holiday categories
	holidayCategories: {
		all: ["holiday-categories"] as const,
		list: <T extends object>(orgId: string, params?: T) =>
			["holiday-categories", orgId, params] as const,
	},

	// Holiday assignments (individual custom holidays to org/team/employee)
	holidayAssignments: {
		all: ["holiday-assignments"] as const,
		list: (orgId: string) => ["holiday-assignments", orgId] as const,
	},

	// Vacation policies
	vacationPolicies: {
		all: ["vacation-policies"] as const,
		list: <T extends object>(orgId: string, params?: T) =>
			["vacation-policies", orgId, params] as const,
		detail: (policyId: string) => ["vacation-policies", "detail", policyId] as const,
		companyDefault: (orgId: string) => ["vacation-policies", "company-default", orgId] as const,
	},

	// Vacation policy assignments (policies to org/team/employee)
	vacationPolicyAssignments: {
		all: ["vacation-policy-assignments"] as const,
		list: (orgId: string) => ["vacation-policy-assignments", orgId] as const,
	},

	// Shift templates (Morning Shift, Night Shift, etc.)
	shiftTemplates: {
		all: ["shift-templates"] as const,
		list: (orgId: string) => ["shift-templates", orgId] as const,
	},

	// Shifts (actual shift instances)
	shifts: {
		all: ["shifts"] as const,
		list: (orgId: string, dateRange?: { start: Date; end: Date }) =>
			["shifts", orgId, dateRange] as const,
		detail: (shiftId: string) => ["shifts", "detail", shiftId] as const,
		incomplete: (orgId: string, dateRange: { start: Date; end: Date }) =>
			["shifts", "incomplete", orgId, dateRange] as const,
		open: (orgId: string, dateRange: { start: Date; end: Date }) =>
			["shifts", "open", orgId, dateRange] as const,
	},

	// Shift requests (swaps, pickups)
	shiftRequests: {
		all: ["shift-requests"] as const,
		pending: (approverId: string) => ["shift-requests", "pending", approverId] as const,
		byShift: (shiftId: string) => ["shift-requests", "shift", shiftId] as const,
	},

	// Projects
	projects: {
		all: ["projects"] as const,
		list: <T extends object>(orgId: string, params?: T) =>
			["projects", "list", orgId, params] as const,
		detail: (projectId: string) => ["projects", "detail", projectId] as const,
		assignable: (orgId: string) => ["projects", "assignable", orgId] as const,
	},

	// Surcharges
	surcharges: {
		all: ["surcharges"] as const,
		models: {
			all: ["surcharges", "models"] as const,
			list: (orgId: string) => ["surcharges", "models", "list", orgId] as const,
			detail: (modelId: string) => ["surcharges", "models", "detail", modelId] as const,
		},
		assignments: {
			all: ["surcharges", "assignments"] as const,
			list: (orgId: string) => ["surcharges", "assignments", "list", orgId] as const,
		},
		calculations: {
			all: ["surcharges", "calculations"] as const,
			list: (orgId: string, dateRange: { start: Date; end: Date }) =>
				["surcharges", "calculations", "list", orgId, dateRange] as const,
			byEmployee: (employeeId: string, dateRange: { start: Date; end: Date }) =>
				["surcharges", "calculations", "employee", employeeId, dateRange] as const,
			byWorkPeriod: (workPeriodId: string) =>
				["surcharges", "calculations", "work-period", workPeriodId] as const,
		},
		effective: (employeeId: string) => ["surcharges", "effective", employeeId] as const,
	},
	// Auth / Security settings
	auth: {
		all: ["auth"] as const,
		sessions: () => ["auth", "sessions"] as const,
		accounts: () => ["auth", "accounts"] as const,
		passkeys: () => ["auth", "passkeys"] as const,
	},

	// Locations
	locations: {
		all: ["locations"] as const,
		list: (orgId: string) => ["locations", "list", orgId] as const,
		detail: (locationId: string) => ["locations", "detail", locationId] as const,
		employees: (locationId: string) => ["locations", locationId, "employees"] as const,
		withSubareas: (orgId: string) => ["locations", "with-subareas", orgId] as const,
		subareas: {
			all: (locationId: string) => ["locations", locationId, "subareas"] as const,
			detail: (subareaId: string) => ["locations", "subareas", "detail", subareaId] as const,
			employees: (subareaId: string) => ["locations", "subareas", subareaId, "employees"] as const,
		},
	},

	// Calendar events
	calendar: {
		all: ["calendar"] as const,
		events: (
			orgId: string,
			params: {
				year: number;
				month?: number;
				fullYear?: boolean;
				filters: {
					showHolidays: boolean;
					showAbsences: boolean;
					showTimeEntries: boolean;
					showWorkPeriods: boolean;
					employeeId?: string;
				};
			},
		) => ["calendar", "events", orgId, params] as const,
		/** Employees visible in the calendar employee selector (current user + managed employees) */
		employees: (managerId: string) => ["calendar", "employees", managerId] as const,
	},

	// Hydration / Water reminders
	hydration: {
		all: ["hydration"] as const,
		stats: () => ["hydration", "stats"] as const,
		settings: () => ["hydration", "settings"] as const,
		todayIntake: () => ["hydration", "today-intake"] as const,
		reminderStatus: () => ["hydration", "reminder-status"] as const,
	},

	// Dashboard
	dashboard: {
		all: ["dashboard"] as const,
		userSettings: () => ["dashboard", "user-settings"] as const,
		widgetOrder: () => ["dashboard", "widget-order"] as const,
	},

	// User settings (global user preferences)
	userSettings: {
		all: ["user-settings"] as const,
		current: () => ["user-settings", "current"] as const,
	},

	// Work category sets
	workCategorySets: {
		all: ["work-category-sets"] as const,
		list: (orgId: string) => ["work-category-sets", "list", orgId] as const,
		detail: (setId: string) => ["work-category-sets", "detail", setId] as const,
	},

	// Work categories (org-level, independent of sets)
	workCategories: {
		all: ["work-categories"] as const,
		// Org-level categories list
		orgList: (orgId: string) => ["work-categories", "org", orgId] as const,
		// Categories available to an employee (resolved through assignment hierarchy)
		available: (employeeId: string) => ["work-categories", "available", employeeId] as const,
	},

	// Work category set assignments (org/team/employee)
	workCategorySetAssignments: {
		all: ["work-category-set-assignments"] as const,
		list: (orgId: string) => ["work-category-set-assignments", "list", orgId] as const,
	},

	// Change policies (time tracking edit restrictions)
	changePolicies: {
		all: ["change-policies"] as const,
		list: (orgId: string) => ["change-policies", "list", orgId] as const,
		detail: (policyId: string) => ["change-policies", "detail", policyId] as const,
		assignments: (orgId: string) => ["change-policies", "assignments", orgId] as const,
		effective: (employeeId: string) => ["change-policies", "effective", employeeId] as const,
	},

	// Reports
	reports: {
		all: ["reports"] as const,
		/** Accessible employees for report generation (based on role/permissions) */
		employees: (employeeId: string) => ["reports", "employees", employeeId] as const,
	},

	// Work policies (unified work schedules + time regulations)
	workPolicies: {
		all: ["work-policies"] as const,
		list: (orgId: string) => ["work-policies", "list", orgId] as const,
		detail: (policyId: string) => ["work-policies", "detail", policyId] as const,
		assignments: (orgId: string) => ["work-policies", "assignments", orgId] as const,
		presets: () => ["work-policies", "presets"] as const,
		violations: {
			all: ["work-policies", "violations"] as const,
			list: (orgId: string, dateRange: { start: Date; end: Date }) =>
				["work-policies", "violations", "list", orgId, dateRange] as const,
			byEmployee: (employeeId: string, dateRange: { start: Date; end: Date }) =>
				["work-policies", "violations", "employee", employeeId, dateRange] as const,
		},
		effective: (employeeId: string) => ["work-policies", "effective", employeeId] as const,
	},
} as const;
