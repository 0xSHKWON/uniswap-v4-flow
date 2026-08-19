// Emit the 기획서 §7 data model from a reconstructed trace.
// Proves M0's output plugs straight into M1's renderer without another decode pass.
import { trace } from './rpc.mjs';
import { reconstruct } from './reconstruct.mjs';
import { POOL_MANAGER, NATIVE, hookPermissionNames, eq } from './v4.mjs';

const CHAIN = process.env.CHAIN ?? 'unichain';
const PM = POOL_MANAGER[CHAIN];

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function toGraph(root, { chain = CHAIN, txHash } = {}) {
  const r = reconstruct(root, { poolManager: PM });

  const nodes = new Map();
  const addNode = (id, type, label, extra = {}) => {
    if (!nodes.has(id)) nodes.set(id, { id, type, label, ...extra });
    return nodes.get(id);
  };
  addNode('pm', 'core', 'PoolManager', { address: PM });

  const hookIds = new Map();
  for (const h of r.hooks) {
    const id = `hook:${h.address}`;
    hookIds.set(h.address, id);
    addNode(id, 'hook', short(h.address), {
      address: h.address,
      known: null, // filled by the M4 address→protocol table
      permissions: hookPermissionNames(h.address),
      callbacks: h.callbacks,
    });
    // §7: "노드 종류는 훅마다 달라진다" — whatever the hook reached becomes its own node.
    for (const target of new Set(h.externalCalls.map((c) => c.to))) {
      addNode(`ext:${target}`, 'external', short(target), { address: target, known: null });
    }
  }

  const actorId = (addr) => {
    if (eq(addr, PM)) return 'pm';
    if (hookIds.has(addr)) return hookIds.get(addr);
    return `actor:${addr}`;
  };
  const ensureActor = (addr) => {
    const id = actorId(addr);
    if (!nodes.has(id)) addNode(id, 'router', short(addr), { address: addr, known: null });
    return id;
  };

  const edges = [];
  const push = (from, to, token, amount, engineer) => {
    if (amount === 0n) return;
    edges.push({
      from, to,
      token: token === NATIVE ? 'native' : token,
      amount: (amount < 0n ? -amount : amount).toString(),
      engineer,
    });
  };

  for (const s of r.steps) {
    switch (s.kind) {
      case 'swap': {
        const caller = ensureActor(s.caller);
        const { currency0: c0, currency1: c1 } = s.pool;
        const d = s.callerDelta;
        // negative delta = caller owes the pool; positive = pool owes the caller
        if (d.amount0 < 0n) push(caller, 'pm', c0, d.amount0, { call: 'swap', side: 'in', delta: d.amount0.toString() });
        if (d.amount1 < 0n) push(caller, 'pm', c1, d.amount1, { call: 'swap', side: 'in', delta: d.amount1.toString() });
        if (d.amount0 > 0n) push('pm', caller, c0, d.amount0, { call: 'swap', side: 'out', delta: d.amount0.toString() });
        if (d.amount1 > 0n) push('pm', caller, c1, d.amount1, { call: 'swap', side: 'out', delta: d.amount1.toString() });

        if (s.hookDelta) {
          const hid = hookIds.get(s.pool.hooks.toLowerCase()) ?? ensureActor(s.pool.hooks.toLowerCase());
          const label = { call: 'beforeSwap/afterSwap returnDelta', note: 'hook fee — no ERC20 Transfer emitted' };
          if (s.hookDelta.amount0 > 0n) push('pm', hid, c0, s.hookDelta.amount0, { ...label, delta: s.hookDelta.amount0.toString() });
          if (s.hookDelta.amount1 > 0n) push('pm', hid, c1, s.hookDelta.amount1, { ...label, delta: s.hookDelta.amount1.toString() });
          if (s.hookDelta.amount0 < 0n) push(hid, 'pm', c0, s.hookDelta.amount0, { ...label, delta: s.hookDelta.amount0.toString() });
          if (s.hookDelta.amount1 < 0n) push(hid, 'pm', c1, s.hookDelta.amount1, { ...label, delta: s.hookDelta.amount1.toString() });
        }
        break;
      }
      case 'take':
        push('pm', ensureActor(s.recipient), s.currency, s.amount, { call: 'take', by: s.caller });
        break;
      case 'settle':
      case 'settleFor':
        push(ensureActor(s.payer), 'pm', s.currency, s.amount, { call: s.kind, native: s.native });
        break;
      case 'mint6909':
        push('pm', ensureActor(s.recipient), s.currency, s.amount, {
          call: 'mint (ERC-6909 claim)', note: 'stays inside PoolManager — invisible to Transfer-based tools',
        });
        break;
      case 'burn6909':
        push(ensureActor(s.holder), 'pm', s.currency, s.amount, { call: 'burn (ERC-6909 claim)' });
        break;
      case 'modifyLiquidity': {
        const caller = ensureActor(s.caller);
        const { currency0: c0, currency1: c1 } = s.pool;
        const d = s.callerDelta;
        if (d.amount0 !== 0n) (d.amount0 < 0n ? push(caller, 'pm', c0, d.amount0, { call: 'modifyLiquidity' }) : push('pm', caller, c0, d.amount0, { call: 'modifyLiquidity' }));
        if (d.amount1 !== 0n) (d.amount1 < 0n ? push(caller, 'pm', c1, d.amount1, { call: 'modifyLiquidity' }) : push('pm', caller, c1, d.amount1, { call: 'modifyLiquidity' }));
        break;
      }
    }
  }

  // hook -> external contract edges carry no amount; they show reach, not value
  for (const h of r.hooks) {
    for (const target of new Set(h.externalCalls.map((c) => c.to))) {
      edges.push({ from: hookIds.get(h.address), to: `ext:${target}`, token: null, amount: null, engineer: { call: 'external call' } });
    }
  }

  return { txHash, chain, nodes: [...nodes.values()], edges, balanced: r.balanced };
}

// CLI only when run directly — this module is also imported by curate.mjs.
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const hash = process.argv[2];
  if (hash) console.log(JSON.stringify(toGraph(await trace(hash), { txHash: hash }), null, 2));
}
