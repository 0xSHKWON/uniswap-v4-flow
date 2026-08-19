// Pick the Unichain transactions that make the best 예시 해시 buttons (기획서 §6).
//
// On Unichain only ~26% of transactions touch a hook, so a random hash usually
// renders a boring two-arrow diagram. The landing examples have to be chosen, not
// sampled — each one should show something a Transfer-based explorer cannot.
import { readFileSync, writeFileSync } from 'node:fs';
import { trace } from './rpc.mjs';
import { reconstruct, externalTransfers } from './reconstruct.mjs';
import { toGraph } from './graph.mjs';
import { POOL_MANAGER, hookPermissionNames } from './v4.mjs';

const CHAIN = process.env.CHAIN ?? 'unichain';
const PM = POOL_MANAGER[CHAIN];
const hashes = readFileSync(process.argv[2], 'utf8').match(/0x[0-9a-f]{64}/g) ?? [];

const rows = [];
for (const hash of hashes) {
  let t;
  try { t = await trace(hash); } catch { continue; }
  const r = reconstruct(t, { poolManager: PM });
  if (!r.balanced || !r.hooks.length) continue;

  const g = toGraph(t, { txHash: hash, chain: CHAIN });
  const hookAddrs = new Set(r.hooks.map((h) => h.address));
  const transfers = externalTransfers(t);

  // Value the hook moved that leaves no ERC20 Transfer trace — the whole point.
  const hiddenEdges = g.edges.filter((e) => e.engineer?.note && e.amount);
  const transferTouchesHook = transfers.some((x) => hookAddrs.has(x.from) || hookAddrs.has(x.to));
  const externalReach = new Set(r.hooks.flatMap((h) => h.externalCalls.map((c) => c.to))).size;

  // Legible on one screen without scrolling (기획서 §6).
  const nodes = g.nodes.length;
  const fits = nodes <= 12;

  const score =
    (hiddenEdges.length ? 40 : 0) +          // shows invisible value — the core claim
    (!transferTouchesHook ? 25 : 0) +        // hook absent from Transfer log entirely
    Math.min(externalReach, 5) * 6 +         // hook reaching other protocols = richer graph
    (fits ? 20 : 0) +                        // readable at a glance
    r.hooks.length * 5;

  rows.push({
    hash, score, nodes, edges: g.edges.length,
    hooks: r.hooks.length, hiddenEdges: hiddenEdges.length,
    externalReach, transferTouchesHook,
    permissions: r.hooks.map((h) => hookPermissionNames(h.address)),
    hookAddrs: [...hookAddrs],
  });
}

rows.sort((a, b) => b.score - a.score);
console.log(`${rows.length} balanced hooked txs on ${CHAIN}\n`);
for (const r of rows.slice(0, 12)) {
  console.log(`score=${String(r.score).padStart(3)}  ${r.hash}`);
  console.log(`     nodes=${r.nodes} edges=${r.edges} hooks=${r.hooks} hiddenValueEdges=${r.hiddenEdges} extReach=${r.externalReach} inTransferLog=${r.transferTouchesHook}`);
}
writeFileSync(new URL(`./curated-${CHAIN}.json`, import.meta.url), JSON.stringify(rows, null, 2));
