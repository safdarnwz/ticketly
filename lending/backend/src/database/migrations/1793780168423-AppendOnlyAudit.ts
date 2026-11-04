import { MigrationInterface, QueryRunner } from 'typeorm';

/** Audit rows can never be changed or deleted, not even by the application user. */
export class AppendOnlyAudit1793780168423 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`
      CREATE OR REPLACE FUNCTION audit_logs_block_change() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END; $$ LANGUAGE plpgsql;`);
    await q.query(`CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_block_change();`);
    // One open loan per customer at a time, enforced by the database too.
    await q.query(`CREATE UNIQUE INDEX one_open_loan_per_customer ON loans ("customerId") WHERE status IN ('PENDING_DISBURSAL','ACTIVE');`);
  }
  async down(q: QueryRunner) {
    await q.query(`DROP INDEX one_open_loan_per_customer`);
    await q.query(`DROP TRIGGER audit_logs_no_update ON audit_logs`);
    await q.query(`DROP FUNCTION audit_logs_block_change`);
  }
}
