import { sql, type Kysely } from "kysely"
import type { Migration } from "kysely/migration"

export const screenAccessMigration: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      INSERT INTO job_role_permissions (tenant_id, job_role_id, permission_key)
      SELECT DISTINCT tenant_id, job_role_id,
        CASE permission_key
          WHEN 'intelligence.manage' THEN 'intelligence.view'
          WHEN 'cash.manage' THEN 'cash.view'
          WHEN 'orders.columns.manage' THEN 'orders.view'
          WHEN 'sales.cancel' THEN 'pos.view'
          ELSE permission_key
        END
      FROM job_role_permissions
      WHERE permission_key IN (
        'intelligence.manage', 'cash.manage', 'orders.columns.manage', 'sales.cancel'
      )
      ON CONFLICT (job_role_id, permission_key) DO NOTHING
    `.execute(db)

    await sql`
      DELETE FROM job_role_permissions
      WHERE permission_key IN (
        'intelligence.manage', 'history.export', 'history.kpis', 'cash.manage',
        'orders.columns.manage', 'sales.cancel', 'audit.view'
      )
    `.execute(db)

    await sql`
      INSERT INTO job_role_permissions (tenant_id, job_role_id, permission_key)
      SELECT role.tenant_id, role.id, permission.permission_key
      FROM job_roles role
      CROSS JOIN (VALUES
        ('dashboard.view'), ('pos.view'), ('orders.view'), ('cash.view'),
        ('intelligence.view'), ('inventory.view'), ('history.view'), ('customers.view')
      ) AS permission(permission_key)
      WHERE role.system_key = 'administrator'
      ON CONFLICT (job_role_id, permission_key) DO NOTHING
    `.execute(db)

    await sql`
      INSERT INTO job_role_permissions (tenant_id, job_role_id, permission_key)
      SELECT role.tenant_id, role.id, permission.permission_key
      FROM job_roles role
      CROSS JOIN (VALUES
        ('pos.view'), ('orders.view'), ('inventory.view'), ('customers.view')
      ) AS permission(permission_key)
      WHERE role.system_key = 'operator'
      ON CONFLICT (job_role_id, permission_key) DO NOTHING
    `.execute(db)

    await sql`
      CREATE OR REPLACE FUNCTION provision_tenant_job_roles() RETURNS trigger AS $$
      DECLARE administrator_id UUID;
      DECLARE operator_id UUID;
      BEGIN
        INSERT INTO job_roles (tenant_id, name, description, system_key)
        VALUES (NEW.id, 'Administrador', 'Acesso completo ao sistema.', 'administrator')
        RETURNING id INTO administrator_id;
        INSERT INTO job_roles (tenant_id, name, description, system_key)
        VALUES (NEW.id, 'Operador', 'Acesso operacional configurável.', 'operator')
        RETURNING id INTO operator_id;
        INSERT INTO job_role_permissions (tenant_id, job_role_id, permission_key)
        SELECT NEW.id, administrator_id, permission.permission_key
        FROM (VALUES
          ('dashboard.view'), ('pos.view'), ('orders.view'), ('cash.view'),
          ('intelligence.view'), ('inventory.view'), ('history.view'), ('customers.view')
        ) AS permission(permission_key);
        INSERT INTO job_role_permissions (tenant_id, job_role_id, permission_key)
        SELECT NEW.id, operator_id, permission.permission_key
        FROM (VALUES
          ('pos.view'), ('orders.view'), ('inventory.view'), ('customers.view')
        ) AS permission(permission_key);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `.execute(db)
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`
      DELETE FROM job_role_permissions
      WHERE permission_key IN (
        'pos.view', 'orders.view', 'cash.view', 'intelligence.view',
        'inventory.view', 'customers.view'
      )
    `.execute(db)
  },
}
