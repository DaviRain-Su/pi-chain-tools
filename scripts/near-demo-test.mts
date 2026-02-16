import { createNearReadTools } from '../src/chains/near/tools/read.js';

async function main() {
  const tools = createNearReadTools();

  // 1. Balance check
  console.log('=== 1. near_getBalance (root.near) ===');
  const balanceTool = tools.find(t => t.name === 'near_getBalance');
  const balanceResult = await balanceTool.execute('test-1', { network: 'mainnet', accountId: 'root.near' });
  console.log(balanceResult.content[0].text);
  console.log();

  // 2. Burrow lending markets
  console.log('=== 2. near_getLendingMarketsBurrow ===');
  const marketsTool = tools.find(t => t.name === 'near_getLendingMarketsBurrow');
  const marketsResult = await marketsTool.execute('test-2', { network: 'mainnet', limit: 5 });
  console.log(marketsResult.content[0].text.slice(0, 500));
  console.log();

  // 3. Stable yield plan
  console.log('=== 3. near_getStableYieldPlan ===');
  const planTool = tools.find(t => t.name === 'near_getStableYieldPlan');
  const planResult = await planTool.execute('test-3', { network: 'mainnet', topN: 5 });
  console.log(planResult.content[0].text);
  console.log();

  console.log('=== All read tools working! ===');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
