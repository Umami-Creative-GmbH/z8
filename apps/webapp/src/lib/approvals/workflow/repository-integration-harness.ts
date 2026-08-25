const approvalWorkflowRepositoryTestSentinel =
	"approval-workflow-repository-test";
const approvalWorkflowRepositoryTestDatabaseName =
	/^approval_workflow_repository_test_[a-z0-9_]+$/;

type DatabaseGuardOptions = {
	databaseUrl: string | undefined;
	required: boolean;
	sentinel: string | undefined;
	currentDatabase: () => Promise<string>;
};

export type ApprovalWorkflowRepositoryTestDatabaseConfig = {
	databaseUrl: string;
	databaseName: string;
};

export type ApprovalWorkflowRepositoryTestConfiguration =
	| {
			status: "unavailable";
			reason: "disposable PostgreSQL URL and sentinel are not configured";
	  }
	| { status: "enabled"; databaseUrl: string }
	| { status: "error"; reason: string };

export type ApprovalWorkflowRepositoryTestDatabaseGuard =
	| Extract<
			ApprovalWorkflowRepositoryTestConfiguration,
			{ status: "unavailable" }
	  >
	| {
			status: "enabled";
			databaseUrl: string;
			databaseName: string;
	  };

export function resolveApprovalWorkflowRepositoryTestConfiguration(input: {
	databaseUrl: string | undefined;
	required: boolean;
	sentinel: string | undefined;
}): ApprovalWorkflowRepositoryTestConfiguration {
	if (!input.databaseUrl && !input.sentinel && !input.required) {
		return {
			status: "unavailable",
			reason: "disposable PostgreSQL URL and sentinel are not configured",
		};
	}
	if (!input.databaseUrl) {
		return { status: "error", reason: "disposable PostgreSQL URL is missing" };
	}
	if (input.sentinel !== approvalWorkflowRepositoryTestSentinel) {
		return {
			status: "error",
			reason: "disposable PostgreSQL sentinel is missing or invalid",
		};
	}
	parseApprovalWorkflowRepositoryTestDatabaseUrl(input.databaseUrl);
	return { status: "enabled", databaseUrl: input.databaseUrl };
}

export function parseApprovalWorkflowRepositoryTestDatabaseUrl(
	databaseUrl: string,
): ApprovalWorkflowRepositoryTestDatabaseConfig {
	let parsed: URL;
	try {
		parsed = new URL(databaseUrl);
	} catch {
		throw new Error(
			"Approval workflow test DB URL must be a valid PostgreSQL URL",
		);
	}
	if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
		throw new Error(
			"Approval workflow test DB URL must use a PostgreSQL protocol",
		);
	}
	if (parsed.search !== "") {
		throw new Error(
			"Approval workflow test DB URL must not include query parameters",
		);
	}
	const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
	if (!new Set(["127.0.0.1", "localhost", "::1"]).has(hostname)) {
		throw new Error("Approval workflow test DB URL must use a loopback host");
	}

	const databaseName = decodeURIComponent(parsed.pathname.slice(1));
	if (!approvalWorkflowRepositoryTestDatabaseName.test(databaseName)) {
		throw new Error(
			"Refusing to target a non-isolated approval workflow test DB",
		);
	}
	return { databaseUrl, databaseName };
}

export async function verifyApprovalWorkflowRepositoryTestDatabase({
	databaseUrl,
	required,
	sentinel,
	currentDatabase,
}: DatabaseGuardOptions): Promise<ApprovalWorkflowRepositoryTestDatabaseGuard> {
	const configuration = resolveApprovalWorkflowRepositoryTestConfiguration({
		databaseUrl,
		required,
		sentinel,
	});
	if (configuration.status === "unavailable") return configuration;
	if (configuration.status === "error") {
		throw new Error(
			`Invalid approval workflow repository test configuration: ${configuration.reason}`,
		);
	}

	const databaseName = await currentDatabase();
	if (!approvalWorkflowRepositoryTestDatabaseName.test(databaseName)) {
		throw new Error(
			"current_database() is not an approval workflow repository test database",
		);
	}

	return {
		status: "enabled",
		databaseUrl: configuration.databaseUrl,
		databaseName,
	};
}

export { approvalWorkflowRepositoryTestSentinel };
