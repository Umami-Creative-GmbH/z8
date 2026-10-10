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
		organization: (orgId: string) => ["members", orgId] as const,
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
		// Unified inbox queries
		inbox: <T extends object>(params?: T) => ["approvals", "inbox", params] as const,
		inboxCounts: () => ["approvals", "inbox", "counts"] as const,
		detail: (approvalId: string) => ["approvals", "detail", approvalId] as const,
		// Legacy queries (for backward compatibility)
		absences: <T extends object>(params?: T) => ["approvals", "absences", params] as const,
		timeCorrections: <T extends object>(params?: T) =>
			["approvals", "time-corrections", params] as const,
	},

	// Absence plan preview
	absencePlanPreview: {
		all: ["absence-plan-preview"] as const,
		detail: <T extends object>(orgId: string, input: T) =>
			["absence-plan-preview", orgId, input] as const,
	},

	// Absence categories
	absenceCategories: {
		all: ["absence-categories"] as const,
		list: (orgId: string) => ["absence-categories", orgId] as const,
	},

	// Travel expenses
	travelExpenses: {
		all: ["travel-expenses"] as const,
		list: <T extends object>(params?: T) => ["travel-expenses", "list", params] as const,
		detail: (claimId: string) => ["travel-expenses", "detail", claimId] as const,
		/** The employee's unified report and claim history (#617). */
		history: (scope?: { organizationId: string; employeeId: string }) =>
			scope
				? (["travel-expenses", "history", scope.organizationId, scope.employeeId] as const)
				: (["travel-expenses", "history"] as const),
		report: (reportId: string) => ["travel-expenses", "reports", reportId] as const,
		approverSettings: () => ["travel-expenses", "settings", "approver"] as const,
		expenseOfficers: () => ["travel-expenses", "settings", "expense-officers"] as const,
		reimbursementCurrency: () => ["travel-expenses", "settings", "reimbursement-currency"] as const,
		reimbursementChannel: () => ["travel-expenses", "settings", "reimbursement-channel"] as const,
		payrollWageTypes: () => ["travel-expenses", "settings", "payroll-wage-types"] as const,
		foreignDraftExpenses: () => ["travel-expenses", "settings", "foreign-draft-expenses"] as const,
		mileagePolicy: () => ["travel-expenses", "settings", "mileage-policy"] as const,
		perDiemPolicy: () => ["travel-expenses", "settings", "per-diem-policy"] as const,
		allowanceExceptions: () => ["travel-expenses", "settings", "allowance-exceptions"] as const,
		legacyPolicies: () => ["travel-expenses", "settings", "legacy-policies"] as const,
		reportSubmission: (reportId: string, cycle?: number) =>
			["travel-expenses", "reports", reportId, "submission", cycle ?? "latest"] as const,
		/** Every finance read: queue, filters, counts and the coverage gap. */
		finance: () => ["travel-expenses", "finance"] as const,
		/** One page of the finance queue; `search` = the view's search string (#753). */
		financeQueue: (search: string, coverage?: string) =>
			["travel-expenses", "finance", "queue", search, coverage ?? "all"] as const,
		financeQueueFilters: () => ["travel-expenses", "finance", "queue-filters"] as const,
		/** The sidebar Finance item's awaiting-reimbursement count (#753). */
		financeAwaitingCount: () => ["travel-expenses", "finance", "awaiting-count"] as const,
		officerCoverageGap: () => ["travel-expenses", "finance", "coverage-gap"] as const,
		settlement: (sourceType: string, sourceId: string) =>
			["travel-expenses", "settlement", sourceType, sourceId] as const,
		receiptExceptionSettings: () => ["travel-expenses", "settings", "receipt-exceptions"] as const,
		projectChoices: (reportId: string, from: string, to: string, selected: string | null) =>
			["travel-expenses", "reports", reportId, "projects", from, to, selected] as const,
		/** Expenses whose project is not proven on their date; `fingerprint` = saved dates and projects. */
		reportProjectIssues: (reportId: string, fingerprint: string) =>
			["travel-expenses", "reports", reportId, "project-issues", fingerprint] as const,
		projectExceptions: () => ["travel-expenses", "settings", "project-exceptions"] as const,
		financeExports: () => ["travel-expenses", "finance", "exports"] as const,
		reportReopen: (reportId: string) => ["travel-expenses", "reports", reportId, "reopen"] as const,
		referenceRateSettings: () => ["travel-expenses", "settings", "reference-rates"] as const,
		reportAdjustments: (reportId: string) =>
			["travel-expenses", "reports", reportId, "adjustments"] as const,
		legacyConversion: (reportId: string) =>
			["travel-expenses", "reports", reportId, "legacy-conversion"] as const,
		/** Every payroll run query: the runs and payroll run readiness. */
		payrollRuns: () => ["travel-expenses", "payroll-runs"] as const,
		/** The payroll access holder's unconfirmed payroll runs (#852). */
		scopedPayrollRuns: () => ["travel-expenses", "payroll-runs", "scoped"] as const,
		/** The unconfirmed payroll runs the reader may confirm as paid (#853). */
		payrollRunsToConfirm: () => ["travel-expenses", "payroll-runs", "to-confirm"] as const,
		/** What a payroll run of the period, format and employees would not carry (#854). */
		payrollRunReadiness: (request: {
			startDate: string;
			endDate: string;
			formatId: string;
			employeeIds?: readonly string[];
		}) =>
			[
				"travel-expenses",
				"payroll-runs",
				"readiness",
				request.startDate,
				request.endDate,
				request.formatId,
				request.employeeIds?.join(",") ?? "scope",
			] as const,
	},

	// Payroll workspace
	payroll: {
		/** Overtime payouts an export of the period, format and employees would leave out (#1001). */
		overtimePayoutReadiness: (request: {
			startDate: string;
			endDate: string;
			formatId: string;
			employeeIds?: readonly string[];
		}) =>
			[
				"payroll",
				"overtime-payout-readiness",
				request.startDate,
				request.endDate,
				request.formatId,
				request.employeeIds?.join(",") ?? "scope",
			] as const,
	},

	// Employees
	employees: {
		all: ["employees"] as const,
		organization: (orgId: string) => ["employees", orgId] as const,
		list: <T extends object>(orgId: string, params?: T) => ["employees", orgId, params] as const,
		detail: (employeeId: string) => ["employees", "detail", employeeId] as const,
		rateHistory: (employeeId: string) =>
			["employees", "detail", employeeId, "rate-history"] as const,
		employmentHistory: (employeeId: string) =>
			["employees", "detail", employeeId, "employment-history"] as const,
		/** Lifecycle view; under the organization key so directory changes refresh it. */
		offboarding: (orgId: string, employeeId: string) =>
			["employees", orgId, "offboarding", employeeId] as const,
		offboardingPreview: (
			orgId: string,
			employeeId: string,
			lastWorkingDay: string | null,
			replacementEmployeeId: string | null,
		) =>
			[
				"employees",
				orgId,
				"offboarding",
				employeeId,
				"preview",
				lastWorkingDay,
				replacementEmployeeId,
			] as const,
	},

	// Personnel file (#865)
	personnelFile: {
		all: ["personnel-file"] as const,
		employee: (employeeId: string, category: string | null) =>
			["personnel-file", "employee", employeeId, category] as const,
		employeeAll: (employeeId: string) => ["personnel-file", "employee", employeeId] as const,
		myDocuments: () => ["personnel-file", "my-documents"] as const,
		officerGrants: () => ["personnel-file", "settings", "officer-grants"] as const,
		payslipBatch: (batchId: string) => ["personnel-file", "payslip-batch", batchId] as const,
		/** Sick notes on absences (#982). */
		sickNotesAll: () => ["personnel-file", "sick-notes"] as const,
		ownAbsenceSickNotes: (absenceIds: readonly string[]) =>
			["personnel-file", "sick-notes", "own", ...absenceIds] as const,
		absenceSickNotes: (absenceId: string) =>
			["personnel-file", "sick-notes", "absence", absenceId] as const,
	},

	// Employee clock statuses
	employeeClockStatuses: {
		all: ["employee-clock-statuses"] as const,
		list: (orgId: string, employeeIds: string[]) =>
			[
				"employee-clock-statuses",
				orgId,
				Array.from(
					new Set(
						employeeIds.flatMap((id) => {
							const trimmed = id.trim();
							return trimmed ? [trimmed] : [];
						}),
					),
				).toSorted(),
			] as const,
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
		/** The signed-in employee's own position capture and consent (#826). */
		positionCapture: () => ["time-clock", "position-capture"] as const,
	},

	// Position stamps on a work period's detail (#831); never the positions themselves
	positionStamps: {
		viewerAccess: () => ["position-stamps", "viewer-access"] as const,
	},

	// Manual time entry form context (target zone and eligible choices)
	manualEntry: {
		all: ["manual-entry"] as const,
		targetContext: (targetEmployeeId: string | null) =>
			["manual-entry", "target-context", targetEmployeeId ?? "self"] as const,
	},

	// Canonical time records
	timeRecords: {
		all: ["time-records"] as const,
		list: <T extends object>(params?: T) => ["time-records", "list", params] as const,
		detail: (recordId: string) => ["time-records", "detail", recordId] as const,
	},

	// Offline queue
	offlineQueue: {
		all: ["offline-queue"] as const,
		count: () => ["offline-queue", "count"] as const,
		status: () => ["offline-queue", "status"] as const,
	},

	// Notifications
	notifications: {
		all: ["notifications"] as const,
		list: (options?: { limit?: number; unreadOnly?: boolean; organizationId?: string | null }) =>
			["notifications", "list", options] as const,
		unreadCount: (organizationId?: string | null) =>
			organizationId
				? (["notifications", "unread-count", organizationId] as const)
				: (["notifications", "unread-count"] as const),
		preferences: (organizationId?: string | null) =>
			organizationId
				? (["notifications", "preferences", organizationId] as const)
				: (["notifications", "preferences"] as const),
		pushBootstrap: () => ["notifications", "push", "bootstrap"] as const,
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

	// Holiday category assignments (custom holiday categories to org/team/employee)
	holidayCategoryAssignments: {
		all: ["holiday-category-assignments"] as const,
		list: (orgId: string) => ["holiday-category-assignments", orgId] as const,
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
		list: (orgId: string, dateRange?: { startDate: string; endDateExclusive: string }) =>
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

	// Custom field values (#818): the "Custom fields" section of a record (null = being created)
	customFields: {
		all: ["custom-fields"] as const,
		section: (entity: string, recordId: string | null) =>
			["custom-fields", "section", entity, recordId ?? "new"] as const,
	},

	// Customers
	customers: {
		all: ["customers"] as const,
		list: (orgId: string) => ["customers", "list", orgId] as const,
		detail: (customerId: string) => ["customers", "detail", customerId] as const,
		selection: (orgId: string) => ["customers", "selection", orgId] as const,
	},

	// Projects
	projects: {
		all: ["projects"] as const,
		list: <T extends object>(orgId: string, params?: T) =>
			["projects", "list", orgId, params] as const,
		detail: (projectId: string) => ["projects", "detail", projectId] as const,
		assignable: (orgId: string) => ["projects", "assignable", orgId] as const,
		teamSelection: (orgId: string) => ["projects", "teamSelection", orgId] as const,
		employeeSelection: (orgId: string) => ["projects", "employeeSelection", orgId] as const,
		tasks: (projectId: string) => ["projects", "tasks", projectId] as const,
		/** Task choices for clocking out another employee's running work (#874). */
		onBehalfClockOutTasks: (workPeriodId: string) =>
			["projects", "onBehalfClockOutTasks", workPeriodId] as const,
		templates: (orgId: string) => ["projects", "templates", orgId] as const,
		templateDetail: (templateId: string) => ["projects", "templateDetail", templateId] as const,
		// Under `templates`/`templateDetail`, so template changes refresh them too.
		templateChoices: (orgId: string) => ["projects", "templates", orgId, "choices"] as const,
		templatePreview: (templateId: string) =>
			["projects", "templateDetail", templateId, "preview"] as const,
	},

	// Billable Time (#768; not the Z8 subscription)
	billableTime: {
		all: ["billableTime"] as const,
		/** One billable rate series: a rate level and its target ids. */
		rateHistory: (
			level: string,
			employeeId: string | null,
			projectId: string | null,
			customerId: string | null,
		) => ["billableTime", "rateHistory", level, employeeId, projectId, customerId] as const,
		/** One employee's cost rates (#899). */
		costRateHistory: (employeeId: string) =>
			["billableTime", "costRateHistory", employeeId] as const,
		/** The accounting connection and every customer's accounting side (#903). */
		accountingSettings: () => ["billableTime", "accounting", "settings"] as const,
		/** One customer's contact link and tax treatment (#903). */
		customerAccounting: (customerId: string) =>
			["billableTime", "accounting", "customer", customerId] as const,
		/** A contact picker search in the connected accounting tool (#903). */
		contactSearch: (query: string) =>
			["billableTime", "accounting", "contactSearch", query] as const,
		/** The hand-off area: customers, hand-offs and marked work (#903). */
		handOffOverview: () => ["billableTime", "handOff", "overview"] as const,
		/** One hand-off (invoice draft) with its lines, work and timesheet (#903). */
		invoiceDraft: (draftId: string) => ["billableTime", "handOff", "draft", draftId] as const,
		/** The accounting tool's status of one invoice draft (#903). */
		invoiceDraftStatus: (draftId: string) =>
			["billableTime", "handOff", "draftStatus", draftId] as const,
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
		providers: () => ["auth", "providers"] as const,
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
		/** Every calendar events query, whatever its range, filters or employee */
		allEvents: ["calendar", "events"] as const,
		events: (
			orgId: string,
			params: {
				year: number;
				month?: number;
				fullYear?: boolean;
				dateRange?: {
					startDateKey: string;
					endDateKey: string;
				};
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
		/** Whether and how the current user may edit a work period's times */
		workPeriodTimeEdit: (workPeriodId: string) =>
			["calendar", "work-period-time-edit", workPeriodId] as const,
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
		presets: (orgId: string) => ["work-policies", "presets", orgId] as const,
		violations: {
			all: ["work-policies", "violations"] as const,
			list: (orgId: string, dateRange: { start: Date; end: Date }) =>
				["work-policies", "violations", "list", orgId, dateRange] as const,
			byEmployee: (employeeId: string, dateRange: { start: Date; end: Date }) =>
				["work-policies", "violations", "employee", employeeId, dateRange] as const,
		},
		effective: (employeeId: string) => ["work-policies", "effective", employeeId] as const,
		presence: {
			status: (employeeId: string) => ["work-policies", "presence", "status", employeeId] as const,
		},
	},

	// ArbZG Compliance
	compliance: {
		all: ["compliance"] as const,
		// Schedule compliance warnings for scheduler publish flow
		scheduleWarnings: (orgId: string, dateRange: { startDate: string; endDateExclusive: string }) =>
			["compliance", "schedule-warnings", orgId, dateRange] as const,
		// Rest period check for clock-in
		restPeriod: (employeeId: string) => ["compliance", "rest-period", employeeId] as const,
		// Proactive alerts during active session
		alerts: (employeeId: string) => ["compliance", "alerts", employeeId] as const,
		// Full compliance status
		status: (employeeId: string) => ["compliance", "status", employeeId] as const,
		// Overtime statistics
		overtime: (employeeId: string) => ["compliance", "overtime", employeeId] as const,
		// Exception requests
		exceptions: {
			all: ["compliance", "exceptions"] as const,
			// Employee's own exceptions
			my: (employeeId: string, includeExpired?: boolean) =>
				["compliance", "exceptions", "my", employeeId, includeExpired] as const,
			// Pending exceptions for manager/admin
			pending: (orgId: string) => ["compliance", "exceptions", "pending", orgId] as const,
		},
		// Pending exceptions count (for badge)
		pendingExceptions: (orgId: string) => ["compliance", "pending-exceptions", orgId] as const,
	},

	// Coverage Targets (minimum staffing requirements)
	coverage: {
		all: ["coverage"] as const,
		rules: (orgId: string, subareaId?: string) => ["coverage", "rules", orgId, subareaId] as const,
		ruleDetail: (ruleId: string) => ["coverage", "rules", "detail", ruleId] as const,
		heatmap: (orgId: string, dateRange: { startDate: string; endDateExclusive: string }) =>
			["coverage", "heatmap", orgId, dateRange] as const,
		validation: (orgId: string, dateRange: { start: Date; end: Date }) =>
			["coverage", "validation", orgId, dateRange] as const,
	},

	// Skills & Qualifications
	skills: {
		all: ["skills"] as const,
		list: (orgId: string, includeInactive?: boolean) =>
			["skills", "list", orgId, includeInactive] as const,
		detail: (skillId: string) => ["skills", "detail", skillId] as const,
		// Employee skill assignments
		employee: (employeeId: string) => ["skills", "employee", employeeId] as const,
		// Subarea skill requirements
		subarea: (subareaId: string) => ["skills", "subarea", subareaId] as const,
		// Template skill requirements
		template: (templateId: string) => ["skills", "template", templateId] as const,
		// Skill validation for shift assignment
		validation: (employeeId: string, subareaId: string, templateId?: string) =>
			["skills", "validation", employeeId, subareaId, templateId] as const,
		// Qualified employees for a set of skills
		qualified: (skillIds: string[]) => ["skills", "qualified", skillIds] as const,
	},
	// Telegram integration
	telegram: {
		all: ["telegram"] as const,
		config: (orgId: string) => ["telegram", "config", orgId] as const,
		link: (userId: string, orgId: string) => ["telegram", "link", userId, orgId] as const,
	},
} as const;
