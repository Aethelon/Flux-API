import { sql, type Kysely } from "kysely"
import type { Migration } from "kysely/migration"

export const jobRoleHardeningMigration: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      CREATE FUNCTION provision_tenant_job_roles() RETURNS trigger AS $$
      DECLARE administrator_id UUID;
      BEGIN
        INSERT INTO job_roles (tenant_id, name, description, system_key)
        VALUES (NEW.id, 'Administrador', 'Acesso completo ao sistema.', 'administrator')
        RETURNING id INTO administrator_id;
        INSERT INTO job_roles (tenant_id, name, description, system_key)
        VALUES (NEW.id, 'Operador', 'Acesso operacional configurável.', 'operator');
        INSERT INTO job_role_permissions (tenant_id, job_role_id, permission_key)
        SELECT NEW.id, administrator_id, permission.permission_key
        FROM (VALUES
          ('dashboard.view'), ('pos.view'), ('orders.view'), ('cash.view'),
          ('intelligence.view'), ('inventory.view'), ('history.view'), ('customers.view')
        ) AS permission(permission_key);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `.execute(db)
    await sql`
      CREATE TRIGGER tenants_provision_job_roles
      AFTER INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION provision_tenant_job_roles()
    `.execute(db)
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP TRIGGER tenants_provision_job_roles ON tenants`.execute(db)
    await sql`DROP FUNCTION provision_tenant_job_roles()`.execute(db)
  },
}
