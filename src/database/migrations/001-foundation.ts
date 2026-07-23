import { sql, type Kysely } from "kysely"
import type { Migration } from "kysely/migration"

export const foundationMigration: Migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.execute(db)

    await sql`
      CREATE TABLE tenants (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        slug text NOT NULL UNIQUE,
        name text NOT NULL,
        status text NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'suspended', 'archived')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        archived_at timestamptz
      )
    `.execute(db)

    await sql`
      CREATE TABLE tenant_settings (
        tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
        timezone text NOT NULL DEFAULT 'America/Recife',
        currency char(3) NOT NULL DEFAULT 'BRL',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `.execute(db)

    await sql`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        name text NOT NULL,
        email text NOT NULL,
        phone text,
        password_hash text NOT NULL,
        role text NOT NULL CHECK (role IN ('admin', 'funcionario')),
        status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        archived_at timestamptz
      )
    `.execute(db)

    await sql`
      CREATE UNIQUE INDEX users_tenant_email_active_uidx
      ON users (tenant_id, lower(email))
      WHERE archived_at IS NULL
    `.execute(db)

    await sql`
      CREATE TABLE auth_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        family_id uuid NOT NULL,
        refresh_token_hash char(64) NOT NULL UNIQUE,
        user_agent text,
        ip_address inet,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_used_at timestamptz,
        revoked_at timestamptz,
        revoke_reason text,
        replaced_by_session_id uuid REFERENCES auth_sessions(id) ON DELETE RESTRICT
      )
    `.execute(db)

    await sql`
      CREATE INDEX auth_sessions_user_active_idx
      ON auth_sessions (tenant_id, user_id, expires_at)
      WHERE revoked_at IS NULL
    `.execute(db)

    await sql`
      CREATE INDEX auth_sessions_family_idx
      ON auth_sessions (family_id)
    `.execute(db)

    await sql`
      CREATE TABLE audit_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        occurred_at timestamptz NOT NULL DEFAULT now(),
        actor_type text NOT NULL CHECK (actor_type IN ('user', 'system', 'job')),
        actor_id uuid,
        action text NOT NULL,
        entity_type text NOT NULL,
        entity_id uuid NOT NULL,
        request_id text,
        correlation_id text,
        source text NOT NULL CHECK (source IN ('api', 'worker', 'migration', 'system')),
        reason text,
        before_json jsonb,
        after_json jsonb,
        ip_address inet,
        user_agent text
      )
    `.execute(db)

    await sql`
      CREATE INDEX audit_events_tenant_time_idx
      ON audit_events (tenant_id, occurred_at DESC, id DESC)
    `.execute(db)

    await sql`
      CREATE INDEX audit_events_entity_idx
      ON audit_events (tenant_id, entity_type, entity_id, occurred_at DESC)
    `.execute(db)

    await sql`
      CREATE TABLE outbox_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        event_type text NOT NULL,
        aggregate_type text NOT NULL,
        aggregate_id uuid NOT NULL,
        payload jsonb NOT NULL,
        status text NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
        attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        available_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        processed_at timestamptz,
        last_error text
      )
    `.execute(db)

    await sql`
      CREATE INDEX outbox_events_pending_idx
      ON outbox_events (available_at, created_at)
      WHERE status IN ('pending', 'failed')
    `.execute(db)

    await sql`
      CREATE TABLE idempotency_records (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        route text NOT NULL,
        idempotency_key text NOT NULL,
        request_hash char(64) NOT NULL,
        response_status integer,
        response_body jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        UNIQUE (tenant_id, user_id, route, idempotency_key)
      )
    `.execute(db)

    await sql`
      CREATE INDEX idempotency_records_expiry_idx
      ON idempotency_records (expires_at)
    `.execute(db)
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP TABLE IF EXISTS idempotency_records`.execute(db)
    await sql`DROP TABLE IF EXISTS outbox_events`.execute(db)
    await sql`DROP TABLE IF EXISTS audit_events`.execute(db)
    await sql`DROP TABLE IF EXISTS auth_sessions`.execute(db)
    await sql`DROP TABLE IF EXISTS users`.execute(db)
    await sql`DROP TABLE IF EXISTS tenant_settings`.execute(db)
    await sql`DROP TABLE IF EXISTS tenants`.execute(db)
  },
}
