# Personnel number unique per organization (#881, #1196)

## What changed

- **Rule.** No two employees of one organization, current or former, share a personnel number
  (`employee.employee_number`). Numbers are compared trimmed and ignoring case, and leading
  zeros count (`0042` is not `42`). A blank number is stored as NULL. The rule lives in
  `apps/webapp/src/lib/organization/personnel-number.ts` (`normalizePersonnelNumber`,
  `personnelNumberKey`, `PERSONNEL_NUMBER_WHITESPACE`).
- **Database.** Migration `0232_employee_personnel_number_unique` creates the partial unique index
  `employee_organization_personnel_number_unique_idx` on
  `(organization_id, lower(btrim(employee_number, <whitespace>)))` for employees that have a
  number. `<whitespace>` is JavaScript's `trim` set, because one-argument `btrim` strips only
  spaces.
- **Employee edit.** `updateEmployeeAction` refuses a number another employee of the
  organization holds. The refusal is a `ValidationError` on `employeeNumber` with
  `refusal: "personnel_number_taken"`, and its message names the holder. A concurrent save that
  loses on the unique index gets the same refusal. Helpers for other writers are in
  `apps/webapp/src/lib/organization/personnel-number-uniqueness.ts`.
- **Demo data.** The demo employee generator draws numbers no employee of the organization holds.

## Before deploying migration 0232

The migration first checks for clashes. If two employees of one organization share a number
under the rule above, it fails and lists every clash: organization id, the number, and the
employee ids. It changes no row and never renames or clears a number. Fix the clashes by hand
and run the migration again.

To check production before deploying, run this read-only query. It groups exactly like the
migration. It returns no rows when the migration will succeed.

```sql
-- Personnel numbers shared within an organization (#881). Read-only.
WITH numbered AS (
	SELECT
		e.organization_id,
		e.id AS employee_id,
		e.is_active,
		btrim(
			e.employee_number,
			E'\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
		) AS personnel_number
	FROM employee AS e
)
SELECT
	n.organization_id,
	o.name AS organization_name,
	lower(n.personnel_number) AS personnel_number_key,
	count(*) AS employee_count,
	array_agg(n.employee_id ORDER BY n.employee_id) AS employee_ids,
	array_agg(n.personnel_number ORDER BY n.employee_id) AS stored_numbers,
	array_agg(n.is_active ORDER BY n.employee_id) AS is_active
FROM numbered AS n
JOIN organization AS o ON o.id = n.organization_id
WHERE n.personnel_number <> ''
GROUP BY n.organization_id, o.name, lower(n.personnel_number)
HAVING count(*) > 1
ORDER BY n.organization_id, personnel_number_key;
```

For each row, give all but one of the listed employees their own personnel number (or clear it
when the employee has none) in the employee settings, then run the query again.

## Known edge: lowercase in JavaScript and in PostgreSQL

The unique index, the migration check and the uniqueness lookups lowercase with PostgreSQL's
`lower()`, which follows the database collation. `personnelNumberKey`, which the payroll export
guard and readiness compare with, lowercases with JavaScript's Unicode rules. Both agree for
ASCII. For some other characters they can differ: under the `C` collation `lower()` changes
only `A`-`Z`, and JavaScript lowercases a Greek final sigma by context. Then JavaScript may treat
two numbers as one that the index allowed as two, and the export guard refuses the export
conservatively until one of them changes. Under the `C` and English/ICU-root collations it never
goes the other way. (A Turkish database collation would, because its `lower('I')` is the
dotless `ı`.) Matching behaviour is unchanged.
