-- Backfill pending absence approvals that were left without approval_request rows.
-- This is intentionally conservative: rows without an active eligible manager remain pending for manual repair.
WITH orphaned_absences AS (
	SELECT
		absence_entry.id,
		absence_entry.organization_id,
		absence_entry.employee_id,
		absence_entry.canonical_record_id,
		absence_entry.created_at
	FROM "absence_entry" AS absence_entry
	INNER JOIN "absence_category" AS absence_category
		ON absence_category.id = absence_entry.category_id
		AND absence_category.organization_id = absence_entry.organization_id
	WHERE absence_entry.status = 'pending'
		AND absence_entry.organization_id IS NOT NULL
		AND absence_category.requires_approval = true
		AND NOT EXISTS (
			SELECT 1
			FROM "approval_request" AS existing_approval
			WHERE existing_approval.organization_id = absence_entry.organization_id
				AND existing_approval.entity_type = 'absence_entry'
				AND existing_approval.entity_id = absence_entry.id
				AND existing_approval.status = 'pending'
		)
), eligible_managers AS (
	SELECT
		orphaned_absences.id AS absence_id,
		manager_link.manager_id,
		CASE WHEN manager_link.is_primary THEN 0 ELSE 1 END AS source_rank
	FROM orphaned_absences
	INNER JOIN "employee_managers" AS manager_link
		ON manager_link.employee_id = orphaned_absences.employee_id
	INNER JOIN "employee" AS manager_employee
		ON manager_employee.id = manager_link.manager_id
		AND manager_employee.organization_id = orphaned_absences.organization_id
		AND manager_employee.is_active = true
		AND manager_employee.role IN ('manager', 'admin')

	UNION ALL

	SELECT
		orphaned_absences.id AS absence_id,
		team.primary_manager_id AS manager_id,
		2 AS source_rank
	FROM orphaned_absences
	INNER JOIN "team_membership" AS membership
		ON membership.employee_id = orphaned_absences.employee_id
		AND membership.organization_id = orphaned_absences.organization_id
	INNER JOIN "team" AS team
		ON team.id = membership.team_id
		AND team.organization_id = orphaned_absences.organization_id
	INNER JOIN "employee" AS manager_employee
		ON manager_employee.id = team.primary_manager_id
		AND manager_employee.organization_id = orphaned_absences.organization_id
		AND manager_employee.is_active = true
		AND manager_employee.role IN ('manager', 'admin')
	WHERE team.primary_manager_id IS NOT NULL
), ranked_managers AS (
	SELECT
		eligible_managers.absence_id,
		eligible_managers.manager_id,
		ROW_NUMBER() OVER (
			PARTITION BY eligible_managers.absence_id
			ORDER BY eligible_managers.source_rank, eligible_managers.manager_id
		) AS manager_rank
	FROM eligible_managers
)
INSERT INTO "approval_request" (
	"organization_id",
	"entity_type",
	"entity_id",
	"canonical_record_id",
	"requested_by",
	"approver_id",
	"status",
	"created_at",
	"updated_at"
)
SELECT
	orphaned_absences.organization_id,
	'absence_entry',
	orphaned_absences.id,
	orphaned_absences.canonical_record_id,
	orphaned_absences.employee_id,
	ranked_managers.manager_id,
	'pending',
	orphaned_absences.created_at,
	NOW()
FROM orphaned_absences
INNER JOIN ranked_managers
	ON ranked_managers.absence_id = orphaned_absences.id
	AND ranked_managers.manager_rank = 1
ON CONFLICT DO NOTHING;
