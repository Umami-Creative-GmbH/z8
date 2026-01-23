/**
 * Test helpers for auth and org-scoping tests
 */

/**
 * Session type for tests (matches Better Auth session structure)
 */
export interface MockSession {
	user: {
		id: string;
		email: string;
		name: string;
		emailVerified: boolean;
		image?: string | null;
		createdAt: Date;
		updatedAt: Date;
	};
	session: {
		id: string;
		userId: string;
		activeOrganizationId?: string | null;
		expiresAt: Date;
		ipAddress?: string | null;
		userAgent?: string | null;
	};
}

/**
 * Employee type for tests
 */
export interface MockEmployee {
	id: string;
	userId: string;
	organizationId: string;
	role: "admin" | "manager" | "employee";
	isActive: boolean;
	createdAt: Date;
	updatedAt: Date;
}

/**
 * Create a mock session with default values
 */
export function createMockSession(overrides?: {
	user?: Partial<MockSession["user"]>;
	session?: Partial<MockSession["session"]>;
}): MockSession {
	const now = new Date();
	const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now

	return {
		user: {
			id: overrides?.user?.id ?? "user-1",
			email: overrides?.user?.email ?? "test@example.com",
			name: overrides?.user?.name ?? "Test User",
			emailVerified: overrides?.user?.emailVerified ?? true,
			image: overrides?.user?.image ?? null,
			createdAt: overrides?.user?.createdAt ?? now,
			updatedAt: overrides?.user?.updatedAt ?? now,
		},
		session: {
			id: overrides?.session?.id ?? "session-1",
			userId: overrides?.session?.userId ?? overrides?.user?.id ?? "user-1",
			activeOrganizationId: overrides?.session?.activeOrganizationId ?? "org-1",
			expiresAt: overrides?.session?.expiresAt ?? expiresAt,
			ipAddress: overrides?.session?.ipAddress ?? "127.0.0.1",
			userAgent: overrides?.session?.userAgent ?? "test-agent",
		},
	};
}

/**
 * Create a mock session without activeOrganizationId
 */
export function createMockSessionWithoutActiveOrg(overrides?: {
	user?: Partial<MockSession["user"]>;
	session?: Partial<Omit<MockSession["session"], "activeOrganizationId">>;
}): MockSession {
	const session = createMockSession(overrides);
	session.session.activeOrganizationId = null;
	return session;
}

/**
 * Create a mock employee with default values
 */
export function createMockEmployee(overrides?: Partial<MockEmployee>): MockEmployee {
	const now = new Date();

	return {
		id: overrides?.id ?? "emp-1",
		userId: overrides?.userId ?? "user-1",
		organizationId: overrides?.organizationId ?? "org-1",
		role: overrides?.role ?? "employee",
		isActive: overrides?.isActive ?? true,
		createdAt: overrides?.createdAt ?? now,
		updatedAt: overrides?.updatedAt ?? now,
	};
}

/**
 * Create a set of employees for multi-org testing
 * Returns employees for the same user in different organizations
 */
export function createMultiOrgEmployees(
	userId: string,
	orgIds: string[],
): MockEmployee[] {
	return orgIds.map((orgId, index) =>
		createMockEmployee({
			id: `emp-${index + 1}`,
			userId,
			organizationId: orgId,
			isActive: true,
		}),
	);
}

/**
 * Create a mock time entry
 */
export interface MockTimeEntry {
	id: string;
	employeeId: string;
	organizationId: string;
	timestamp: Date;
	type: "clock_in" | "clock_out" | "correction";
	createdAt: Date;
}

export function createMockTimeEntry(overrides?: Partial<MockTimeEntry>): MockTimeEntry {
	const now = new Date();

	return {
		id: overrides?.id ?? "entry-1",
		employeeId: overrides?.employeeId ?? "emp-1",
		organizationId: overrides?.organizationId ?? "org-1",
		timestamp: overrides?.timestamp ?? now,
		type: overrides?.type ?? "clock_in",
		createdAt: overrides?.createdAt ?? now,
	};
}
