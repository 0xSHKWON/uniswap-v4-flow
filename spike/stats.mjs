// Quantifies the project's core premise (기획서 §5.1):
// how much of a v4 transaction's flow is invisible to a Transfer-event-based tool.
import { readFileSync } from 'node:fs';
import { trace } from './rpc.mjs';
import { reconstruct, externalTransfers } from './reconstruct.mjs';
import { POOL_MANAGER, hookPermissionNames } from './v4.mjs';

const CHAIN = process.env.CHAIN ?? 'unichain';
const PM = POOL_MANAGER[CHAIN];

const files = process.argv.slice(2);
const hashes = [...new Set(files.flatMap((f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean)))];

let traced = 0, balanced = 0, withHook = 0, hookTookValue = 0;
let totalEdges = 0, totalTransfers = 0, hookValueInvisible = 0;
const mechanisms = new Map();
let hookedEdges = 0, hookedTransfers = 0;
const hookRegistry = new Map();

// Steps that represent an actual movement of value — i.e. an edge in the diagram.
const VALUE_STEPS = new Set(['swap', 'modifyLiquidity', 'donate', 'take', 'settle', 'settleFor', 'mint6909', 'burn6909', 'clear']);

for (const h of hashes) {
  let t;
  try { t = await trace(h); } catch { continue; }
  traced++;

  const r = reconstruct(t, { poolManager: PM });
  const transfers = externalTransfers(t);
  if (r.balanced) balanced++;

  const edges = r.steps.filter((s) => VALUE_STEPS.has(s.kind)).length
    + r.steps.filter((s) => s.kind === 'swap' && s.hookDelta).length;
  totalEdges += edges;
  totalTransfers += transfers.length;

  if (r.hooks.length) {
    withHook++;
    hookedEdges += edges;
    hookedTransfers += transfers.length;
    const hookAddrs = new Set(r.hooks.map((hk) => hk.address));
    const valueSteps = r.steps.filter((s) =>
      (s.kind === 'swap' && s.hookDelta) ||
      (s.kind === 'hookCallback' && s.hookDelta) ||
      (['take', 'settle', 'settleFor', 'mint6909', 'burn6909', 'clear'].includes(s.kind) && hookAddrs.has(s.caller)));

    if (valueSteps.length) {
      hookTookValue++;
      // Would a Transfer-event-based explorer see any of this?
      const transferTouchesHook = transfers.some((t) => hookAddrs.has(t.from) || hookAddrs.has(t.to));
      if (!transferTouchesHook) hookValueInvisible++;
      // How the hook took its cut — this drives which node/edge types the UI needs.
      for (const s of valueSteps) mechanisms.set(s.kind, (mechanisms.get(s.kind) ?? 0) + 1);
    }

    for (const hk of r.hooks) {
      if (!hookRegistry.has(hk.address)) {
        hookRegistry.set(hk.address, { address: hk.address, txs: 0, callbacks: new Set(), externals: new Set() });
      }
      const rec = hookRegistry.get(hk.address);
      rec.txs++;
      hk.callbacks.forEach((c) => rec.callbacks.add(c));
      hk.externalCalls.forEach((c) => rec.externals.add(c.to));
    }
  }
}

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : '0.0') + '%';

console.log(`
=== M0 corpus statistics (${CHAIN}) ===
transactions traced        ${traced}
delta-balanced             ${balanced}  (${pct(balanced, traced)})
involving a hook           ${withHook}  (${pct(withHook, traced)})
hook moved value           ${hookTookValue}  (${pct(hookTookValue, withHook)} of hooked txs)

--- the core premise (§5.1) ---
hook moved value           ${hookTookValue}
  ...yet NO ERC20 Transfer event touches the hook address:
  INVISIBLE to Transfer-based tools   ${hookValueInvisible} / ${hookTookValue}  (${pct(hookValueInvisible, hookTookValue)})

--- how hooks take their cut (drives edge types in the UI) ---
${[...mechanisms].sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${k.padEnd(20)} ${v}`).join('\n')}

--- distinct hooks observed: ${hookRegistry.size} ---`);

const sorted = [...hookRegistry.values()].sort((a, b) => b.txs - a.txs);
for (const h of sorted.slice(0, 15)) {
  console.log(`  ${h.address}  txs=${String(h.txs).padStart(3)}  ext=${String(h.externals.size).padStart(2)}  [${hookPermissionNames(h.address).join(',')}]`);
}
const withExternals = sorted.filter((h) => h.externals.size > 0).length;
console.log(`\n  ${withExternals}/${hookRegistry.size} hooks call out to contracts beyond PoolManager`);
console.log(`  (each becomes an extra node in the graph — 기획서 §7 "노드 타입을 열린 집합으로")`);
