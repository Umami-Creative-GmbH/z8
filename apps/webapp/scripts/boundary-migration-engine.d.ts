import type { Client, Pool } from "pg";

export interface ConcurrentUniqueIndexSpec {
	readonly schema?: string;
	readonly tableName: string;
	readonly indexName: string;
	readonly columns: readonly string[];
	readonly requiredBeforePrefix: number;
}

export interface JournaledMigration {
	tag: string;
	prefix: number;
	when: number;
	folderMillis: number;
	hash: string;
	sql: string[];
	bps: boolean;
}

export interface MigrationStage {
	id: string;
	migrations: JournaledMigration[];
}

export interface DrainGateConfig {
	allowContractConstraints: boolean;
	allowPolicyV1Seal: boolean;
	lockRetries: number;
}

export interface AttachabilityEvaluation {
	status: "missing" | "attachable" | "rebuild_invalid" | "incompatible";
	reasons: string[];
}

export interface BackfillStepStats {
	step: string;
	chunks: number;
	totalProcessed: number;
}

export interface BoundaryMigrationRunResult {
	appliedStages: string[];
	indexActions: Array<{ action: "reused" | "created" | "rebuilt"; indexName: string }>;
	backfillStats: BackfillStepStats[] | null;
	stoppedAtGate: "drain_gate_1" | "drain_gate_2" | null;
}

export interface RunBoundaryAwareMigrationsOptions {
	pool?: Pool;
	client?: Client;
	migrationsFolder: string;
	migrationsSchema?: string;
	migrationsTable?: string;
	allowContractConstraints?: boolean;
	allowPolicyV1Seal?: boolean;
	lockRetries?: number;
	retryBaseDelayMs?: number;
	retryMaxDelayMs?: number;
	backfillChunkSize?: number;
	pre0318Indexes?: readonly ConcurrentUniqueIndexSpec[];
	pre0324Indexes?: readonly ConcurrentUniqueIndexSpec[];
	onStageCommitted?: (info: {
		stageId: string;
		tags: string[];
		xid: string | null;
	}) => void | Promise<void>;
	onBackfillChunkCommitted?: (info: {
		step: string;
		chunkNumber: number;
		rowsProcessed: number;
		totalProcessed: number;
	}) => void | Promise<void>;
	logger?: Pick<Console, "info" | "warn" | "error">;
}

export const DEFAULT_MIGRATION_LOCK_RETRIES: number;
export const DEFAULT_BACKFILL_CHUNK_SIZE: number;
export const PRE_0318_CONCURRENT_INDEXES: readonly ConcurrentUniqueIndexSpec[];
export const PRE_0324_CONCURRENT_INDEXES: readonly ConcurrentUniqueIndexSpec[];

export function parseDrainGateConfig(env?: Record<string, string | undefined>): DrainGateConfig;
export function extractPostgresErrorCode(error: unknown): string | null;
export function isRetryableLockOrTimeoutError(error: unknown): boolean;
export function withLockTimeoutRetry<T>(
	operation: (attempt: number) => Promise<T>,
	options?: {
		stepName?: string;
		maxRetries?: number;
		baseDelayMs?: number;
		maxDelayMs?: number;
		sleep?: (ms: number) => Promise<void>;
		random?: () => number;
		logger?: Pick<Console, "warn">;
	},
): Promise<T>;
export function runCommandWithLockRetry(
	commandSpec: { command: string; args: string[]; shell: boolean },
	options?: {
		stepName?: string;
		maxRetries?: number;
		baseDelayMs?: number;
		maxDelayMs?: number;
		sleep?: (ms: number) => Promise<void>;
		random?: () => number;
		spawnSyncImpl?: (...args: unknown[]) => {
			status: number | null;
			stdout?: string | null;
			stderr?: string | null;
			error?: Error;
		};
		stdoutWrite?: (chunk: string) => void;
		stderrWrite?: (chunk: string) => void;
		env?: Record<string, string | undefined>;
		cwd?: string;
		logger?: Pick<Console, "warn">;
	},
): Promise<{ status: number | null; stdout?: string | null; stderr?: string | null }>;
export function parseMigrationPrefix(tag: string): number;
export function readJournaledMigrations(migrationsFolder: string): JournaledMigration[];
export function buildMigrationStagePlan(
	migrations: ReadonlyArray<
		Pick<JournaledMigration, "tag" | "prefix" | "folderMillis" | "hash" | "sql">
	>,
): MigrationStage[];
export function evaluateUniqueIndexAttachability(
	row: Record<string, unknown> | null,
	spec: Pick<ConcurrentUniqueIndexSpec, "schema" | "tableName" | "indexName" | "columns">,
): AttachabilityEvaluation;
export function inspectUniqueIndexAttachability(
	client: Pick<Client, "query">,
	spec: Pick<ConcurrentUniqueIndexSpec, "schema" | "tableName" | "indexName" | "columns">,
): Promise<{ row: Record<string, unknown> | null; evaluation: AttachabilityEvaluation }>;
export function ensureAttachableUniqueIndex(
	client: Pick<Client, "query">,
	spec: ConcurrentUniqueIndexSpec,
	retryOptions?: {
		maxRetries?: number;
		baseDelayMs?: number;
		maxDelayMs?: number;
		logger?: Pick<Console, "warn">;
	},
): Promise<{ action: "reused" | "created" | "rebuilt"; indexName: string }>;
export function runPhase1ChunkedBackfill(
	client: Pick<Client, "query">,
	options?: {
		chunkSize?: number;
		retryOptions?: {
			maxRetries?: number;
			baseDelayMs?: number;
			maxDelayMs?: number;
			logger?: Pick<Console, "warn">;
		};
		onBackfillChunkCommitted?: RunBoundaryAwareMigrationsOptions["onBackfillChunkCommitted"];
	},
): Promise<BackfillStepStats[]>;
export function verifyPhase1BackfillCompleteness(
	client: Pick<Client, "query">,
): Promise<Record<string, number>>;
export function runBoundaryAwareMigrations(
	options: RunBoundaryAwareMigrationsOptions,
): Promise<BoundaryMigrationRunResult>;
