-- Skills & Qualifications Feature
-- Enables tracking of employee certifications and skills, with requirements on subareas and shift templates

-- Create skill category enum
DO $$ BEGIN
    CREATE TYPE skill_category AS ENUM ('safety', 'equipment', 'certification', 'training', 'language', 'custom');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Skills catalog table (organization-level)
CREATE TABLE IF NOT EXISTS skill (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    category skill_category NOT NULL,
    custom_category_name TEXT,
    requires_expiry BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_by TEXT NOT NULL REFERENCES "user"(id),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_by TEXT REFERENCES "user"(id)
);

CREATE INDEX IF NOT EXISTS skill_organization_id_idx ON skill(organization_id);
CREATE INDEX IF NOT EXISTS skill_category_idx ON skill(category);
CREATE INDEX IF NOT EXISTS skill_is_active_idx ON skill(is_active);
CREATE UNIQUE INDEX IF NOT EXISTS skill_org_name_idx ON skill(organization_id, name);

-- Employee skill assignments (junction table)
CREATE TABLE IF NOT EXISTS employee_skill (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
    expires_at TIMESTAMP,
    notes TEXT,
    assigned_by TEXT NOT NULL REFERENCES "user"(id),
    assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS employee_skill_employee_id_idx ON employee_skill(employee_id);
CREATE INDEX IF NOT EXISTS employee_skill_skill_id_idx ON employee_skill(skill_id);
CREATE INDEX IF NOT EXISTS employee_skill_expires_at_idx ON employee_skill(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS employee_skill_unique_idx ON employee_skill(employee_id, skill_id);

-- Subarea skill requirements
CREATE TABLE IF NOT EXISTS subarea_skill_requirement (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subarea_id UUID NOT NULL REFERENCES location_subarea(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
    is_required BOOLEAN NOT NULL DEFAULT true,
    created_by TEXT NOT NULL REFERENCES "user"(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS subarea_skill_req_subarea_id_idx ON subarea_skill_requirement(subarea_id);
CREATE INDEX IF NOT EXISTS subarea_skill_req_skill_id_idx ON subarea_skill_requirement(skill_id);
CREATE UNIQUE INDEX IF NOT EXISTS subarea_skill_req_unique_idx ON subarea_skill_requirement(subarea_id, skill_id);

-- Shift template skill requirements
CREATE TABLE IF NOT EXISTS shift_template_skill_requirement (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES shift_template(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
    is_required BOOLEAN NOT NULL DEFAULT true,
    created_by TEXT NOT NULL REFERENCES "user"(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS shift_template_skill_req_template_id_idx ON shift_template_skill_requirement(template_id);
CREATE INDEX IF NOT EXISTS shift_template_skill_req_skill_id_idx ON shift_template_skill_requirement(skill_id);
CREATE UNIQUE INDEX IF NOT EXISTS shift_template_skill_req_unique_idx ON shift_template_skill_requirement(template_id, skill_id);

-- Skill requirement override log (audit trail for when managers override)
CREATE TABLE IF NOT EXISTS skill_requirement_override (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    shift_id UUID NOT NULL REFERENCES shift(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    missing_skill_ids TEXT NOT NULL, -- JSON array of skill IDs
    override_reason TEXT NOT NULL,
    overridden_by TEXT NOT NULL REFERENCES "user"(id),
    overridden_at TIMESTAMP NOT NULL DEFAULT NOW(),
    notification_sent BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS skill_override_organization_id_idx ON skill_requirement_override(organization_id);
CREATE INDEX IF NOT EXISTS skill_override_shift_id_idx ON skill_requirement_override(shift_id);
CREATE INDEX IF NOT EXISTS skill_override_employee_id_idx ON skill_requirement_override(employee_id);
CREATE INDEX IF NOT EXISTS skill_override_overridden_by_idx ON skill_requirement_override(overridden_by);
