// M0 core: rebuild v4 flash-accounting deltas from a callTracer trace alone.
//
// The acid test is v4's own invariant: when unlock() returns, every
// (account, currency) delta must be exactly zero or PoolManager reverts.
// If our books balance for a real mined tx, the reconstruction is faithful.
import {
  POOL_MANAGER, HOOK_CALLBACKS, PM_METHODS, NATIVE, hookPermissions,
  selector, words, retWords, toAddress, toUint, toInt,
  unpackBalanceDelta, unpackBeforeSwapDelta,
  decodeSwapCall, decodeModifyLiquidityCall, decodeBeforeSwapCall, decodeAfterSwapCall,
  walk, walkEffective, eq,
} from './v4.mjs';

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** Signed per-(account, currency) ledger mirroring PoolManager's transient deltas. */
class Deltas {
  constructor() { this.m = new Map(); }
  key(a, c) { return `${a.toLowerCase()}|${c.toLowerCase()}`; }
  add(account, currency, amount) {
    if (!amount) return;
    const k = this.key(account, currency);
    this.m.set(k, (this.m.get(k) ?? 0n) + amount);
  }
  nonZero() {
    return [...this.m].filter(([, v]) => v !== 0n)
      .map(([k, v]) => { const [account, currency] = k.split('|'); return { account, currency, amount: v }; });
  }
}

/**
 * Resolve how much of a swap's value the hook kept for itself.
 *
 * v4 sums the hook's BeforeSwapDelta and its afterSwap return delta, maps them
 * onto the (specified, unspecified) currencies, credits that to the hook, and
 * subtracts it from the caller. Each half is honoured only if the hook address
 * carries the matching RETURNS_DELTA permission bit — a hook can return a
 * non-zero delta and have PoolManager discard it.
 */
function hookDeltaForSwap(swapFrame, key, params) {
  if (BigInt(key.hooks) === 0n) return null;
  const perms = hookPermissions(key.hooks);

  let specified = 0n;
  let unspecified = 0n;

  for (const child of swapFrame.calls ?? []) {
    if (child.error || !eq(child.to, key.hooks)) continue;
    const sel = selector(child.input);
    const out = retWords(child.output);
    if (HOOK_CALLBACKS[sel] === 'beforeSwap' && perms.BEFORE_SWAP_RETURNS_DELTA && out.length >= 2) {
      const bsd = unpackBeforeSwapDelta(out[1]);
      specified += bsd.deltaSpecified;
      unspecified += bsd.deltaUnspecified;
    } else if (HOOK_CALLBACKS[sel] === 'afterSwap' && perms.AFTER_SWAP_RETURNS_DELTA && out.length >= 2) {
      unspecified += toInt(out[1], 128);
    }
  }
  if (specified === 0n && unspecified === 0n) return null;

  const specifiedIsCurrency0 = (params.amountSpecified < 0n) === params.zeroForOne;
  return specifiedIsCurrency0
    ? { amount0: specified, amount1: unspecified }
    : { amount0: unspecified, amount1: specified };
}

export function reconstruct(root, { poolManager = POOL_MANAGER.unichain } = {}) {
  const PM = poolManager.toLowerCase();
  const deltas = new Deltas();
  const steps = [];
  const hooks = new Map();
  const warnings = [];
  let syncedCurrency = NATIVE; // PoolManager's transient "currency being settled"
  let seq = 0;

  const note = (step) => { steps.push({ seq: seq++, ...step }); return step; };

  for (const { frame, depth, path } of walkEffective(root)) {
    const sel = selector(frame.input);
    const to = frame.to?.toLowerCase();
    const from = frame.from?.toLowerCase();
    if (!sel || !to) continue;

    // ---- hook callbacks: identified by selector AND by being called from PoolManager
    if (HOOK_CALLBACKS[sel] && from === PM) {
      const name = HOOK_CALLBACKS[sel];
      if (!hooks.has(to)) hooks.set(to, { address: to, callbacks: new Set(), externalCalls: [] });
      hooks.get(to).callbacks.add(name);

      // What the hook itself reached out to, beyond PoolManager — these become
      // extra nodes in the graph (vaults, oracles, treasuries).
      for (const { frame: inner, depth: d } of walkEffective(frame)) {
        if (d > 0 && inner.to && inner.to.toLowerCase() !== PM) {
          hooks.get(to).externalCalls.push({ to: inner.to.toLowerCase(), selector: selector(inner.input), type: inner.type });
        }
      }

      if (name === 'beforeSwap') {
        // Delta accounting for swaps is done once, at the enclosing swap frame,
        // because v4 applies the BeforeSwapDelta whether or not afterSwap exists.
        const call = decodeBeforeSwapCall(frame.input);
        const out = retWords(frame.output);
        const bsd = out.length >= 2 ? unpackBeforeSwapDelta(out[1]) : { deltaSpecified: 0n, deltaUnspecified: 0n };
        note({ kind: 'hookCallback', name, hook: to, pool: call.key, beforeSwapDelta: bsd, depth });
      } else if (name === 'afterSwap') {
        const call = decodeAfterSwapCall(frame.input);
        const out = retWords(frame.output);
        const afterDelta = out.length >= 2 ? toInt(out[1], 128) : 0n;
        note({ kind: 'hookCallback', name, hook: to, pool: call.key, poolDelta: call.delta, afterSwapDelta: afterDelta, depth });
      } else {
        // after*Liquidity return (bytes4, BalanceDelta) credited to the hook
        const out = retWords(frame.output);
        if (/^after(Add|Remove)Liquidity$/.test(name) && out.length >= 2) {
          const w = words(frame.input);
          const key = { currency0: toAddress(w[1]), currency1: toAddress(w[2]) };
          const hd = unpackBalanceDelta(out[1]);
          deltas.add(to, key.currency0, hd.amount0);
          deltas.add(to, key.currency1, hd.amount1);
          note({ kind: 'hookCallback', name, hook: to, pool: key, hookDelta: hd, depth });
        } else {
          note({ kind: 'hookCallback', name, hook: to, depth });
        }
      }
      continue;
    }

    if (to !== PM) continue;
    const method = PM_METHODS[sel];
    if (!method) continue;
    const out = retWords(frame.output);

    switch (method) {
      case 'swap': {
        const { key, params } = decodeSwapCall(frame.input);
        const d = out.length >= 1 ? unpackBalanceDelta(out[0]) : { amount0: 0n, amount1: 0n };
        deltas.add(from, key.currency0, d.amount0);
        deltas.add(from, key.currency1, d.amount1);

        // The hook's own delta, resolved from this swap's direct callbacks.
        // v4 skips hook accounting entirely when the hook itself is the swapper.
        const hookDelta = eq(from, key.hooks) ? null : hookDeltaForSwap(frame, key, params);
        if (hookDelta) {
          deltas.add(key.hooks, key.currency0, hookDelta.amount0);
          deltas.add(key.hooks, key.currency1, hookDelta.amount1);
        }
        note({ kind: 'swap', caller: from, pool: key, params, callerDelta: d, hookDelta, depth });
        break;
      }
      case 'modifyLiquidity': {
        const { key, params } = decodeModifyLiquidityCall(frame.input);
        const d = out.length >= 1 ? unpackBalanceDelta(out[0]) : { amount0: 0n, amount1: 0n };
        const fees = out.length >= 2 ? unpackBalanceDelta(out[1]) : { amount0: 0n, amount1: 0n };
        deltas.add(from, key.currency0, d.amount0);
        deltas.add(from, key.currency1, d.amount1);
        note({ kind: 'modifyLiquidity', caller: from, pool: key, params, callerDelta: d, feesAccrued: fees, depth });
        break;
      }
      case 'donate': {
        const w = words(frame.input);
        const key = { currency0: toAddress(w[0]), currency1: toAddress(w[1]) };
        const d = out.length >= 1 ? unpackBalanceDelta(out[0]) : { amount0: 0n, amount1: 0n };
        deltas.add(from, key.currency0, d.amount0);
        deltas.add(from, key.currency1, d.amount1);
        note({ kind: 'donate', caller: from, pool: key, callerDelta: d, depth });
        break;
      }
      case 'take': {
        const w = words(frame.input);
        const currency = toAddress(w[0]);
        const recipient = toAddress(w[1]);
        const amount = toUint(w[2]);
        deltas.add(from, currency, -amount);
        note({ kind: 'take', caller: from, currency, recipient, amount, depth });
        break;
      }
      case 'sync': {
        syncedCurrency = toAddress(words(frame.input)[0]);
        note({ kind: 'sync', caller: from, currency: syncedCurrency, depth });
        break;
      }
      case 'settle':
      case 'settleFor': {
        const payer = method === 'settleFor' ? toAddress(words(frame.input)[0]) : from;
        const paid = out.length >= 1 ? toUint(out[0]) : 0n;
        const currency = syncedCurrency;
        deltas.add(payer, currency, paid);
        note({ kind: method, caller: from, payer, currency, amount: paid, native: eq(currency, NATIVE), depth });
        syncedCurrency = NATIVE; // reserves reset after settlement
        break;
      }
      case 'mint': {
        const w = words(frame.input);
        const recipient = toAddress(w[0]);
        const currency = '0x' + w[1].slice(24); // 6909 id is uint256(uint160(currency))
        const amount = toUint(w[2]);
        deltas.add(from, currency, -amount);
        note({ kind: 'mint6909', caller: from, recipient, currency, amount, depth });
        break;
      }
      case 'burn': {
        const w = words(frame.input);
        const holder = toAddress(w[0]);
        const currency = '0x' + w[1].slice(24);
        const amount = toUint(w[2]);
        deltas.add(from, currency, amount);
        note({ kind: 'burn6909', caller: from, holder, currency, amount, depth });
        break;
      }
      case 'clear': {
        const w = words(frame.input);
        const currency = toAddress(w[0]);
        const amount = toUint(w[1]);
        deltas.add(from, currency, -amount);
        note({ kind: 'clear', caller: from, currency, amount, depth });
        break;
      }
      case 'unlock':
        note({ kind: 'unlock', caller: from, depth });
        break;
      case 'initialize': {
        const w = words(frame.input);
        note({ kind: 'initialize', caller: from, pool: { currency0: toAddress(w[0]), currency1: toAddress(w[1]), hooks: toAddress(w[4]) }, depth });
        break;
      }
    }
  }

  const residual = deltas.nonZero();
  if (residual.length) warnings.push(`${residual.length} non-zero residual delta(s) — reconstruction incomplete`);

  return {
    steps,
    hooks: [...hooks.values()].map((h) => ({ ...h, callbacks: [...h.callbacks] })),
    residual,
    balanced: residual.length === 0,
    warnings,
  };
}

/** Ground truth: ERC20 Transfer events + native value moves, straight from the trace. */
export function externalTransfers(root) {
  const out = [];
  for (const { frame } of walkEffective(root)) {
    if (frame.value && BigInt(frame.value) > 0n) {
      out.push({ token: NATIVE, from: frame.from.toLowerCase(), to: frame.to.toLowerCase(), amount: BigInt(frame.value) });
    }
    for (const log of frame.logs ?? []) {
      if (log.topics?.[0] !== TRANSFER_TOPIC || log.topics.length < 3) continue;
      out.push({
        token: log.address.toLowerCase(),
        from: toAddress(log.topics[1].slice(2)),
        to: toAddress(log.topics[2].slice(2)),
        amount: BigInt(log.data === '0x' ? 0 : log.data),
      });
    }
  }
  return out;
}
