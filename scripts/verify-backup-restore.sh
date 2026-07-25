#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${SOURCE_DATABASE_URL:-}" || -z "${RESTORE_DATABASE_URL:-}" ]]; then
  echo "SOURCE_DATABASE_URL and RESTORE_DATABASE_URL are required." >&2
  exit 2
fi

if [[ "${SOURCE_DATABASE_URL}" == "${RESTORE_DATABASE_URL}" ]]; then
  echo "The restore target must be different from the source database." >&2
  exit 2
fi

for command in pg_dump pg_restore psql sha256sum; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Required command is unavailable: ${command}" >&2
    exit 2
  fi
done

source_name="$(psql "${SOURCE_DATABASE_URL}" -Atqc "SELECT current_database()")"
restore_name="$(psql "${RESTORE_DATABASE_URL}" -Atqc "SELECT current_database()")"
if [[ "${source_name}" == "${restore_name}" ]]; then
  echo "The restore target resolves to the source database." >&2
  exit 2
fi

restore_tables="$(psql "${RESTORE_DATABASE_URL}" -Atqc "
  SELECT count(*) FROM pg_tables
  WHERE schemaname = 'public'
")"
if [[ "${restore_tables}" != "0" ]]; then
  echo "The restore target must be an empty database." >&2
  exit 2
fi

validation_dir="$(mktemp -d)"
dump_path="${validation_dir}/flux.dump"
cleanup() {
  rm -f -- "${dump_path}"
  rmdir -- "${validation_dir}" 2>/dev/null || true
}
trap cleanup EXIT

started_epoch_seconds="$(date +%s)"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
source_hash="$(printf '%s' "${SOURCE_DATABASE_URL}" | sha256sum | cut -d ' ' -f 1)"
status="passed"
error_class=""
row_counts_match="true"

if ! pg_dump \
  --format=custom \
  --no-owner \
  --no-acl \
  --dbname="${SOURCE_DATABASE_URL}" \
  --file="${dump_path}"; then
  status="failed"
  error_class="BACKUP_FAILED"
fi

if [[ "${status}" == "passed" ]] && ! pg_restore \
  --exit-on-error \
  --no-owner \
  --no-acl \
  --dbname="${RESTORE_DATABASE_URL}" \
  "${dump_path}"; then
  status="failed"
  error_class="RESTORE_FAILED"
fi

source_schema=""
restore_schema=""
if [[ "${status}" == "passed" ]]; then
  source_schema="$(psql "${SOURCE_DATABASE_URL}" -Atqc "
    SELECT name FROM kysely_migration ORDER BY timestamp DESC LIMIT 1
  ")"
  restore_schema="$(psql "${RESTORE_DATABASE_URL}" -Atqc "
    SELECT name FROM kysely_migration ORDER BY timestamp DESC LIMIT 1
  ")"
  if [[ "${source_schema}" != "${restore_schema}" ]]; then
    status="failed"
    error_class="MIGRATION_STATE_MISMATCH"
  fi
fi

tables=(
  sales
  sale_items
  payments
  sale_returns
  stock_movements
  inventory_daily_snapshots
  cash_sessions
  cash_movements
  cash_close_counts
  service_orders
  service_order_status_history
  audit_events
  job_runs
  ai_runs
  ai_insights
)

if [[ "${status}" == "passed" ]]; then
  for table in "${tables[@]}"; do
    source_count="$(psql "${SOURCE_DATABASE_URL}" -Atqc "SELECT count(*) FROM ${table}")"
    restore_count="$(psql "${RESTORE_DATABASE_URL}" -Atqc "SELECT count(*) FROM ${table}")"
    if [[ "${source_count}" != "${restore_count}" ]]; then
      status="failed"
      error_class="ROW_COUNT_MISMATCH"
      row_counts_match="false"
      break
    fi
  done
fi

finished_epoch_seconds="$(date +%s)"
finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
duration_ms="$(((finished_epoch_seconds - started_epoch_seconds) * 1000))"

psql "${SOURCE_DATABASE_URL}" \
  --set=status="${status}" \
  --set=source_hash="${source_hash}" \
  --set=source_schema="${source_schema}" \
  --set=restore_schema="${restore_schema}" \
  --set=row_counts_match="${row_counts_match}" \
  --set=started_at="${started_at}" \
  --set=finished_at="${finished_at}" \
  --set=duration_ms="${duration_ms}" \
  --set=error_class="${error_class}" \
  --set=tables_checked="${#tables[@]}" \
  --set=source_name="${source_name}" \
  --set=restore_name="${restore_name}" \
  >/dev/null <<'SQL'
  INSERT INTO backup_restore_checks (
    status,
    source_database_hash,
    source_schema_version,
    restored_schema_version,
    row_counts_match,
    backup_started_at,
    restore_finished_at,
    restore_duration_ms,
    error_class,
    details
  ) VALUES (
    :'status',
    :'source_hash',
    NULLIF(:'source_schema', ''),
    NULLIF(:'restore_schema', ''),
    :'row_counts_match'::boolean,
    :'started_at'::timestamptz,
    :'finished_at'::timestamptz,
    :'duration_ms'::bigint,
    NULLIF(:'error_class', ''),
    jsonb_build_object(
      'tablesChecked', :'tables_checked'::integer,
      'sourceDatabase', :'source_name',
      'restoreDatabase', :'restore_name'
    )
  );
SQL

if [[ "${status}" != "passed" ]]; then
  echo "Backup/restore verification failed: ${error_class}" >&2
  exit 1
fi

echo "Backup/restore verification passed in ${duration_ms} ms."
