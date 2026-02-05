const { spawnSync } = require("node:child_process");
const { Client } = require("pg");

const lockIdRaw = process.env.DB_MIGRATION_LOCK_ID ?? "74382643";
const lockId = Number.parseInt(lockIdRaw, 10);

if (!Number.isInteger(lockId)) {
  throw new Error("DB_MIGRATION_LOCK_ID must be an integer.");
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run migrations.");
}

const migrateCommand =
  process.env.DRIZZLE_MIGRATE_COMMAND ??
  "pnpm dlx drizzle-kit migrate --config ./drizzle.config.ts";

const run = async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1);", [lockId]);

    const result = spawnSync(migrateCommand, {
      shell: true,
      stdio: "inherit",
    });

    if (result.status !== 0) {
      throw new Error(
        `Migration command failed with exit code ${result.status ?? "unknown"}.`
      );
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1);", [lockId]);
    } finally {
      await client.end();
    }
  }
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
