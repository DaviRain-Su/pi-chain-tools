import { createNearYieldWorkerTools, getYieldWorkerState, clearAllYieldWorkers } from '../src/chains/near/tools/yield-worker.js';

async function main() {
  const tools = createNearYieldWorkerTools();
  const findTool = (name: string) => tools.find(t => t.name === name)!;

  // Start worker in dry-run mode on mainnet
  console.log('Starting yield worker (dry-run, mainnet, root.near)...');
  const startTool = findTool('near_yieldWorkerStart');
  await (startTool.execute as any)('demo-1', {
    network: 'mainnet',
    accountId: 'root.near',
    dryRun: true,
    intervalSeconds: 9999,
    minAprDelta: 0.1,
  });
  console.log('Worker started. Waiting for first cycle (10s for real RPC calls)...');

  // Poll status every 2s
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const state = getYieldWorkerState('near:mainnet:root.near');
    if (state && state.recentLogs.length > 0) {
      const lastLog = state.recentLogs[state.recentLogs.length - 1];
      console.log(`\nCycle ${lastLog.cycleNumber} completed in ${lastLog.durationMs}ms`);
      console.log(`Decision: ${lastLog.decision.action.toUpperCase()}`);
      console.log(`Reason: ${lastLog.decision.reason}`);
      const fmtApr = (v: string | null) => v ? `${(parseFloat(v) * 100).toFixed(2)}%` : 'n/a';
      if (lastLog.decision.bestSymbol) {
        console.log(`Best: ${lastLog.decision.bestSymbol} @ ${fmtApr(lastLog.decision.bestApr)} APR`);
      }
      if (lastLog.decision.currentSymbol) {
        console.log(`Current: ${lastLog.decision.currentSymbol} @ ${fmtApr(lastLog.decision.currentApr)} APR`);
      }
      break;
    }
    console.log(`  Poll ${i+1}/5... still running`);
  }

  // Show status
  console.log('\n--- Worker Status ---');
  const statusTool = findTool('near_yieldWorkerStatus');
  const statusResult = await (statusTool.execute as any)('demo-s', {
    network: 'mainnet',
    accountId: 'root.near',
  });
  console.log(statusResult.content[0].text);

  // Stop
  const stopTool = findTool('near_yieldWorkerStop');
  await (stopTool.execute as any)('demo-stop', {
    network: 'mainnet',
    accountId: 'root.near',
  });
  console.log('\nWorker stopped.');
  clearAllYieldWorkers();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
