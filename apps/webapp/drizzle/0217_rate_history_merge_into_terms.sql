-- Merges every organization's employee_rate_history into confirmed employment terms (#1176,
-- Organization ADR 0002: employment terms are the only wage history).
--
-- A rate row is evidence of an hourly contract over its span. The merge runs per organization,
-- in that organization's timezone, and touches only that organization's rows:
-- - Dates: a stored timestamp at exactly 00:00:00 UTC is that UTC calendar date (rate card and
--   terms form); any other timestamp is an instant and means its org-local date (now() rows).
-- - Overlapping or same-day rate rows: the latest-written row wins; the loser is reported.
-- - Spans under confirmed hourly terms: the terms are split at each wage change, every other
--   field copied. Where the terms already carry a different wage, the latest-written value wins:
--   the terms' updated_at against the rate row's created_at.
-- - Spans under confirmed fixed terms: ignored and reported.
-- - Spans with no confirmed terms: new confirmed hourly terms with the row's wage and currency,
--   the terms form's defaults and no work policy, linked to the employment period that covers
--   them. A span with no period is skipped and reported. An employee without any period first
--   gets their legacy period (0071 backfill), as every period reader does.
-- - The open-ended rate row of an employee who is fixed today and has no terms is skipped and
--   reported: nothing says when it ended.
-- - An hourly employee whose wage lives only on employee.current_hourly_rate (no confirmed terms,
--   no rate rows) gets confirmed hourly terms carrying it from the start of their latest
--   employment period (or their start date), linked to that period. Without a known start the
--   employee is reported instead. This runs here because 0218 drops the column.
-- Every conflict (once per rate row and terms), every skipped or ignored row and every stored
-- wage goes to employee_rate_history_merge_report (operator-only). Each affected employee gets one
-- employee_wage_history_merge_note for the org admins, counting every rate row the merge acted on
-- (a stored wage counts as one), and a dirty contract work balance from the earliest changed date.
--
-- The merge is idempotent: running it again changes nothing. #1164 drops the report table,
-- employee_rate_history and these functions after verification; the note table stays.
CREATE TABLE "employee_rate_history_merge_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	-- Null for a stored employee wage.
	"rate_history_id" uuid,
	"terms_id" uuid,
	"reason" text NOT NULL,
	"winning_value" numeric(10, 2),
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employeeRateHistoryMergeReport_entry_unique" UNIQUE NULLS NOT DISTINCT
		("organization_id","employee_id","rate_history_id","terms_id","reason"),
	CONSTRAINT "employeeRateHistoryMergeReport_reason_check" CHECK ("reason" IN (
		'terms_wage_kept',
		'rate_wage_applied',
		'covered_by_fixed_terms',
		'fixed_without_terms_open_row',
		'no_employment_period',
		'superseded',
		'empty_after_rounding',
		'employee_wage_migrated'
	))
);
--> statement-breakpoint
ALTER TABLE "employee_rate_history_merge_report" ADD CONSTRAINT "employeeRateHistoryMergeReport_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "employee_rate_history_merge_report" ADD CONSTRAINT "employeeRateHistoryMergeReport_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "employeeRateHistoryMergeReport_org_employee_idx" ON "employee_rate_history_merge_report" USING btree ("organization_id","employee_id");
--> statement-breakpoint
CREATE TABLE "employee_wage_history_merge_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"merged_on" date NOT NULL,
	"adjusted_count" integer NOT NULL,
	"dismissed_at" timestamp with time zone,
	"dismissed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employeeWageHistoryMergeNote_adjusted_count_check" CHECK ("adjusted_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "employee_wage_history_merge_note" ADD CONSTRAINT "employeeWageHistoryMergeNote_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "employee_wage_history_merge_note" ADD CONSTRAINT "employeeWageHistoryMergeNote_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "employee_wage_history_merge_note" ADD CONSTRAINT "employeeWageHistoryMergeNote_dismissed_by_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "employeeWageHistoryMergeNote_org_employee_idx" ON "employee_wage_history_merge_note" USING btree ("organization_id","employee_id");
--> statement-breakpoint
-- The calendar date a stored terms or rate timestamp stands for (the resolver's
-- termsCalendarDate): exactly 00:00:00 UTC is that UTC date, any other instant its
-- org-local date. Timestamp-without-zone columns pass `column AT TIME ZONE 'UTC'`.
CREATE OR REPLACE FUNCTION "employee_rate_history_merge_calendar_date"(
	p_instant timestamp with time zone,
	p_timezone text
)
RETURNS date
LANGUAGE sql
STABLE
AS $$
	SELECT CASE
		WHEN (p_instant AT TIME ZONE 'UTC')::time = time '00:00' THEN (p_instant AT TIME ZONE 'UTC')::date
		ELSE (p_instant AT TIME ZONE p_timezone)::date
	END
$$;
--> statement-breakpoint
-- The calendar dates an employment period covers, [start, end). An unknown or legacy start
-- covers everything before the end. An end at midnight (UTC or org-local) excludes its date;
-- any other end instant still covers its org-local date.
CREATE OR REPLACE FUNCTION "employee_rate_history_merge_period_dates"(
	p_started_at timestamp with time zone,
	p_ended_at timestamp with time zone,
	p_start_provenance text,
	p_timezone text
)
RETURNS daterange
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
	v_start date;
	v_end date;
BEGIN
	IF p_start_provenance = 'recorded' AND p_started_at IS NOT NULL THEN
		v_start := "employee_rate_history_merge_calendar_date"(p_started_at, p_timezone);
	END IF;
	IF p_ended_at IS NOT NULL THEN
		v_end := CASE
			WHEN (p_ended_at AT TIME ZONE 'UTC')::time = time '00:00' THEN (p_ended_at AT TIME ZONE 'UTC')::date
			WHEN (p_ended_at AT TIME ZONE p_timezone)::time = time '00:00' THEN (p_ended_at AT TIME ZONE p_timezone)::date
			ELSE (p_ended_at AT TIME ZONE p_timezone)::date + 1
		END;
		IF v_start IS NOT NULL AND v_end < v_start THEN
			v_end := v_start;
		END IF;
	END IF;
	RETURN daterange(v_start, v_end, '[)');
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "employee_rate_history_merge_report_row"(
	p_organization_id text,
	p_employee_id uuid,
	p_rate_history_id uuid,
	p_terms_id uuid,
	p_reason text,
	p_winning_value numeric,
	p_evidence jsonb
)
RETURNS void
LANGUAGE sql
AS $$
	INSERT INTO public."employee_rate_history_merge_report"
		("organization_id", "employee_id", "rate_history_id", "terms_id", "reason",
		 "winning_value", "evidence")
	VALUES (p_organization_id, p_employee_id, p_rate_history_id, p_terms_id, p_reason,
		p_winning_value, p_evidence)
	ON CONFLICT ON CONSTRAINT "employeeRateHistoryMergeReport_entry_unique" DO NOTHING
$$;
--> statement-breakpoint
-- Marks the employee's contract work balance dirty from p_from.
CREATE OR REPLACE FUNCTION "employee_rate_history_merge_mark_dirty"(
	p_organization_id text,
	p_employee_id uuid,
	p_from date
)
RETURNS void
LANGUAGE sql
AS $$
	INSERT INTO public."employee_work_balance" AS w (
		"employee_id", "organization_id", "actual_minutes", "required_minutes", "balance_minutes",
		"computed_from_date", "computed_through_date", "computed_at", "is_dirty",
		"dirty_from_date", "refresh_requested_at", "updated_at"
	)
	VALUES (
		p_employee_id, p_organization_id, 0, 0, 0, p_from, p_from, now(), true,
		p_from, now(), now()
	)
	ON CONFLICT ("organization_id", "employee_id") DO UPDATE SET
		"is_dirty" = true,
		"dirty_from_date" = CASE
			WHEN w."is_dirty" AND w."dirty_from_date" IS NULL THEN NULL
			WHEN w."dirty_from_date" IS NULL OR w."dirty_from_date" > EXCLUDED."dirty_from_date"
				THEN EXCLUDED."dirty_from_date"
			ELSE w."dirty_from_date"
		END,
		"refresh_requested_at" = now(),
		"updated_at" = now()
$$;
--> statement-breakpoint
-- The admin note for an employee the merge affected; the first run's count stays.
CREATE OR REPLACE FUNCTION "employee_rate_history_merge_note"(
	p_organization_id text,
	p_employee_id uuid,
	p_timezone text,
	p_adjusted_count integer
)
RETURNS void
LANGUAGE sql
AS $$
	INSERT INTO public."employee_wage_history_merge_note"
		("organization_id", "employee_id", "merged_on", "adjusted_count")
	VALUES (p_organization_id, p_employee_id, (now() AT TIME ZONE p_timezone)::date, p_adjusted_count)
	ON CONFLICT ("organization_id", "employee_id") DO NOTHING
$$;
--> statement-breakpoint
-- Merges one employee's rate history; returns the number of terms rows created or split.
CREATE OR REPLACE FUNCTION "employee_rate_history_merge_employee"(
	p_organization_id text,
	p_employee_id uuid,
	p_timezone text
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
	v_now timestamp := now() AT TIME ZONE 'UTC';
	v_contract_type text;
	v_has_confirmed_terms boolean;
	v_terms_cover datemultirange;
	v_gap datemultirange;
	v_spans daterange[];
	v_wages numeric(10, 2)[];
	v_original_until timestamp;
	v_piece_count integer;
	v_piece_ids uuid[];
	v_piece_id uuid;
	v_acted uuid[] := '{}';
	v_changed integer := 0;
	v_dirty_from date;
	v_terms record;
	v_segment record;
	v_period record;
	v_piece daterange;
BEGIN
	-- The same row lock the terms actions take before changing an employee's terms.
	SELECT e."contract_type"::text INTO v_contract_type
	FROM public."employee" AS e
	WHERE e."id" = p_employee_id AND e."organization_id" = p_organization_id
	FOR UPDATE;
	IF NOT FOUND THEN
		RETURN 0;
	END IF;

	-- An employee without any period gets their legacy period first, as every period reader
	-- does (resolveCurrentEmploymentPeriod); a no-op otherwise.
	PERFORM "employee_employment_period_backfill_legacy"(p_organization_id, p_employee_id);

	SELECT EXISTS (
		SELECT 1 FROM public."employee_employment_history" AS h
		WHERE h."organization_id" = p_organization_id
			AND h."employee_id" = p_employee_id
			AND h."review_state" = 'confirmed'
	) INTO v_has_confirmed_terms;

	-- The employee's rate rows as calendar date spans.
	CREATE TEMP TABLE IF NOT EXISTS "rate_history_merge_rate" (
		"id" uuid,
		"rate" numeric(10, 2),
		"currency" text,
		"created_at" timestamp,
		"created_by" text,
		"effective_from" timestamp,
		"effective_to" timestamp,
		"from_date" date,
		"to_date" date,
		"span" daterange,
		"skip_reason" text
	) ON COMMIT DROP;
	DELETE FROM pg_temp."rate_history_merge_rate";
	INSERT INTO pg_temp."rate_history_merge_rate"
	SELECT
		r."id", r."hourly_rate", r."currency", r."created_at", r."created_by",
		r."effective_from", r."effective_to", d.from_date, d.to_date,
		CASE
			WHEN d.to_date IS NOT NULL AND d.to_date <= d.from_date THEN 'empty'::daterange
			ELSE daterange(d.from_date, d.to_date, '[)')
		END,
		NULL
	FROM public."employee_rate_history" AS r
	CROSS JOIN LATERAL (
		SELECT
			"employee_rate_history_merge_calendar_date"(r."effective_from" AT TIME ZONE 'UTC', p_timezone) AS from_date,
			"employee_rate_history_merge_calendar_date"(r."effective_to" AT TIME ZONE 'UTC', p_timezone) AS to_date
	) AS d
	WHERE r."organization_id" = p_organization_id AND r."employee_id" = p_employee_id;

	-- An employee who is fixed today with no terms: the open row has no end we can trust. Once
	-- skipped, it stays skipped, so terms this merge creates never revive it.
	UPDATE pg_temp."rate_history_merge_rate" AS x
	SET "skip_reason" = 'fixed_without_terms_open_row'
	WHERE x."effective_to" IS NULL
		AND (
			(v_contract_type = 'fixed' AND NOT v_has_confirmed_terms)
			OR EXISTS (
				SELECT 1 FROM public."employee_rate_history_merge_report" AS rp
				WHERE rp."organization_id" = p_organization_id
					AND rp."rate_history_id" = x."id"
					AND rp."reason" = 'fixed_without_terms_open_row'
			)
		);
	PERFORM "employee_rate_history_merge_report_row"(
		p_organization_id, p_employee_id, x."id", NULL, x."skip_reason", NULL,
		jsonb_build_object('hourlyRate', x."rate", 'currency', x."currency",
			'effectiveFrom', x."effective_from", 'effectiveTo', x."effective_to")
	)
	FROM pg_temp."rate_history_merge_rate" AS x
	WHERE x."skip_reason" IS NOT NULL;

	-- The rate in force on each day: the latest-written row covering it.
	CREATE TEMP TABLE IF NOT EXISTS "rate_history_merge_day_winner" (
		"span" daterange,
		"id" uuid,
		"rate" numeric(10, 2),
		"currency" text,
		"created_at" timestamp,
		"created_by" text
	) ON COMMIT DROP;
	DELETE FROM pg_temp."rate_history_merge_day_winner";
	WITH valid AS (
		SELECT * FROM pg_temp."rate_history_merge_rate"
		WHERE "skip_reason" IS NULL AND NOT isempty("span")
	), bounds AS (
		SELECT lower("span") AS d FROM valid
		UNION
		SELECT upper("span") FROM valid WHERE NOT upper_inf("span")
	), elementary AS (
		SELECT daterange(d, lead(d) OVER (ORDER BY d), '[)') AS span FROM bounds
	)
	INSERT INTO pg_temp."rate_history_merge_day_winner"
	SELECT DISTINCT ON (e.span) e.span, v."id", v."rate", v."currency", v."created_at", v."created_by"
	FROM elementary AS e
	JOIN valid AS v ON v."span" @> e.span
	ORDER BY e.span, v."created_at" DESC, v."id" DESC;

	-- Rows that lose a day to another row, or whose span is empty once dated.
	PERFORM "employee_rate_history_merge_report_row"(
		p_organization_id, p_employee_id, x."id", NULL,
		CASE WHEN w."id" IS NULL THEN 'empty_after_rounding' ELSE 'superseded' END,
		w."rate",
		jsonb_build_object('hourlyRate', x."rate", 'currency', x."currency",
			'effectiveFrom', x."effective_from", 'effectiveTo', x."effective_to",
			'winningRateHistoryId', w."id")
	)
	FROM pg_temp."rate_history_merge_rate" AS x
	LEFT JOIN LATERAL (
		SELECT dw.* FROM pg_temp."rate_history_merge_day_winner" AS dw
		WHERE dw."id" <> x."id"
			AND CASE WHEN isempty(x."span") THEN dw."span" @> x."from_date" ELSE dw."span" && x."span" END
		ORDER BY lower(dw."span")
		LIMIT 1
	) AS w ON true
	WHERE x."skip_reason" IS NULL
		AND (isempty(x."span") OR w."id" IS NOT NULL);

	-- Wage segments: consecutive days with the same wage and currency.
	CREATE TEMP TABLE IF NOT EXISTS "rate_history_merge_segment" (
		"span" daterange,
		"rate" numeric(10, 2),
		"currency" text,
		"created_at" timestamp,
		"created_by" text,
		"rate_ids" uuid[]
	) ON COMMIT DROP;
	DELETE FROM pg_temp."rate_history_merge_segment";
	INSERT INTO pg_temp."rate_history_merge_segment"
	SELECT
		range_merge(range_agg(i."span")),
		i."rate",
		i."currency",
		max(i."created_at"),
		(array_agg(i."created_by" ORDER BY i."created_at" DESC, i."id" DESC))[1],
		array_agg(DISTINCT i."id")
	FROM (
		SELECT o.*, sum(
			CASE
				WHEN o.previous_upper = lower(o."span") AND o.previous_rate = o."rate"
					AND o.previous_currency = o."currency" THEN 0
				ELSE 1
			END
		) OVER (ORDER BY lower(o."span")) AS island
		FROM (
			SELECT dw.*,
				lag(upper(dw."span")) OVER (ORDER BY lower(dw."span")) AS previous_upper,
				lag(dw."rate") OVER (ORDER BY lower(dw."span")) AS previous_rate,
				lag(dw."currency") OVER (ORDER BY lower(dw."span")) AS previous_currency
			FROM pg_temp."rate_history_merge_day_winner" AS dw
		) AS o
	) AS i
	GROUP BY i.island, i."rate", i."currency";

	-- Confirmed terms as calendar spans, overlaps resolved like the terms resolver: later-starting
	-- terms win from their first day.
	CREATE TEMP TABLE IF NOT EXISTS "rate_history_merge_terms" (
		"id" uuid,
		"contract_type" text,
		"rate" numeric(10, 2),
		"updated_at" timestamp,
		"span" daterange
	) ON COMMIT DROP;
	DELETE FROM pg_temp."rate_history_merge_terms";
	INSERT INTO pg_temp."rate_history_merge_terms"
	SELECT n."id", n."contract_type", n."hourly_rate", n."updated_at", daterange(n.from_date, n.until_date, '[)')
	FROM (
		SELECT o."id", o."contract_type", o."hourly_rate", o."updated_at", o.from_date,
			CASE
				WHEN o.next_from IS NULL THEN o.until_date
				WHEN o.until_date IS NULL THEN o.next_from
				ELSE LEAST(o.until_date, o.next_from)
			END AS until_date
		FROM (
			SELECT h."id", h."contract_type"::text AS "contract_type", h."hourly_rate", h."updated_at",
				d.from_date, d.until_date,
				lead(d.from_date) OVER (
					ORDER BY d.from_date, h."valid_from", h."created_at", h."id"
				) AS next_from
			FROM public."employee_employment_history" AS h
			CROSS JOIN LATERAL (
				SELECT
					"employee_rate_history_merge_calendar_date"(h."valid_from" AT TIME ZONE 'UTC', p_timezone) AS from_date,
					"employee_rate_history_merge_calendar_date"(h."valid_until" AT TIME ZONE 'UTC', p_timezone) AS until_date
			) AS d
			WHERE h."organization_id" = p_organization_id
				AND h."employee_id" = p_employee_id
				AND h."review_state" = 'confirmed'
		) AS o
	) AS n
	WHERE n.until_date IS NULL OR n.until_date > n.from_date;

	SELECT range_agg(t."span") INTO v_terms_cover FROM pg_temp."rate_history_merge_terms" AS t;

	-- Hourly terms: split at each wage change.
	FOR v_terms IN
		SELECT t.* FROM pg_temp."rate_history_merge_terms" AS t
		WHERE t."contract_type" = 'hourly'
			AND EXISTS (
				SELECT 1 FROM pg_temp."rate_history_merge_segment" AS s WHERE s."span" && t."span"
			)
		ORDER BY lower(t."span")
	LOOP
		WITH parts AS (
			SELECT s."span" * v_terms."span" AS span,
				CASE
					WHEN v_terms."rate" IS NULL OR s."rate" = v_terms."rate"
						OR v_terms."updated_at" < s."created_at" THEN s."rate"
					ELSE v_terms."rate"
				END AS wage
			FROM pg_temp."rate_history_merge_segment" AS s
			WHERE s."span" && v_terms."span"
			UNION ALL
			SELECT rest, v_terms."rate"
			FROM unnest(
				datemultirange(v_terms."span") - (
					SELECT range_agg(s."span") FROM pg_temp."rate_history_merge_segment" AS s
					WHERE s."span" && v_terms."span"
				)
			) AS rest
		), ordered AS (
			SELECT p.span, p.wage,
				lag(upper(p.span)) OVER (ORDER BY lower(p.span)) AS previous_upper,
				lag(p.wage) OVER (ORDER BY lower(p.span)) AS previous_wage
			FROM parts AS p
		), islands AS (
			SELECT o.span, o.wage, sum(
				CASE
					WHEN o.previous_upper = lower(o.span) AND o.previous_wage IS NOT DISTINCT FROM o.wage THEN 0
					ELSE 1
				END
			) OVER (ORDER BY lower(o.span)) AS island
			FROM ordered AS o
		), pieces AS (
			SELECT range_merge(range_agg(i.span)) AS span, i.wage
			FROM islands AS i
			GROUP BY i.island, i.wage
		)
		SELECT array_agg(pc.span ORDER BY lower(pc.span)), array_agg(pc.wage ORDER BY lower(pc.span))
		INTO v_spans, v_wages
		FROM pieces AS pc;

		v_piece_count := coalesce(array_length(v_spans, 1), 0);
		v_piece_ids := ARRAY[v_terms."id"];
		IF v_piece_count = 0
			OR (v_piece_count = 1 AND v_wages[1] IS NOT DISTINCT FROM v_terms."rate") THEN
			-- Nothing to change: the terms keep their span and wage.
			v_spans := ARRAY[v_terms."span"];
		ELSE
			SELECT h."valid_until" INTO v_original_until
			FROM public."employee_employment_history" AS h
			WHERE h."id" = v_terms."id" AND h."organization_id" = p_organization_id;

			FOR i IN 1..v_piece_count LOOP
				IF v_wages[i] IS DISTINCT FROM v_terms."rate" THEN
					v_dirty_from := LEAST(v_dirty_from, lower(v_spans[i]));
				END IF;
				IF i = 1 THEN
					UPDATE public."employee_employment_history" AS h
					SET "valid_until" = CASE WHEN v_piece_count = 1 THEN v_original_until ELSE upper(v_spans[1])::timestamp END,
						"hourly_rate" = v_wages[1],
						"updated_at" = v_now
					WHERE h."id" = v_terms."id" AND h."organization_id" = p_organization_id;
				ELSE
					INSERT INTO public."employee_employment_history" (
						"employee_id", "organization_id", "employment_period_id", "valid_from", "valid_until",
						"status", "contract_type", "weekly_contract_minutes", "probation_starts_on",
						"probation_ends_on", "work_model", "work_policy_id", "hourly_rate", "currency",
						"change_reason", "review_state", "created_by", "created_at", "updated_by", "updated_at"
					)
					SELECT
						h."employee_id", h."organization_id", h."employment_period_id",
						lower(v_spans[i])::timestamp,
						CASE WHEN i = v_piece_count THEN v_original_until ELSE upper(v_spans[i])::timestamp END,
						h."status", h."contract_type", h."weekly_contract_minutes", h."probation_starts_on",
						h."probation_ends_on", h."work_model", h."work_policy_id", v_wages[i], h."currency",
						h."change_reason", h."review_state", h."created_by", v_now, h."updated_by", v_now
					FROM public."employee_employment_history" AS h
					WHERE h."id" = v_terms."id" AND h."organization_id" = p_organization_id
					RETURNING "id" INTO v_piece_id;
					v_piece_ids := v_piece_ids || v_piece_id;
				END IF;
				v_changed := v_changed + 1;
			END LOOP;
		END IF;

		-- Every rate row whose wage differs from the terms: applied, kept, or filling in a missing
		-- wage.
		v_acted := v_acted || ARRAY(
			SELECT rate_id
			FROM pg_temp."rate_history_merge_segment" AS s
			CROSS JOIN LATERAL unnest(s."rate_ids") AS rate_id
			WHERE s."span" && v_terms."span" AND s."rate" IS DISTINCT FROM v_terms."rate"
		);

		-- Each conflict once per rate row and terms, naming the terms that carry its dates after
		-- the split, so a re-run finds every conflict it would report already recorded.
		PERFORM "employee_rate_history_merge_report_row"(
			p_organization_id, p_employee_id, rate_id,
			(
				SELECT v_piece_ids[k] FROM generate_subscripts(v_spans, 1) AS k
				WHERE v_spans[k] @> lower(s."span" * v_terms."span")
			),
			CASE WHEN v_terms."updated_at" >= s."created_at" THEN 'terms_wage_kept' ELSE 'rate_wage_applied' END,
			CASE WHEN v_terms."updated_at" >= s."created_at" THEN v_terms."rate" ELSE s."rate" END,
			jsonb_build_object('rateWage', s."rate", 'rateCurrency', s."currency",
				'rateCreatedAt', s."created_at", 'termsWage', v_terms."rate",
				'termsUpdatedAt', v_terms."updated_at",
				'from', lower(s."span" * v_terms."span"), 'until', upper(s."span" * v_terms."span"))
		)
		FROM pg_temp."rate_history_merge_segment" AS s
		CROSS JOIN LATERAL unnest(s."rate_ids") AS rate_id
		WHERE s."span" && v_terms."span"
			AND v_terms."rate" IS NOT NULL
			AND s."rate" <> v_terms."rate";
	END LOOP;

	-- Fixed terms: the rate rows under them are ignored.
	PERFORM "employee_rate_history_merge_report_row"(
		p_organization_id, p_employee_id, rate_id, t."id", 'covered_by_fixed_terms', NULL,
		jsonb_build_object('rateWage', s."rate", 'rateCurrency', s."currency",
			'from', lower(s."span" * t."span"), 'until', upper(s."span" * t."span"))
	)
	FROM pg_temp."rate_history_merge_segment" AS s
	JOIN pg_temp."rate_history_merge_terms" AS t ON t."contract_type" = 'fixed' AND t."span" && s."span"
	CROSS JOIN LATERAL unnest(s."rate_ids") AS rate_id;

	-- No confirmed terms: new confirmed hourly terms in the employment period covering each day.
	FOR v_segment IN
		SELECT s.* FROM pg_temp."rate_history_merge_segment" AS s ORDER BY lower(s."span")
	LOOP
		v_gap := datemultirange(v_segment."span") - coalesce(v_terms_cover, '{}'::datemultirange);
		CONTINUE WHEN isempty(v_gap);

		FOR v_period IN
			SELECT p."id", "employee_rate_history_merge_period_dates"(
				p."started_at", p."ended_at", p."start_provenance", p_timezone
			) AS dates
			FROM public."employee_employment_period" AS p
			WHERE p."organization_id" = p_organization_id AND p."employee_id" = p_employee_id
			ORDER BY lower("employee_rate_history_merge_period_dates"(
				p."started_at", p."ended_at", p."start_provenance", p_timezone
			)) NULLS FIRST, p."id"
		LOOP
			FOR v_piece IN SELECT unnest(v_gap * datemultirange(v_period.dates)) LOOP
				INSERT INTO public."employee_employment_history" (
					"employee_id", "organization_id", "employment_period_id", "valid_from", "valid_until",
					"status", "contract_type", "weekly_contract_minutes", "work_model", "work_policy_id",
					"hourly_rate", "currency", "change_reason", "review_state", "created_by",
					"created_at", "updated_at"
				)
				VALUES (
					p_employee_id, p_organization_id, v_period."id", lower(v_piece)::timestamp,
					upper(v_piece)::timestamp, 'active', 'hourly', 2400, 'onsite', NULL,
					v_segment."rate", v_segment."currency", 'Migrated from rate history', 'confirmed',
					v_segment."created_by", v_now, v_now
				);
				v_changed := v_changed + 1;
				v_dirty_from := LEAST(v_dirty_from, lower(v_piece));
				v_acted := v_acted || v_segment."rate_ids";
			END LOOP;
			v_gap := v_gap - datemultirange(v_period.dates);
		END LOOP;

		IF NOT isempty(v_gap) THEN
			PERFORM "employee_rate_history_merge_report_row"(
				p_organization_id, p_employee_id, rate_id, NULL, 'no_employment_period', NULL,
				jsonb_build_object('rateWage', v_segment."rate", 'rateCurrency', v_segment."currency",
					'uncoveredDates', v_gap::text)
			)
			FROM unnest(v_segment."rate_ids") AS rate_id;
		END IF;
	END LOOP;

	IF v_dirty_from IS NOT NULL THEN
		PERFORM "employee_rate_history_merge_mark_dirty"(p_organization_id, p_employee_id, v_dirty_from);
	END IF;

	-- The note counts every rate row the merge acted on: rows that created or split terms,
	-- conflicted, or were skipped or ignored (all of the latter are reported).
	v_acted := v_acted || ARRAY(
		SELECT rp."rate_history_id"
		FROM public."employee_rate_history_merge_report" AS rp
		WHERE rp."organization_id" = p_organization_id AND rp."employee_id" = p_employee_id
			AND rp."rate_history_id" IS NOT NULL
	);
	IF cardinality(v_acted) > 0 THEN
		PERFORM "employee_rate_history_merge_note"(
			p_organization_id, p_employee_id, p_timezone,
			(SELECT count(DISTINCT acted)::integer FROM unnest(v_acted) AS acted)
		);
	END IF;

	RETURN v_changed;
END;
$$;
--> statement-breakpoint
-- D9: an hourly employee whose wage lives only on employee.current_hourly_rate (no confirmed terms
-- and no rate rows) gets confirmed hourly terms with that wage from the start of their latest
-- employment period, or their start date, and the terms form's defaults. Without a known start the
-- employee is reported instead. Returns the number of terms rows created. The column is read
-- through to_jsonb, so once 0218 has dropped it this finds no wage and does nothing.
CREATE OR REPLACE FUNCTION "employee_rate_history_merge_employee_wage"(
	p_organization_id text,
	p_employee_id uuid,
	p_timezone text
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
	v_now timestamp := now() AT TIME ZONE 'UTC';
	v_wage numeric(10, 2);
	v_user_id text;
	v_start_date timestamp;
	v_period record;
	v_valid_from timestamp;
	v_valid_until timestamp;
	v_terms_id uuid;
	v_evidence jsonb;
BEGIN
	-- The same row lock the terms actions take before changing an employee's terms.
	SELECT (to_jsonb(e) ->> 'current_hourly_rate')::numeric(10, 2), e."user_id", e."start_date"
	INTO v_wage, v_user_id, v_start_date
	FROM public."employee" AS e
	WHERE e."id" = p_employee_id
		AND e."organization_id" = p_organization_id
		AND e."contract_type" = 'hourly'
	FOR UPDATE;
	IF NOT FOUND OR v_wage IS NULL
		OR EXISTS (
			SELECT 1 FROM public."employee_employment_history" AS h
			WHERE h."organization_id" = p_organization_id
				AND h."employee_id" = p_employee_id
				AND h."review_state" = 'confirmed'
		)
		OR EXISTS (
			SELECT 1 FROM public."employee_rate_history" AS r
			WHERE r."organization_id" = p_organization_id AND r."employee_id" = p_employee_id
		)
	THEN
		RETURN 0;
	END IF;

	PERFORM "employee_employment_period_backfill_legacy"(p_organization_id, p_employee_id);

	SELECT p."id", p."started_at", p."ended_at" INTO v_period
	FROM public."employee_employment_period" AS p
	WHERE p."organization_id" = p_organization_id AND p."employee_id" = p_employee_id
	ORDER BY (p."status" = 'open') DESC, p."started_at" DESC NULLS LAST, p."created_at" DESC, p."id"
	LIMIT 1;

	v_valid_from := coalesce(v_period."started_at" AT TIME ZONE 'UTC', v_start_date);
	v_valid_until := v_period."ended_at" AT TIME ZONE 'UTC';
	v_evidence := jsonb_build_object('hourlyRate', v_wage, 'source', 'employee.current_hourly_rate',
		'from', v_valid_from, 'until', v_valid_until);

	IF v_period."id" IS NULL OR v_valid_from IS NULL OR v_valid_until <= v_valid_from THEN
		PERFORM "employee_rate_history_merge_report_row"(
			p_organization_id, p_employee_id, NULL, NULL, 'no_employment_period', NULL, v_evidence
		);
		PERFORM "employee_rate_history_merge_note"(p_organization_id, p_employee_id, p_timezone, 1);
		RETURN 0;
	END IF;

	-- Nobody recorded who set the stored wage: the terms name the employee's own user.
	INSERT INTO public."employee_employment_history" (
		"employee_id", "organization_id", "employment_period_id", "valid_from", "valid_until",
		"status", "contract_type", "weekly_contract_minutes", "work_model", "work_policy_id",
		"hourly_rate", "currency", "change_reason", "review_state", "created_by",
		"created_at", "updated_at"
	)
	VALUES (
		p_employee_id, p_organization_id, v_period."id", v_valid_from, v_valid_until,
		'active', 'hourly', 2400, 'onsite', NULL, v_wage, 'EUR', 'Migrated from employee wage',
		'confirmed', v_user_id, v_now, v_now
	)
	RETURNING "id" INTO v_terms_id;

	PERFORM "employee_rate_history_merge_report_row"(
		p_organization_id, p_employee_id, NULL, v_terms_id, 'employee_wage_migrated', v_wage, v_evidence
	);
	PERFORM "employee_rate_history_merge_mark_dirty"(
		p_organization_id, p_employee_id,
		"employee_rate_history_merge_calendar_date"(v_valid_from AT TIME ZONE 'UTC', p_timezone)
	);
	PERFORM "employee_rate_history_merge_note"(p_organization_id, p_employee_id, p_timezone, 1);
	RETURN 1;
END;
$$;
--> statement-breakpoint
-- Merges the rate history and the stored employee wages of one organization, or of every
-- organization when called with NULL. Returns the number of terms rows created or split.
-- Idempotent.
CREATE OR REPLACE FUNCTION "employee_rate_history_merge_into_terms"(
	p_organization_id text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
	v_organization record;
	v_employee record;
	v_changed integer := 0;
BEGIN
	FOR v_organization IN
		SELECT o."id",
			CASE
				WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names AS tz WHERE tz."name" = o."timezone")
					THEN o."timezone"
				ELSE 'UTC'
			END AS timezone
		FROM public."organization" AS o
		WHERE p_organization_id IS NULL OR o."id" = p_organization_id
		ORDER BY o."id"
	LOOP
		FOR v_employee IN
			SELECT DISTINCT r."employee_id"
			FROM public."employee_rate_history" AS r
			WHERE r."organization_id" = v_organization."id"
			ORDER BY r."employee_id"
		LOOP
			v_changed := v_changed + "employee_rate_history_merge_employee"(
				v_organization."id", v_employee."employee_id", v_organization.timezone
			);
		END LOOP;

		FOR v_employee IN
			SELECT e."id" AS "employee_id"
			FROM public."employee" AS e
			WHERE e."organization_id" = v_organization."id"
				AND e."contract_type" = 'hourly'
				AND to_jsonb(e) ->> 'current_hourly_rate' IS NOT NULL
			ORDER BY e."id"
		LOOP
			v_changed := v_changed + "employee_rate_history_merge_employee_wage"(
				v_organization."id", v_employee."employee_id", v_organization.timezone
			);
		END LOOP;
	END LOOP;
	RETURN v_changed;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE
	v_changed integer;
BEGIN
	v_changed := "employee_rate_history_merge_into_terms"(NULL);
	IF v_changed > 0 THEN
		RAISE WARNING 'Rate history merge (#1176): % employment terms rows created or split from rate history and stored employee wages; see employee_rate_history_merge_report', v_changed;
	END IF;
END;
$$;
