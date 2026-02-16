import { createNearReadTools } from '../src/chains/near/tools/read.js';

async function main() {
  const tools = createNearReadTools();
  console.log('Testing stable yield plan...');
  const planTool = tools.find(t => t.name === 'near_getStableYieldPlan')!;
  const r = await planTool.execute('t', { network: 'mainnet', topN: 3 });
  console.log(r.content[0].text.slice(0, 500));
}
main().catch(e => console.error('ERROR:', e.message));
