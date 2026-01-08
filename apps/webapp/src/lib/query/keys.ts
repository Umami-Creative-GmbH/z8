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
	},
} as const;
