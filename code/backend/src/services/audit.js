// Append-only audit trail (FR-8). Only create() is ever called; a database trigger
// (installed at server start) also rejects any UPDATE or DELETE on AuditLog.
const { prisma } = require('../db');

function audit(db, entry) {
  const {
    entity, entity_id, actor, role, action,
    from_status = null, to_status = null, comment = null, before = null, after = null,
  } = entry;
  return db.auditLog.create({
    data: { entity, entity_id: String(entity_id), actor, role, action, from_status, to_status, comment, before, after },
  });
}

async function installAuditGuard() {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION audit_append_only() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'AuditLog is append-only'; END; $$ LANGUAGE plpgsql;`);
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS audit_append_only_trg ON "AuditLog";');
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER audit_append_only_trg BEFORE UPDATE OR DELETE ON "AuditLog"
    FOR EACH ROW EXECUTE FUNCTION audit_append_only();`);
}

module.exports = { audit, installAuditGuard };
