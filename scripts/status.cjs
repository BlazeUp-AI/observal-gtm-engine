// Quick DB status — used by the build loop and humans alike: node scripts/status.cjs
const Database = require('better-sqlite3');
const db = new Database('gtm.db');

const acc = db.prepare('select count(*) n, sum(case when icp_score>=70 then 1 else 0 end) hi from accounts').get();
const cnt = db.prepare('select count(*) n from contacts').get();
const verified = db.prepare("select count(*) n from contacts where email_status='verified'").get();
const failures = db.prepare("select count(*) n from audit_log where action like '%failed%'").get();
const top = db
  .prepare('select name, domain, archetype, icp_score from accounts order by icp_score desc limit 8')
  .all();

console.log(`accounts: ${acc.n} (qualified >=70: ${acc.hi ?? 0}) | contacts: ${cnt.n} (verified email: ${verified.n}) | failures: ${failures.n}`);
for (const t of top) console.log(`  ${String(t.icp_score).padStart(3)} ${t.name} [${t.archetype}] ${t.domain}`);
