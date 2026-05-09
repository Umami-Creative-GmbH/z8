export type AppConfig = {
  port: number;
  namespace: string;
  githubOwner: string;
  githubWebhookSecret: string;
  ghcrUsername?: string;
  ghcrToken?: string;
  registryHost: string;
  rolloutTimeoutMs: number;
  migrationTimeoutMs: number;
  stateConfigMapName: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function intEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer`);
  }
  return parsed;
}

export function loadConfig(): AppConfig {
  return {
    port: intEnv("PORT", 8080),
    namespace: process.env.NAMESPACE ?? "app-prod",
    githubOwner: process.env.GITHUB_OWNER ?? "umami-creative-gmbh",
    githubWebhookSecret: requiredEnv("GITHUB_WEBHOOK_SECRET"),
    ghcrUsername: process.env.GHCR_USERNAME || undefined,
    ghcrToken: process.env.GHCR_TOKEN || undefined,
    registryHost: process.env.REGISTRY_HOST ?? "ghcr.io",
    rolloutTimeoutMs: intEnv("ROLLOUT_TIMEOUT_MS", 600_000),
    migrationTimeoutMs: intEnv("MIGRATION_TIMEOUT_MS", 900_000),
    stateConfigMapName: process.env.STATE_CONFIG_MAP_NAME ?? "deploy-webhook-state"
  };
}
