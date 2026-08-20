// Emit the 기획서 §7 data model from a reconstructed trace.
// Proves M0's output plugs straight into M1's renderer without another decode pass.
import { readFileSync } from 'node:fs';
import { trace } from './rpc.mjs';
import { reconstruct } from './reconstruct.mjs';

// 훅 주소 → 앱 이름 (구 M4). known-hooks.json 은 수동 관리.
const KNOWN = JSON.parse(readFileSync(new URL('./known-hooks.json', import.meta.url), 'utf8'));
import { POOL_MANAGER, NATIVE, hookPermissionNames, eq } from './v4.mjs';

const CHAIN = process.env.CHAIN ?? 'unichain';
const PM = POOL_MANAGER[CHAIN];

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function toGraph(root, { chain = CHAIN, txHash } = {}) {
  const r = reconstruct(root, { poolManager: PM });
  const origin = root.from?.toLowerCase() ?? null; // the EOA that sent the tx

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
      known: KNOWN[h.address]?.name ?? null,
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
    if (!nodes.has(id)) addNode(id, addr === origin ? 'eoa' : 'router', short(addr), { address: addr, known: null });
    return id;
  };

  const edges = [];

  /**
   * Edges come in two layers, and mixing them double-counts.
   *
   *   settlement — value that actually moved (settle/take/mint/burn/clear).
   *                Flash accounting guarantees these fully describe the transfer.
   *   accounting — the obligations that explain it (swap/liquidity deltas, the
   *                hook's cut). Same value, seen from the other side of the ledger.
   *
   * trader mode renders settlement; engineer mode overlays accounting (§4).
   */
  const push = (layer, from, to, token, amount, engineer, extra = {}) => {
    if (amount === 0n) return;
    edges.push({
      layer, from, to,
      token: token === NATIVE ? 'native' : token,
      amount: (amount < 0n ? -amount : amount).toString(),
      engineer,
      ...extra,
    });
  };

  // A settlement whose caller is neither endpoint passes *through* that actor —
  // typically a hook minting its fee onward to a treasury. Routing the edge through
  // it is what makes "훅이 뭘 했는지" legible instead of a footnote.
  const settle = (from, to, token, amount, engineer, extra = {}) => {
    const via = extra.via && extra.via !== from && extra.via !== to ? extra.via : null;
    const { via: _drop, ...rest } = extra;
    push('settlement', from, to, token, amount, engineer, { ...rest, via });
  };

  for (const s of r.steps) {
    switch (s.kind) {
      case 'swap': {
        const caller = ensureActor(s.caller);
        const { currency0: c0, currency1: c1 } = s.pool;
        const d = s.callerDelta;
        // negative delta = caller owes the pool; positive = pool owes the caller
        const swapNote = { call: 'swap', zeroForOne: s.params.zeroForOne };
        if (d.amount0 < 0n) push('accounting', caller, 'pm', c0, d.amount0, { ...swapNote, side: 'in', delta: d.amount0.toString() });
        if (d.amount1 < 0n) push('accounting', caller, 'pm', c1, d.amount1, { ...swapNote, side: 'in', delta: d.amount1.toString() });
        if (d.amount0 > 0n) push('accounting', 'pm', caller, c0, d.amount0, { ...swapNote, side: 'out', delta: d.amount0.toString() });
        if (d.amount1 > 0n) push('accounting', 'pm', caller, c1, d.amount1, { ...swapNote, side: 'out', delta: d.amount1.toString() });

        if (s.hookDelta) {
          const hid = hookIds.get(s.pool.hooks.toLowerCase()) ?? ensureActor(s.pool.hooks.toLowerCase());
          const label = { call: 'beforeSwap/afterSwap returnDelta', note: '훅이 가져간 몫' };
          for (const [amt, cur] of [[s.hookDelta.amount0, c0], [s.hookDelta.amount1, c1]]) {
            if (amt > 0n) push('accounting', 'pm', hid, cur, amt, { ...label, delta: amt.toString() }, { hookCut: true });
            if (amt < 0n) push('accounting', hid, 'pm', cur, amt, { ...label, delta: amt.toString() }, { hookCut: true });
          }
        }
        break;
      }
      case 'take':
        settle('pm', ensureActor(s.recipient), s.currency, s.amount, { call: 'take' }, { via: ensureActor(s.caller) });
        break;
      case 'settle':
      case 'settleFor':
        settle(ensureActor(s.payer), 'pm', s.currency, s.amount, { call: s.kind, native: s.native }, { via: ensureActor(s.caller) });
        break;
      case 'mint6909':
        // ERC-6909 claims never leave PoolManager, so no ERC20 Transfer is emitted.
        settle('pm', ensureActor(s.recipient), s.currency, s.amount,
          { call: 'mint', note: 'ERC-6909 청구권 — Transfer 이벤트 없음' },
          { via: ensureActor(s.caller), claim: true, hidden: true });
        break;
      case 'burn6909':
        settle(ensureActor(s.holder), 'pm', s.currency, s.amount,
          { call: 'burn', note: 'ERC-6909 청구권 — Transfer 이벤트 없음' },
          { via: ensureActor(s.caller), claim: true, hidden: true });
        break;
      case 'clear':
        settle(ensureActor(s.caller), 'pm', s.currency, s.amount,
          { call: 'clear', note: '잔여 크레딧 포기' }, { hidden: true });
        break;
      case 'modifyLiquidity': {
        const caller = ensureActor(s.caller);
        const { currency0: c0, currency1: c1 } = s.pool;
        const d = s.callerDelta;
        for (const [amt, cur] of [[d.amount0, c0], [d.amount1, c1]]) {
          if (amt < 0n) push('accounting', caller, 'pm', cur, amt, { call: 'modifyLiquidity', delta: amt.toString() });
          if (amt > 0n) push('accounting', 'pm', caller, cur, amt, { call: 'modifyLiquidity', delta: amt.toString() });
        }
        break;
      }
    }
  }

  // hook -> external contract edges carry no amount; they show reach, not value
  for (const h of r.hooks) {
    for (const target of new Set(h.externalCalls.map((c) => c.to))) {
      const calls = h.externalCalls.filter((c) => c.to === target);
      edges.push({
        layer: 'reach', from: hookIds.get(h.address), to: `ext:${target}`,
        token: null, amount: null, via: null,
        engineer: { call: 'external call', count: calls.length },
      });
    }
  }

  return { txHash, chain, origin, nodes: [...nodes.values()], edges, balanced: r.balanced };
}

// CLI only when run directly — this module is also imported by curate.mjs.
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const hash = process.argv[2];
  if (hash) console.log(JSON.stringify(toGraph(await trace(hash), { txHash: hash }), null, 2));
}
