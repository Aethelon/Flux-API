# PostgreSQL Backup and Restore Verification

This procedure verifies that a Flux database backup can be restored without replacing
or modifying the source database.

## Requirements

- PostgreSQL client tools matching the production major version.
- A database role allowed to run `pg_dump`.
- A separate empty validation database.
- Enough temporary storage for the compressed backup.

## Procedure

1. Create a custom-format backup from the source database:

   ```sh
   pg_dump --format=custom --no-owner --no-acl --dbname="$SOURCE_DATABASE_URL" --file=flux.dump
   ```

2. Create a separate empty validation database. Never use the source database as the
   restore target.

3. Restore the backup:

   ```sh
   pg_restore --exit-on-error --no-owner --no-acl --dbname="$RESTORE_DATABASE_URL" flux.dump
   ```

4. Verify the restored migration state:

   ```sql
   SELECT name, timestamp
   FROM kysely_migration
   ORDER BY timestamp DESC;
   ```

5. Compare source and restored counts for immutable and operational tables, including:

   - `sales`, `sale_items`, `payments`, and `sale_returns`;
   - `stock_movements` and `inventory_daily_snapshots`;
   - `cash_sessions`, `cash_movements`, and `cash_close_counts`;
   - `service_orders` and `service_order_status_history`;
   - `audit_events`, `job_runs`, and `export_artifacts`.

6. Run the application integration tests against the restored database.

7. Record the backup time, restore duration, restored migration, compared row counts,
   result, and operator in the operational restore-test log.

8. Drop only the separate validation database and securely remove the temporary dump
   after verification.

## Failure handling

- Keep the source database unchanged.
- Retain the failed validation database only while investigating.
- Record the failed step and error class without credentials or connection strings.
- Correct the procedure or backup configuration and repeat with a new empty validation
  database.
