-- =============================================================================
-- 0075_retire_owner_wildcard
--
-- Operators created through POST /admin/tenants had an 'owner' role holding
-- the '*' wildcard. '*' satisfies every permission check, including the
-- platform's own (see the platform-boundary e2e test); new operators get a
-- tenant copy of the platform 'operator_admin' template instead — every
-- operator permission, nothing of the platform's. This moves existing owners
-- the same way:
--   1. every tenant with an 'owner' role gets its own 'operator_admin' role
--      (cloned from the platform template, permissions included) unless it
--      already has one;
--   2. every holder of the tenant 'owner' role is granted that role;
--   3. the tenant 'owner' roles, and the unused platform 'owner' template,
--      are retired (grants removed, soft-deleted).
-- =============================================================================

-- migrate:up
DO $$
DECLARE
  v_template uuid;
  v_owner    record;
  v_admin    uuid;
BEGIN
  SELECT id INTO v_template FROM roles
   WHERE tenant_id IS NULL AND code = 'operator_admin' AND deleted_at IS NULL;

  FOR v_owner IN
    SELECT id, tenant_id FROM roles
     WHERE code = 'owner' AND tenant_id IS NOT NULL AND deleted_at IS NULL
  LOOP
    IF v_template IS NULL THEN
      RAISE EXCEPTION 'Platform role template ''operator_admin'' is missing — run db/seeds/roles.seed.sql first';
    END IF;

    SELECT id INTO v_admin FROM roles
     WHERE tenant_id = v_owner.tenant_id AND code = 'operator_admin' AND deleted_at IS NULL;
    IF v_admin IS NULL THEN
      v_admin := uuid_generate_v7();
      INSERT INTO roles (id, tenant_id, code, name, description, is_system)
      SELECT v_admin, v_owner.tenant_id, code, name, description, true
        FROM roles WHERE id = v_template;
      INSERT INTO role_permissions (role_id, permission)
      SELECT v_admin, permission FROM role_permissions WHERE role_id = v_template;
    END IF;

    INSERT INTO user_roles (user_id, role_id, granted_by, expires_at)
    SELECT user_id, v_admin, granted_by, expires_at FROM user_roles WHERE role_id = v_owner.id
    ON CONFLICT DO NOTHING;

    DELETE FROM user_roles WHERE role_id = v_owner.id;
    UPDATE roles SET deleted_at = now() WHERE id = v_owner.id;
  END LOOP;

  -- The platform 'owner' template ('*') is no longer used by anything.
  DELETE FROM user_roles
   WHERE role_id IN (SELECT id FROM roles WHERE tenant_id IS NULL AND code = 'owner');
  UPDATE roles SET deleted_at = now()
   WHERE tenant_id IS NULL AND code = 'owner' AND deleted_at IS NULL;
END $$;

-- migrate:down
-- Restores the retired 'owner' roles and grants them back to every holder of
-- the tenant's operator_admin role (the cloned operator_admin roles are kept).
UPDATE roles SET deleted_at = NULL WHERE code = 'owner' AND deleted_at IS NOT NULL;
INSERT INTO user_roles (user_id, role_id)
SELECT ur.user_id, o.id
  FROM roles o
  JOIN roles a ON a.tenant_id = o.tenant_id AND a.code = 'operator_admin' AND a.deleted_at IS NULL
  JOIN user_roles ur ON ur.role_id = a.id
 WHERE o.code = 'owner' AND o.tenant_id IS NOT NULL
ON CONFLICT DO NOTHING;
