import "dotenv/config";
import { db } from "../src/lib/db";

/**
 * Phase B: make AuditLog append-only at the database level.
 * SQLite triggers raise an error on any UPDATE/DELETE of audit rows, so even
 * a compromised admin action path (or a buggy script) cannot silently alter
 * history. Idempotent: DROP + CREATE.
 */
async function main() {
  await db.$executeRawUnsafe(`
    CREATE TRIGGER IF NOT EXISTS audit_log_no_update
    BEFORE UPDATE ON AuditLog
    BEGIN
      SELECT RAISE(ABORT, 'AuditLog is append-only');
    END;
  `);
  await db.$executeRawUnsafe(`
    CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
    BEFORE DELETE ON AuditLog
    BEGIN
      SELECT RAISE(ABORT, 'AuditLog is append-only');
    END;
  `);
  console.log("✓ AuditLog immutability triggers installed");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
