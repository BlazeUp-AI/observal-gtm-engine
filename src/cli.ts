import { runProspector } from './agents/prospector/index.js';
import { runOutreach } from './agents/outreach/index.js';
import { runSignalScout } from './agents/signal-scout/index.js';
import { runReplyTriager } from './agents/reply-triager/index.js';
import { runScorecard } from './agents/scorecard/index.js';
import { runWarmup } from './agents/warmup/index.js';
import { getGoLiveStatus, maybeAutoGoLive } from './core/go-live.js';
import { syncLeadsToSheet } from './core/sheets.js';
import { db, schema } from './core/db.js';
import { getAgentMail } from './core/agentmail.js';
import { eq } from 'drizzle-orm';

const [cmd, sub, ...rest] = process.argv.slice(2);

const usage = `gtm-engine CLI
  prospect run            run Prospector once
  outreach dry-run        run Outreach Engine (respects DRY_RUN)
  scout run [hours]       run Signal Scout once
  triage run              run Reply Triager once
  report now              run Scorecard Reporter once
  leads sync              push new accounts/contacts to the Leads sheet tab
  warmup run              run Warmup agent once (safe: own inboxes + seeds only)
  go-live status          show auto go-live readiness + campaign clock
  go-live check           run the auto go-live gate now (same as scheduler)
  domain add <domain>     register a sending domain with AgentMail, print DNS records
  domain status <domain>  show verification status + DNS records
  inbox add <email>       provision an AgentMail inbox + start its ramp clock
  test e2e                synthetic contact -> outreach dry-run -> show planned email
  pause all|<domain>      kill switch
  resume all|<domain>     re-enable sending`;

function printDnsRecords(records: { type: string; name: string; value: string; status: string; priority?: number }[]) {
  for (const r of records) {
    const prio = r.priority !== undefined ? ` (priority ${r.priority})` : '';
    console.log(`  [${r.status}] ${r.type.toUpperCase().padEnd(5)} ${r.name}\n          -> ${r.value}${prio}`);
  }
}

async function main() {
  switch (`${cmd} ${sub ?? ''}`.trim()) {
    case 'domain add': {
      const domain = rest[0];
      if (!domain?.includes('.')) return console.log('usage: domain add yourdomain.com');
      const agentmail = getAgentMail();
      if (!agentmail) return console.log('Set AGENTMAIL_API_KEY in .env first.');
      const created = await agentmail.domains.create({ domain, feedbackEnabled: true });
      console.log(`Domain registered with AgentMail: ${domain} (status: ${created.status})`);
      console.log('Add these DNS records in Porkbun (DNS settings for the domain):');
      printDnsRecords(created.records);
      console.log('\nThen run: npm run cli -- domain status ' + domain);
      return;
    }
    case 'domain status': {
      const domain = rest[0];
      if (!domain) return console.log('usage: domain status yourdomain.com');
      const agentmail = getAgentMail();
      if (!agentmail) return console.log('Set AGENTMAIL_API_KEY in .env first.');
      const d = await agentmail.domains.get(domain);
      console.log(`${d.domain}: ${d.status}`);
      printDnsRecords(d.records);
      return;
    }
    case 'inbox add': {
      const email = rest[0];
      if (!email?.includes('@')) return console.log('usage: inbox add you@domain.com');
      const [username, domain] = email.split('@');
      const agentmail = getAgentMail();
      if (agentmail) {
        const inbox = await agentmail.inboxes.create({ username, domain, clientId: `gtm-${username}-${domain}`.replace(/[^A-Za-z0-9._~-]/g, '-') });
        console.log(`AgentMail inbox provisioned: ${inbox.inboxId}`);
      } else {
        console.log('No AGENTMAIL_API_KEY — registered locally only; provision in AgentMail later.');
      }
      await db.insert(schema.inboxes).values({ email, domain, rampStartedAt: Date.now() }).onConflictDoNothing();
      console.log(`Inbox registered: ${email} — ramp clock started (day 1 cap: 10/day).`);
      return;
    }
    case 'test e2e': {
      const [acct] = await db
        .insert(schema.accounts)
        .values({ domain: 'synthetic-test.dev', name: 'Synthetic Test Co', archetype: 'devtool', icpScore: 99, status: 'qualified', scoreRationale: 'e2e test fixture' })
        .onConflictDoNothing()
        .returning({ id: schema.accounts.id });
      if (acct) {
        await db.insert(schema.contacts).values({
          accountId: acct.id,
          name: 'Test Champion',
          email: 'champion@synthetic-test.dev',
          emailStatus: 'verified',
          emailSource: 'manual',
          signalUrl: 'https://news.ycombinator.com/item?id=0',
          signalSummary: 'Posted on HN about losing track of prompt versions across their LangGraph support agents',
          status: 'new',
        });
      }
      console.log('Synthetic fixture ready. Running outreach (DRY_RUN expected)...');
      await runOutreach();
      const plan = await db.query.auditLog.findMany({
        where: (t, { eq: eq2, and: and2 }) => and2(eq2(t.agent, 'outreach'), eq2(t.action, 'send.dry_run')),
        orderBy: (t, { desc }) => desc(t.id),
        limit: 1,
      });
      console.log(plan[0] ? `Planned send: ${plan[0].payloadJson}` : 'No dry-run send produced — check guards in audit_log.');
      return;
    }
    case 'prospect run': return runProspector();
    case 'outreach dry-run': return runOutreach();
    case 'scout run': return runSignalScout(rest[0] ? Number(rest[0]) : 24);
    case 'triage run': return runReplyTriager();
    case 'report now': return runScorecard();
    case 'leads sync': {
      const res = await syncLeadsToSheet();
      console.log(`Leads synced to sheet: ${res.accounts} accounts, ${res.contacts} contacts.`);
      return;
    }
    case 'warmup run': return runWarmup();
    case 'go-live status': {
      const s = await getGoLiveStatus();
      console.log(JSON.stringify(s, null, 2));
      return;
    }
    case 'go-live check': {
      const live = await maybeAutoGoLive();
      console.log(live ? 'Go-live activated.' : 'Not ready yet — see: go-live status');
      return;
    }
    case `pause ${sub}`.trim():
      if (cmd === 'pause' && sub) return setPaused(sub, true);
      break;
    case `resume ${sub}`.trim():
      if (cmd === 'resume' && sub) return setPaused(sub, false);
      break;
  }
  console.log(usage);
}

async function setPaused(target: string, paused: boolean) {
  const reason = paused ? `manual (${rest.join(' ') || 'cli'})` : null;
  if (target === 'all') {
    await db.update(schema.inboxes).set({ paused, pausedReason: reason });
  } else {
    await db.update(schema.inboxes).set({ paused, pausedReason: reason }).where(eq(schema.inboxes.domain, target));
  }
  console.log(`${paused ? 'Paused' : 'Resumed'}: ${target}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
