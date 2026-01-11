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
		list: (orgId: string) => ["members", orgId] as const,
	},

	// Invitations
	invitations: {
		all: ["invitations"] as const,
		list: (orgId: string) => ["invitations", orgId] as const,
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
		absences: () => ["approvals", "absences"] as const,
		timeCorrections: () => ["approvals", "time-corrections"] as const,
	},

	// Employees
	employees: {
		all: ["employees"] as const,
		list: (orgId: string) => ["employees", orgId] as const,
		detail: (employeeId: string) => ["employees", "detail", employeeId] as const,
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
		list: (orgId: string) => ["holidays", orgId] as const,
	},

	// Holiday categories
	holidayCategories: {
		all: ["holiday-categories"] as const,
		list: (orgId: string) => ["holiday-categories", orgId] as const,
	},

	// Holiday assignments (individual custom holidays to org/team/employee)
	holidayAssignments: {
		all: ["holiday-assignments"] as const,
		list: (orgId: string) => ["holiday-assignments", orgId] as const,
	},

	// Vacation policy assignments (policies to org/team/employee)
	vacationPolicyAssignments: {
		all: ["vacation-policy-assignments"] as const,
		list: (orgId: string) => ["vacation-policy-assignments", orgId] as const,
	},

	// Work schedule templates
	workScheduleTemplates: {
		all: ["work-schedule-templates"] as const,
		list: (orgId: string) => ["work-schedule-templates", orgId] as const,
		detail: (templateId: string) => ["work-schedule-templates", "detail", templateId] as const,
	},

	// Work schedule assignments (templates to org/team/employee)
	workScheduleAssignments: {
		all: ["work-schedule-assignments"] as const,
		list: (orgId: string) => ["work-schedule-assignments", orgId] as const,
		employee: (employeeId: string) =>
			["work-schedule-assignments", "employee", employeeId] as const,
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

	// Time regulations
	timeRegulations: {
		all: ["time-regulations"] as const,
		list: (orgId: string) => ["time-regulations", "list", orgId] as const,
		detail: (regulationId: string) => ["time-regulations", "detail", regulationId] as const,
		assignments: (orgId: string) => ["time-regulations", "assignments", orgId] as const,
		presets: () => ["time-regulations", "presets"] as const,
		violations: {
			all: ["time-regulations", "violations"] as const,
			list: (orgId: string, dateRange: { start: Date; end: Date }) =>
				["time-regulations", "violations", "list", orgId, dateRange] as const,
			byEmployee: (employeeId: string, dateRange: { start: Date; end: Date }) =>
				["time-regulations", "violations", "employee", employeeId, dateRange] as const,
		},
		effective: (employeeId: string) => ["time-regulations", "effective", employeeId] as const,
	},
} as const;
