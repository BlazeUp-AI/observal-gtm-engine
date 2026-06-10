const Database = require('better-sqlite3');
const db = new Database('gtm.db');

console.log('contact email status:', JSON.stringify(db.prepare('select email_status s, count(*) n from contacts group by 1').all()));
console.log('lead sources:');
for (const r of db.prepare("select action, payload_json from audit_log where action like 'source.%' order by id desc limit 4").all()) {
  console.log(' ', r.action, r.payload_json);
}
console.log('sample champions:');
for (const r of db.prepare('select name, email, email_status from contacts limit 6').all()) {
  console.log(' ', r.name, '|', r.email, '|', r.email_status);
}
