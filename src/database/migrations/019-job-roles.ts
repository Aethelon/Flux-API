import { sql, type Kysely } from "kysely"
import type { Migration } from "kysely/migration"

export const jobRolesMigration: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      CREATE TABLE job_roles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        system_key TEXT NULL CHECK (system_key IN ('administrator', 'operator')),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        archived_at TIMESTAMPTZ NULL,
        UNIQUE (tenant_id, id)
      )
    `.execute(db)
    await sql`CREATE UNIQUE INDEX job_roles_name_unique ON job_roles (tenant_id, lower(name)) WHERE archived_at IS NULL`.execute(db)
    await sql`CREATE UNIQUE INDEX job_roles_system_unique ON job_roles (tenant_id, system_key) WHERE system_key IS NOT NULL`.execute(db)

    await sql`
      CREATE TABLE job_role_permissions (
        tenant_id UUID NOT NULL,
        job_role_id UUID NOT NULL,
        permission_key TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (job_role_id, permission_key),
        FOREIGN KEY (tenant_id, job_role_id) REFERENCES job_roles(tenant_id, id) ON DELETE CASCADE
      )
    `.execute(db)

    await sql`
      INSERT INTO job_roles (tenant_id, name, description, system_key)
      SELECT id, 'Administrador', 'Acesso completo ao sistema.', 'administrator' FROM tenants
    `.execute(db)
    await sql`
      INSERT INTO job_roles (tenant_id, name, description, system_key)
      SELECT id, 'Operador', 'Acesso operacional configurável.', 'operator' FROM tenants
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
    `.execute(db)

    await sql`ALTER TABLE users ADD COLUMN job_role_id UUID NULL`.execute(db)
    await sql`
      UPDATE users user_account
      SET job_role_id = role.id
      FROM job_roles role
      WHERE role.tenant_id = user_account.tenant_id
        AND role.system_key = CASE WHEN user_account.role = 'admin' THEN 'administrator' ELSE 'operator' END
    `.execute(db)
    await sql`ALTER TABLE users ALTER COLUMN job_role_id SET NOT NULL`.execute(db)
    await sql`
      ALTER TABLE users ADD CONSTRAINT users_job_role_fk
      FOREIGN KEY (tenant_id, job_role_id) REFERENCES job_roles(tenant_id, id) ON DELETE RESTRICT
    `.execute(db)
    await sql`
      CREATE FUNCTION assign_default_job_role() RETURNS trigger AS $$
      BEGIN
        IF NEW.job_role_id IS NULL THEN
          SELECT id INTO NEW.job_role_id FROM job_roles
          WHERE tenant_id = NEW.tenant_id
            AND system_key = CASE WHEN NEW.role = 'admin' THEN 'administrator' ELSE 'operator' END;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `.execute(db)
    await sql`CREATE TRIGGER users_assign_default_job_role BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION assign_default_job_role()`.execute(db)
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP TRIGGER users_assign_default_job_role ON users`.execute(db)
    await sql`DROP FUNCTION assign_default_job_role()`.execute(db)
    await sql`ALTER TABLE users DROP CONSTRAINT users_job_role_fk`.execute(db)
    await sql`ALTER TABLE users DROP COLUMN job_role_id`.execute(db)
    await sql`DROP TABLE job_role_permissions`.execute(db)
    await sql`DROP TABLE job_roles`.execute(db)
  },
}
