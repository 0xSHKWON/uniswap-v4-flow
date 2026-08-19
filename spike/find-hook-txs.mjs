// Scan recent PoolManager Swap logs, trace each tx, and report which ones
// actually invoke a hook callback (and how much extra machinery the hook runs).
import { readFileSync, writeFileSync } from 'node:fs';
import { rpc, trace } from './rpc.mjs';
import { POOL_MANAGER, HOOK_CALLBACKS, PM_METHODS, selector, walk, eq } from './v4.mjs';

const SWAP_TOPIC = '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f';
const PM = POOL_MANAGER[process.env.CHAIN ?? 'unichain'];

async function recentSwapTxs(blockSpan = 400, limit = 40) {
  const head = Number(await rpc('eth_blockNumber', [], { cache: false }));
  const from = '0x' + (head - blockSpan).toString(16);
  const logs = await rpc('eth_getLogs', [
    { fromBlock: from, toBlock: '0x' + head.toString(16), address: PM, topics: [SWAP_TOPIC] },
  ]);
  return [...new Set(logs.map((l) => l.transactionHash))].slice(0, limit);
}

function summarize(hash, root) {
  const hooks = new Map(); // hook address -> callbacks seen
  let pmCalls = 0;
  let external = 0; // calls made by a hook to something that is not the PoolManager

  for (const { frame } of walk(root)) {
    const sel = selector(frame.input);
    if (eq(frame.to, PM) && PM_METHODS[sel]) pmCalls++;
    if (HOOK_CALLBACKS[sel] && eq(frame.from, PM)) {
      const to = frame.to.toLowerCase();
      if (!hooks.has(to)) hooks.set(to, new Set());
      hooks.get(to).add(HOOK_CALLBACKS[sel]);
      // count everything the hook does beneath its own callback
      for (const { frame: inner, depth } of walk(frame)) {
        if (depth > 0 && !eq(inner.to, PM)) external++;
      }
    }
  }
  return {
    hash,
    hooks: [...hooks].map(([addr, cbs]) => ({ addr, callbacks: [...cbs] })),
    pmCalls,
    hookExternalCalls: external,
    frames: [...walk(root)].length,
  };
}

const hashes = process.argv[2] === '--file'
  ? readFileSync(process.argv[3], 'utf8').trim().split('\n')
  : await recentSwapTxs();

const rows = [];
for (const h of hashes) {
  try {
    rows.push(summarize(h, await trace(h)));
    process.stderr.write('.');
  } catch (e) {
    process.stderr.write('x');
  }
}
process.stderr.write('\n');

const hooked = rows.filter((r) => r.hooks.length > 0);
hooked.sort((a, b) => b.hookExternalCalls - a.hookExternalCalls || b.frames - a.frames);

console.log(`traced ${rows.length} txs, ${hooked.length} touch a hook\n`);
for (const r of hooked) {
  console.log(`${r.hash}  frames=${r.frames} pmCalls=${r.pmCalls} hookExtCalls=${r.hookExternalCalls}`);
  for (const h of r.hooks) console.log(`    ${h.addr}  [${h.callbacks.join(', ')}]`);
}
writeFileSync(new URL('./hooked.json', import.meta.url), JSON.stringify(hooked, null, 2));
