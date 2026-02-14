# Presence Policy Design

Admins/owners can configure how many days per week employees must be physically present at a location, supporting hybrid work models (e.g., 3 days office, 2 days home on a 5-day week).

## Approach

Extend the existing `workPolicy` system with a new `presenceEnabled` feature toggle and a `workPolicyPresence` table (1:1 with `workPolicy`). This reuses the existing hierarchical assignment infrastructure (org -> team -> employee priority) and keeps presence configuration alongside schedule and regulation settings.

The existing `homeOfficeDaysPerCycle` field on `workPolicySchedule` is deprecated in favor of this richer model.

## Schema Changes

### New enums

```
workLocationTypeEnum: ["office", "home", "field", "other"]
presenceModeEnum: ["minimum_count", "fixed_days"]
presenceEnforcementEnum: ["block", "warn", "none"]
presenceEvaluationPeriodEnum: ["weekly", "biweekly", "monthly"]
```

### Extended tables

**`workPolicy`** -- add column:
- `presenceEnabled: boolean, default false, not null`

**`workPeriod`** -- add column:
- `workLocationType: workLocationTypeEnum, nullable`

**`timeRegulationViolationTypeEnum`** -- add value:
- `presence_requirement`

### New table: `workPolicyPresence`

```
workPolicyPresence {
  id: uuid PK
  policyId: uuid FK -> workPolicy.id (unique, cascade delete)

  presenceMode: presenceModeEnum          -- "minimum_count" or "fixed_days"
  requiredOnsiteDays: integer             -- for minimum_count mode (e.g., 3)
  requiredOnsiteFixedDays: text (JSON)    -- for fixed_days mode (e.g., ["monday","wednesday","friday"])

  locationId: uuid FK -> location.id      -- nullable; null = any on-site location counts
  evaluationPeriod: presenceEvaluationPeriodEnum  -- default: "weekly"
  enforcement: presenceEnforcementEnum    -- default: "warn"

  createdAt: timestamp
  updatedAt: timestamp
}
```

Indexes: `policyId` (unique), `locationId`.

## Presence Counting Logic

### What counts as on-site

- Work periods with `workLocationType` of `office` or `field` count as on-site.
- `home` and `other` do not count.
- If `locationId` is set on the policy, only work periods at that specific location count.
- Days with approved `home_office` absence entries are explicitly not on-site.

### Denominator adjustments

Days with absences (sick, vacation, parental, etc.) and public/company holidays are excluded from the denominator. If an employee is sick 1 day in a 5-day week with a 3-day presence requirement, they need 3 of the 4 remaining days on-site.

### Evaluation modes

**minimum_count**: on-site day count >= `requiredOnsiteDays` (adjusted for absences/holidays).

**fixed_days**: each day in `requiredOnsiteFixedDays` must have at least one on-site work period, unless that specific day is an absence or holiday.

### Day counting

A day counts as on-site if any work period that day has `workLocationType` in (`office`, `field`). Multiple work periods on the same day do not double-count.

## Compliance Evaluation

### When it runs

- Nightly batch job via BullMQ (same infrastructure as existing compliance detection).
- Weekly evaluation: runs every Monday for the previous week.
- Monthly evaluation: runs on the 1st for the previous month.
- Biweekly: runs every other Monday.

### Violation records

Creates `workPolicyViolation` records with `violationType = 'presence_requirement'` and details JSON containing:
```json
{
  "requiredDays": 3,
  "actualDays": 1,
  "evaluationStart": "2026-02-09",
  "evaluationEnd": "2026-02-13",
  "mode": "minimum_count",
  "excludedDays": ["2026-02-11"],
  "excludedReasons": ["sick"]
}
```

### Enforcement behavior

| Mode | Behavior |
|------|----------|
| `none` | Track silently. Violations recorded, no notification. |
| `warn` | Record violation + notify employee and their manager(s). |
| `block` | Same as warn + escalate to admin, flag prominently on dashboard. No hard blocking of clock-in (unlike rest period enforcement). |

## Admin Configuration UI

### Location in settings

New "Presence" section in the Work Policy editor, alongside existing "Schedule" and "Regulation" tabs. Gated by the `presenceEnabled` toggle on the work policy.

### Policy editor fields

1. **Toggle**: "Presence Requirements" on/off
2. **Mode**: Radio -- "Minimum days on-site" or "Fixed days"
3. **Count/Days**: Number input (minimum mode) or day-of-week checkboxes (fixed mode)
4. **Evaluation period**: Dropdown (Weekly / Biweekly / Monthly)
5. **Location**: Optional dropdown of org locations ("Any location" default)
6. **Enforcement**: Three-way selector (None / Warn / Escalate)

### Validation

- `requiredOnsiteDays` must not exceed working days in the associated schedule.
- `requiredOnsiteFixedDays` must be a subset of the schedule's working days.
- If `presenceEnabled` is true, either `requiredOnsiteDays` or `requiredOnsiteFixedDays` must be set (depending on mode).

## Employee Experience

### Clock-in location tagging

When clocking in, employees see a location type selector (segmented control):
- Office / Home / Field / Other

Defaults to the employee's most recent selection (sticky preference stored client-side) to minimize friction for employees with consistent patterns.

### Dashboard presence card

Employee dashboard shows a "Presence" progress indicator:
- Current period progress: "2/3 days on-site this week"
- Visual progress bar
- Warning state if behind pace (e.g., Thursday with only 1/3 days)

### Manager view

Aggregated presence compliance per team member, surfacing who is behind on presence requirements.

## Edge Cases

| Scenario | Handling |
|----------|----------|
| No location tag on clock-in | Treated as not on-site (conservative). Soft reminder notification sent. |
| Part-time employees | Assign a different policy via employee-level override (priority 2). |
| Multiple work periods per day | Day counts once if any period is on-site. |
| Policy changed mid-period | Evaluate using policy active at end of period. No retroactive violations. |
| Holidays | Excluded from denominator. |
| Employee transfers teams mid-week | Use highest-priority active assignment at end of period. |

## Error Handling

- Nightly job failures retry via BullMQ (exponential backoff, 3 attempts).
- Per-employee error isolation: one employee's evaluation failure doesn't block others.
- Invalid policy configs caught at save time with validation errors.

## Testing Strategy

- **Unit**: Presence counting logic (work periods + absences + holidays combinations).
- **Unit**: Violation detection for both modes.
- **Unit**: Edge cases (part-time, untagged days, mid-period policy changes, denominator adjustments).
- **Integration**: Nightly evaluation job end-to-end.
- **Schema**: Migration runs cleanly, new enums/columns exist.

## Migration Notes

- `homeOfficeDaysPerCycle` on `workPolicySchedule` is deprecated but not removed.
- Optional future migration: auto-convert orgs with `homeOfficeDaysPerCycle > 0` to presence policies.
