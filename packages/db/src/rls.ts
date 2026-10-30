/**
 * RLS Policies — Corrected (2026-10-30 stress test)
 *
 * Three critical bugs fixed:
 * C1: tenant_isolation is now RESTRICTIVE (always AND'd with permissive policies)
 * C2: lore_break_glass_allows is SECURITY DEFINER (reads break_glass_grants bypassing RLS)
 * C3: scope_isolation checks project membership for project-scoped rows
 *
 * Apply order: role → function → function grants → RLS enable → policies → table grants.
 * CREATE POLICY validates function existence, so the function must be created
 * before scope_isolation; GRANT EXECUTE TO lore_app requires the role to exist.
 */

export const rlsUp = /* sql */ `
-- Runtime DB role: NOT superuser, NO BYPASSRLS
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lore_app') THEN
    CREATE ROLE lore_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

-- C2 FIX: SECURITY DEFINER function owned by superuser, reads break_glass_grants bypassing RLS
CREATE FUNCTION lore_break_glass_allows(p_target uuid) RETURNS bool
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp AS
$$ SELECT EXISTS (
     SELECT 1 FROM break_glass_grants
     WHERE target_user_id = p_target
       AND expires_at > now()
       AND revoked_at IS NULL
   ) $$;

REVOKE EXECUTE ON FUNCTION lore_break_glass_allows(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lore_break_glass_allows(uuid) TO lore_app;

-- Enable RLS on assertions
ALTER TABLE assertions ENABLE ROW LEVEL SECURITY;
ALTER TABLE assertions FORCE ROW LEVEL SECURITY;

-- C1 FIX: RESTRICTIVE policy always AND'd with permissive policies (fixes OR-combination leak)
CREATE POLICY tenant_isolation ON assertions
  AS RESTRICTIVE
  USING (org_id = current_setting('lore.org_id')::uuid);

-- C3 FIX: Permissive scope-aware visibility (project rows require membership)
CREATE POLICY scope_isolation ON assertions
  USING (
    (scope = 'personal' AND owner_user_id = current_setting('lore.user_id')::uuid)
    OR (scope = 'project' AND project_id IN (
          SELECT project_id FROM project_members
          WHERE user_id = current_setting('lore.user_id')::uuid))
    OR (scope = 'org')
    OR lore_break_glass_allows(owner_user_id)
  );

GRANT USAGE ON SCHEMA public TO lore_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lore_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lore_app;
`;

export const rlsDown = /* sql */ `
DROP POLICY IF EXISTS scope_isolation ON assertions;
DROP POLICY IF EXISTS tenant_isolation ON assertions;
DROP FUNCTION IF EXISTS lore_break_glass_allows(uuid);
ALTER TABLE assertions DISABLE ROW LEVEL SECURITY;
`;
