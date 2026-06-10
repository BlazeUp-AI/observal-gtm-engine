// Removes the synthetic-test.dev fixtures created by `cli test e2e`.
const Database = require('better-sqlite3');
const db = new Database('gtm.db');

const acc = db.prepare("select id from accounts where domain='synthetic-test.dev'").all();
for (const a of acc) {
  const contacts = db.prepare('select id from contacts where account_id=?').all(a.id);
  for (const c of contacts) {
    db.prepare('delete from sends where contact_id=?').run(c.id);
    db.prepare('delete from sequences where contact_id=?').run(c.id);
    db.prepare('delete from replies where contact_id=?').run(c.id);
  }
  db.prepare('delete from contacts where account_id=?').run(a.id);
  db.prepare('delete from accounts where id=?').run(a.id);
}
db.prepare("delete from inboxes where domain='synthetic-test.dev'").run();
console.log(`cleaned ${acc.length} synthetic account(s)`);
