import { runProspector } from './agents/prospector/index.js';
import { runOutreach } from './agents/outreach/index.js';
import { runSignalScout } from './agents/signal-scout/index.js';
import { runReplyTriager } from './agents/reply-triager/index.js';
import { runScorecard } from './agents/scorecard/index.js';
import { db, schema } from './core/db.js';
import { eq } from 'drizzle-orm';

const [cmd, sub, ...rest] = process.argv.slice(2);

const usage = `gtm-engine CLI
  prospect run            run Prospector once
  outreach dry-run        run Outreach Engine (respects DRY_RUN)
  scout run [hours]       run Signal Scout once
  triage run              run Reply Triager once
  report now              run Scorecard Reporter once
  inbox add <email>       register a sending inbox (starts its ramp clock)
  test e2e                synthetic contact -> outreach dry-run -> show planned email
  pause all|<domain>      kill switch
  resume all|<domain>     re-enable sending`;

async function main() {
  switch (`${cmd} ${sub ?? ''}`.trim()) {
    case 'inbox add': {
      const email = rest[0];
      if (!email?.includes('@')) return console.log('usage: inbox add you@domain.com');
      await db.insert(schema.inboxes).values({ email, domain: email.split('@')[1], rampStartedAt: Date.now() }).onConflictDoNothing();
      console.log(`Inbox registered: ${email} — ramp clock started (day 1 cap: 10/day). Connect its Gmail in Composio with user id "inbox:${email}".`);
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
