import { createNearYieldWorkerTools, getYieldWorkerState, clearAllYieldWorkers } from '../src/chains/near/tools/yield-worker.js';

async function main() {
  const tools = createNearYieldWorkerTools();
  const findTool = (name: string) => tools.find(t => t.name === name)!;

  // 1. Start worker in dry-run mode on mainnet
  console.log('=== 1. Starting yield worker (dry-run, mainnet) ===');
  const startTool = findTool('near_yieldWorkerStart');
  const startResult = await startTool.execute('demo-1', {
    network: 'mainnet',
    accountId: 'root.near',  // public account, read-only
    dryRun: true,
    intervalSeconds: 9999,   // won't auto-cycle
    minAprDelta: 0.5,
  } as any);
  console.log(startResult.content[0].text);
  console.log();

  // 2. Wait for first cycle to complete (real RPC calls)
  console.log('=== 2. Waiting for first cycle (real RPC) ===');
  await new Promise(r => setTimeout(r, 5000));  // give it time for real RPC

  // 3. Check status
  console.log('=== 3. Checking worker status ===');
  const statusTool = findTool('near_yieldWorkerStatus');
  const statusResult = await statusTool.execute('demo-3', {
    network: 'mainnet',
    accountId: 'root.near',
  } as any);
  console.log(statusResult.content[0].text);
  console.log();

  // 4. Show recent logs
  const state = getYieldWorkerState('near:mainnet:root.near');
  if (state && state.recentLogs.length > 0) {
    const lastLog = state.recentLogs[state.recentLogs.length - 1];
    console.log('=== 4. Last cycle decision ===');
    console.log(JSON.stringify(lastLog, null, 2));
  } else {
    console.log('=== 4. No cycle logs yet (worker may still be running first cycle) ===');
  }
  console.log();

  // 5. Stop worker
  console.log('=== 5. Stopping worker ===');
  const stopTool = findTool('near_yieldWorkerStop');
  const stopResult = await stopTool.execute('demo-5', {
    network: 'mainnet',
    accountId: 'root.near',
  } as any);
  console.log(stopResult.content[0].text);

  clearAllYieldWorkers();
  console.log('\n=== Demo complete! ===');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
