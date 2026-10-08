-- Retire the TravelExpenseFinance custom-role permission (#748, ADR 0001):
-- expense officer grants (0137) become the only way to give finance access to
-- someone who is not an owner or admin. Every active employee holding an active
-- custom role that grants any TravelExpenseFinance action becomes an all-scope
-- expense officer: "export" grants canExport, "settle" canRecordReimbursements,
-- and reading is always included. An existing active grant keeps its id and
-- gains the role's capabilities; it is widened to all employees, since the role
-- read every approved report. Each grant written here is audited like one saved
-- in the app, attributed to whoever first assigned the holder a finance role.
-- Holders without an active employee record in the role's organization get no
-- grant and are reported as warnings. Then the stored permissions are deleted.
DO $$
DECLARE
	holder record;
	current_grant record;
	current_values json;
	next_can_export boolean;
	next_can_record_reimbursements boolean;
	audit_action text;
	migrated_grant_id uuid;
BEGIN
	FOR holder IN
		SELECT
			cr.organization_id,
			ecr.employee_id,
			bool_or(crp.action = 'export') AS can_export,
			bool_or(crp.action = 'settle') AS can_record_reimbursements,
			(array_agg(ecr.assigned_by ORDER BY ecr.assigned_at, ecr.id))[1] AS assigned_by,
			array_agg(DISTINCT cr.id::text ORDER BY cr.id::text) AS custom_role_ids,
			bool_or(e.id IS NOT NULL) AS in_organization,
			coalesce(bool_or(e.is_active), false) AS is_active
		FROM custom_role_permission crp
		JOIN custom_role cr ON cr.id = crp.custom_role_id AND cr.is_active
		JOIN employee_custom_role ecr ON ecr.custom_role_id = cr.id
		LEFT JOIN employee e ON e.id = ecr.employee_id AND e.organization_id = cr.organization_id
		WHERE crp.subject = 'TravelExpenseFinance'
		GROUP BY cr.organization_id, ecr.employee_id
		ORDER BY cr.organization_id, ecr.employee_id
	LOOP
		IF NOT holder.in_organization THEN
			RAISE WARNING '0138: employee % holds a TravelExpenseFinance custom role of organization % but has no employee record there; no expense officer grant was created',
				holder.employee_id, holder.organization_id;
			CONTINUE;
		END IF;
		IF NOT holder.is_active THEN
			RAISE WARNING '0138: employee % holds a TravelExpenseFinance custom role of organization % but is not active; no expense officer grant was created',
				holder.employee_id, holder.organization_id;
			CONTINUE;
		END IF;

		SELECT g.id, g.scope, g.can_export, g.can_record_reimbursements
		INTO current_grant
		FROM expense_officer_grant g
		WHERE g.organization_id = holder.organization_id
			AND g.officer_employee_id = holder.employee_id
			AND g.is_active
		FOR UPDATE;

		IF FOUND THEN
			next_can_export := current_grant.can_export OR holder.can_export;
			next_can_record_reimbursements :=
				current_grant.can_record_reimbursements OR holder.can_record_reimbursements;
			IF current_grant.scope = 'all'
				AND next_can_export = current_grant.can_export
				AND next_can_record_reimbursements = current_grant.can_record_reimbursements
			THEN
				CONTINUE;
			END IF;

			current_values := json_build_object(
				'scope', current_grant.scope,
				'teamIds', coalesce(
					(SELECT json_agg(t.team_id ORDER BY t.team_id::text COLLATE "C")
					 FROM expense_officer_team t WHERE t.grant_id = current_grant.id),
					'[]'::json
				),
				'employeeIds', coalesce(
					(SELECT json_agg(oe.employee_id ORDER BY oe.employee_id::text COLLATE "C")
					 FROM expense_officer_employee oe WHERE oe.grant_id = current_grant.id),
					'[]'::json
				),
				'canExport', current_grant.can_export,
				'canRecordReimbursements', current_grant.can_record_reimbursements
			);
			migrated_grant_id := current_grant.id;
			audit_action := 'expense_officer.grant_changed';

			UPDATE expense_officer_grant
			SET scope = 'all',
				can_export = next_can_export,
				can_record_reimbursements = next_can_record_reimbursements,
				updated_by = holder.assigned_by,
				updated_at = now()
			WHERE id = migrated_grant_id;
			DELETE FROM expense_officer_team WHERE grant_id = migrated_grant_id;
			DELETE FROM expense_officer_employee WHERE grant_id = migrated_grant_id;
		ELSE
			next_can_export := holder.can_export;
			next_can_record_reimbursements := holder.can_record_reimbursements;
			current_values := NULL;
			audit_action := 'expense_officer.grant_created';

			INSERT INTO expense_officer_grant (
				organization_id, officer_employee_id, scope, can_export,
				can_record_reimbursements, created_by, updated_by
			)
			VALUES (
				holder.organization_id, holder.employee_id, 'all', next_can_export,
				next_can_record_reimbursements, holder.assigned_by, holder.assigned_by
			)
			RETURNING id INTO migrated_grant_id;
		END IF;

		INSERT INTO audit_log (
			organization_id, entity_type, entity_id, action, performed_by, employee_id, changes, metadata
		)
		VALUES (
			holder.organization_id, 'expense_officer_grant', migrated_grant_id, audit_action,
			holder.assigned_by, holder.employee_id,
			json_build_object(
				'from', current_values,
				'to', json_build_object(
					'scope', 'all',
					'teamIds', '[]'::json,
					'employeeIds', '[]'::json,
					'canExport', next_can_export,
					'canRecordReimbursements', next_can_record_reimbursements
				)
			)::text,
			json_build_object('migration', '0138', 'customRoleIds', to_json(holder.custom_role_ids))::text
		);
	END LOOP;
END $$;
--> statement-breakpoint
DELETE FROM "custom_role_permission" WHERE "subject" = 'TravelExpenseFinance';
