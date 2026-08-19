// Sample one tx per distinct poolId instead of per tx.
// Hooked pools are numerous but low-volume, so per-tx sampling is heavily biased
// toward the handful of hookless blue-chip pools. Per-pool sampling is not.
import { writeFileSync } from 'node:fs';
import { rpc } from './rpc.mjs';
import { POOL_MANAGER } from './v4.mjs';

const TOPICS = {
  swap: '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f',
  liquidity: '0xf208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec',
};
const chain = process.argv[2] ?? 'unichain';
const windows = Number(process.argv[3] ?? 8);
const span = Number(process.argv[4] ?? 450);
const event = process.argv[5] ?? 'swap';
const skipBack = Number(process.argv[6] ?? 0); // start N blocks behind head for an independent sample
const SWAP_TOPIC = TOPICS[event];
const PM = POOL_MANAGER[chain];

const head = Number(await rpc('eth_blockNumber', [], { cache: false })) - skipBack;
const byPool = new Map();
let total = 0;

for (let i = 0; i < windows; i++) {
  const to = head - i * span;
  const from = to - (span - 1);
  const logs = await rpc('eth_getLogs', [
    { fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16), address: PM, topics: [SWAP_TOPIC] },
  ]);
  total += logs.length;
  for (const l of logs) if (!byPool.has(l.topics[1])) byPool.set(l.topics[1], l.transactionHash);
  process.stderr.write(`${from}-${to}: ${logs.length} logs, ${byPool.size} pools\n`);
}

console.error(`\n${total} swap logs across ${byPool.size} distinct pools`);
writeFileSync(new URL(`./pools-${chain}-${event}.txt`, import.meta.url), [...byPool.values()].join('\n'));
