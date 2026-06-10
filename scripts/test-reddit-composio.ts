import { getComposio } from '../src/core/composio.js';

async function main() {
  const c = getComposio();
  if (!c) {
    console.error('COMPOSIO_API_KEY missing');
    process.exit(1);
  }
  try {
    const r = await c.tools.execute('REDDIT_RETRIEVE_REDDIT_POST', {
      userId: 'gtm-engine',
      arguments: { subreddit: 'LangChain', size: 5 },
    });
    console.log(JSON.stringify(r, null, 2).slice(0, 3000));
  } catch (e) {
    console.error('ERR', e);
    process.exit(1);
  }
}

main();
