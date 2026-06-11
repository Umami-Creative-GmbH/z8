export interface StreamSession {
	user?: { id: string } | null;
	session?: { activeOrganizationId?: string | null } | null;
}

export interface AuthDependencies {
	getSession: (headers: Headers) => Promise<StreamSession | null>;
	findActiveEmployee: (params: { userId: string; organizationId: string }) => Promise<{ organizationId: string } | null>;
}

export type StreamAuthResult =
	| { ok: true; userId: string; organizationId: string }
	| { ok: false; status: 400 | 401; message: string };

export async function validateStreamRequest(headers: Headers, deps: AuthDependencies): Promise<StreamAuthResult> {
	const session = await deps.getSession(headers);
	if (!session?.user?.id) return { ok: false, status: 401, message: "Unauthorized" };

	const organizationId = session.session?.activeOrganizationId;
	if (!organizationId) return { ok: false, status: 400, message: "No active organization" };

	const employee = await deps.findActiveEmployee({ userId: session.user.id, organizationId });
	if (!employee) return { ok: false, status: 400, message: "No active employee record in this organization" };

	return { ok: true, userId: session.user.id, organizationId: employee.organizationId };
}
