# PostgreSQL: Safely Parse and Persist Temporal Values

Use this ref when migrating database boundaries to `Temporal` in PostgreSQL-backed systems.

## Core Principles (Applied to PostgreSQL)

1. **Model intent first**
   - Machine event timestamp -> `Temporal.Instant` + `TIMESTAMPTZ`.
   - Calendar-only value -> `Temporal.PlainDate` + `DATE`.
   - Local wall-clock value with business zone ownership -> keep zone ID explicitly and reconstruct as `Temporal.ZonedDateTime` in application code.

2. **Make timezone ownership explicit**
   - Prefer UTC persistence for machine timestamps.
   - Store the IANA timezone separately when business logic depends on user/tenant zone semantics.

3. **Boundary-first migration**
   - Parse at DB read boundaries into canonical `Temporal` types.
   - Serialize at DB write boundaries from canonical `Temporal` types.
   - Avoid leaking `Date` into domain logic.

## Recommended Column Mapping

- `Temporal.Instant` <-> `TIMESTAMPTZ` (normalized UTC instant)
- `Temporal.PlainDate` <-> `DATE`
- `Temporal.PlainTime` <-> `TIME` (only when truly date-independent)
- `Temporal.ZonedDateTime` <-> `TIMESTAMPTZ` + `TEXT zone_id` (persist both instant and zone ownership)

## Safe Parsing from PostgreSQL Rows

```ts
type EventRow = {
  occurred_at: string;        // TIMESTAMPTZ from driver
  billing_date: string;       // DATE from driver
  tenant_zone: string | null; // e.g. "Europe/Berlin"
};

const parseEventRow = (row: EventRow) => ({
  occurredAt: Temporal.Instant.from(row.occurred_at),
  billingDate: Temporal.PlainDate.from(row.billing_date),
  tenantZone: row.tenant_zone ?? "UTC",
});
```

## Safe Persistence to PostgreSQL

```ts
type NewEvent = {
  occurredAt: Temporal.Instant;
  billingDate: Temporal.PlainDate;
  tenantZone: string;
};

const insertEventParams = (event: NewEvent) => [
  event.occurredAt.toString(), // ISO instant string (Z)
  event.billingDate.toString(), // YYYY-MM-DD
  event.tenantZone,             // IANA zone id
];
```

## What to Avoid

### 1) Avoid storing local date-time without zone ownership

```ts
// ❌ Avoid: ambiguous local datetime
await db.query(
  "INSERT INTO jobs (run_at_local) VALUES ($1)",
  ["2026-10-25T01:30:00"]
);
```

```ts
// ✅ Prefer: store instant + zone ownership
await db.query(
  "INSERT INTO jobs (run_at, run_zone) VALUES ($1, $2)",
  [runAtInstant.toString(), "Europe/Berlin"]
);
```

### 2) Avoid epoch-millisecond-only schemas for calendar data

```ts
// ❌ Avoid: calendar intent lost
await db.query("UPDATE invoices SET due_date_ms = $1 WHERE id = $2", [
  dueDateEpochMs,
  invoiceId,
]);
```

```ts
// ✅ Prefer: preserve date semantics
await db.query("UPDATE invoices SET due_date = $1 WHERE id = $2", [
  dueDate.toString(), // Temporal.PlainDate
  invoiceId,
]);
```

### 3) Avoid implicit driver `Date` conversion in domain logic

```ts
// ❌ Avoid
const created = row.created_at as Date;
const expired = created.getTime() < Date.now();
```

```ts
// ✅ Prefer explicit parse to Temporal at boundary
const created = Temporal.Instant.from(row.created_at as string);
const expired = Temporal.Instant.compare(created, Temporal.Now.instant()) < 0;
```
