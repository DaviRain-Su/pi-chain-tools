import { createNearReadTools } from '../src/chains/near/tools/read.js';

async function main() {
  const tools = createNearReadTools();

  // Try testnet for Burrow
  console.log('=== Testnet: Burrow markets ===');
  const marketsTool = tools.find(t => t.name === 'near_getLendingMarketsBurrow')!;
  try {
    const r = await marketsTool.execute('t1', { network: 'testnet', limit: 3 });
    console.log(r.content[0].text.slice(0, 300));
  } catch (e: any) {
    console.log('Testnet Burrow error:', e.message.slice(0, 200));
  }
}
main();
