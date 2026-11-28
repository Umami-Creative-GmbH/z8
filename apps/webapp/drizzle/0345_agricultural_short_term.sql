CREATE TABLE IF NOT EXISTS agricultural_declaration (
 organization_id text NOT NULL,
 employee_id uuid NOT NULL,
 period_id uuid NOT NULL,
 effective_from date NOT NULL,
 establishment_number text NOT NULL,
 eligible boolean NOT NULL,
 CONSTRAINT agricultural_declaration_number CHECK (establishment_number ~ '^[0-9]{8}$'),
 CONSTRAINT agricultural_declaration_period_fk FOREIGN KEY (period_id, organization_id, employee_id)
 REFERENCES employee_employment_period(id, organization_id, employee_id) ON DELETE CASCADE,
 CONSTRAINT agricultural_declaration_date UNIQUE (period_id, effective_from)
);
--> statement-breakpoint
SELECT set_config('z8.statutory_baseline_maintenance', 'on', true);
--> statement-breakpoint
INSERT INTO statutory_threshold (country_code, threshold_key, effective_from_date, integer_value, unit, legal_reference)
VALUES
 ('DE', 'de_short_term_agricultural_work_days', '2026-01-01', 90, 'days', '§ 8 Abs. 1 Nr. 2 SGB IV'),
 ('DE', 'de_short_term_agricultural_weeks', '2026-01-01', 15, 'weeks', '§ 8 Abs. 1 Nr. 2 SGB IV'),
 ('DE', 'de_short_term_agricultural_calendar_days', '2026-01-01', 105, 'days', '§ 8 Abs. 1 Nr. 2 SGB IV')
ON CONFLICT DO NOTHING;
