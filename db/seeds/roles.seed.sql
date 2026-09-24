-- Seed: system role templates (tenant_id = NULL) + their permission grants.
-- Idempotent via fixed ids. Run AFTER permissions.seed.sql.

INSERT INTO roles (id, tenant_id, code, name, description, is_system) VALUES
  ('00000000-0000-7000-8000-0000000000a1', NULL, 'owner',   'Owner',   'Full access to the operator account', true),
  ('00000000-0000-7000-8000-0000000000a2', NULL, 'manager', 'Manager', 'Manage operations, fleet, scheduling, pricing', true),
  ('00000000-0000-7000-8000-0000000000a3', NULL, 'finance', 'Finance', 'Payments, refunds, settlements, invoicing, reports', true),
  ('00000000-0000-7000-8000-0000000000a4', NULL, 'ops',     'Operations', 'Run trips: charting, boarding, tracking', true),
  ('00000000-0000-7000-8000-0000000000a5', NULL, 'support', 'Support', 'Bookings + customer support', true),
  ('00000000-0000-7000-8000-0000000000a6', NULL, 'agent',   'Agent',   'B2B sub-distributor — book off their own prepaid wallet', true),
  -- Canonical platform roles (the unified role set used for login redirection)
  ('00000000-0000-7000-8000-0000000000b1', NULL, 'super_admin',    'Super Admin',    'Full platform control incl. operator approvals', true),
  ('00000000-0000-7000-8000-0000000000b2', NULL, 'platform_admin', 'Platform Admin', 'Platform administration + operator approvals', true),
  ('00000000-0000-7000-8000-0000000000b3', NULL, 'operator_admin', 'Operator Admin', 'Full access to their operator account', true),
  ('00000000-0000-7000-8000-0000000000b4', NULL, 'operator_staff', 'Operator Staff', 'Day-to-day operator operations', true),
  ('00000000-0000-7000-8000-0000000000b5', NULL, 'customer',       'Customer',       'Book and manage own trips', true)
ON CONFLICT (id) DO NOTHING;

-- Super Admin + Platform Admin: every permission (incl. platform:*).
INSERT INTO role_permissions (role_id, permission)
  SELECT '00000000-0000-7000-8000-0000000000b1', code FROM permissions ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission)
  SELECT '00000000-0000-7000-8000-0000000000b2', code FROM permissions
   WHERE code <> 'platform:admin' ON CONFLICT DO NOTHING;

-- Operator Admin: every operator (non-platform) permission.
INSERT INTO role_permissions (role_id, permission)
  SELECT '00000000-0000-7000-8000-0000000000b3', code FROM permissions
   WHERE resource <> 'platform' ON CONFLICT DO NOTHING;

-- Operator Staff: run trips + bookings.
INSERT INTO role_permissions (role_id, permission) VALUES
  ('00000000-0000-7000-8000-0000000000b4', 'booking:read'),
  ('00000000-0000-7000-8000-0000000000b4', 'booking:create'),
  ('00000000-0000-7000-8000-0000000000b4', 'booking:cancel'),
  ('00000000-0000-7000-8000-0000000000b4', 'trip:operate'),
  ('00000000-0000-7000-8000-0000000000b4', 'tracking:read')
ON CONFLICT DO NOTHING;

-- Agent: an EXTERNAL party selling this operator's seats. Holds ONLY
-- agent:portal — never booking:read/cancel (those reach the operator's
-- generic /bookings endpoints, i.e. EVERY booking in the tenant, including
-- other agents' and direct customers') and never agent:read/manage (every
-- agent's balance; crediting their own account). The /agent-portal
-- endpoints resolve "which agent am I" from the logged-in user and scope
-- every query to that agent's own rows.
INSERT INTO role_permissions (role_id, permission) VALUES
  ('00000000-0000-7000-8000-0000000000a6', 'agent:portal')
ON CONFLICT DO NOTHING;
DELETE FROM role_permissions
 WHERE role_id = '00000000-0000-7000-8000-0000000000a6' AND permission <> 'agent:portal';

-- Customer: manage their own bookings.
INSERT INTO role_permissions (role_id, permission) VALUES
  ('00000000-0000-7000-8000-0000000000b5', 'booking:read'),
  ('00000000-0000-7000-8000-0000000000b5', 'booking:create'),
  ('00000000-0000-7000-8000-0000000000b5', 'booking:cancel'),
  ('00000000-0000-7000-8000-0000000000b5', 'booking:reschedule')
ON CONFLICT DO NOTHING;

-- Owner: every permission.
INSERT INTO role_permissions (role_id, permission)
  SELECT '00000000-0000-7000-8000-0000000000a1', code FROM permissions
ON CONFLICT DO NOTHING;

-- Manager: everything except role/tenant management and refunds.
INSERT INTO role_permissions (role_id, permission)
  SELECT '00000000-0000-7000-8000-0000000000a2', code FROM permissions
   WHERE code NOT IN ('role:manage', 'tenant:manage', 'payment:refund', 'settlement:manage')
ON CONFLICT DO NOTHING;

-- Finance.
INSERT INTO role_permissions (role_id, permission) VALUES
  ('00000000-0000-7000-8000-0000000000a3', 'payment:read'),
  ('00000000-0000-7000-8000-0000000000a3', 'payment:refund'),
  ('00000000-0000-7000-8000-0000000000a3', 'settlement:manage'),
  ('00000000-0000-7000-8000-0000000000a3', 'report:read'),
  ('00000000-0000-7000-8000-0000000000a3', 'report:export'),
  ('00000000-0000-7000-8000-0000000000a3', 'booking:read')
ON CONFLICT DO NOTHING;

-- Operations.
INSERT INTO role_permissions (role_id, permission) VALUES
  ('00000000-0000-7000-8000-0000000000a4', 'trip:operate'),
  ('00000000-0000-7000-8000-0000000000a4', 'trip:manage'),
  ('00000000-0000-7000-8000-0000000000a4', 'crew:manage'),
  ('00000000-0000-7000-8000-0000000000a4', 'tracking:read'),
  ('00000000-0000-7000-8000-0000000000a4', 'booking:read')
ON CONFLICT DO NOTHING;

-- Support.
INSERT INTO role_permissions (role_id, permission) VALUES
  ('00000000-0000-7000-8000-0000000000a5', 'booking:read'),
  ('00000000-0000-7000-8000-0000000000a5', 'booking:create'),
  ('00000000-0000-7000-8000-0000000000a5', 'booking:cancel'),
  ('00000000-0000-7000-8000-0000000000a5', 'booking:reschedule'),
  ('00000000-0000-7000-8000-0000000000a5', 'payment:read')
ON CONFLICT DO NOTHING;
