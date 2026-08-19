// Uniswap v4 constants and ABI-decoding helpers used by the spike.
// Hand-rolled decoding keeps the spike dependency-free; a real build would use viem.

export const POOL_MANAGER = {
  unichain: '0x1f98400000000000000000000000000000000004',
  ethereum: '0x000000000004444c5dc75cb358380d2e3de08a90',
  base: '0x498581ff718922c3f8e6a244956af099b2652b2b',
};

export const HOOK_CALLBACKS = {
  '0xdc98354e': 'beforeInitialize',
  '0x6fe7e6eb': 'afterInitialize',
  '0x259982e5': 'beforeAddLiquidity',
  '0x9f063efc': 'afterAddLiquidity',
  '0x21d0ee70': 'beforeRemoveLiquidity',
  '0x6c2bbe7e': 'afterRemoveLiquidity',
  '0x575e24b4': 'beforeSwap',
  '0xb47b2fb1': 'afterSwap',
  '0xb6a8b0fa': 'beforeDonate',
  '0xe1b4af69': 'afterDonate',
};

export const PM_METHODS = {
  '0xf3cd914c': 'swap',
  '0x5a6bcfda': 'modifyLiquidity',
  '0x234266d7': 'donate',
  '0x0b0d9c09': 'take',
  '0x11da60b4': 'settle',
  '0x3dd45adb': 'settleFor',
  '0xa5841194': 'sync',
  '0x80f0b44c': 'clear',
  '0x156e29f6': 'mint',
  '0xf5298aca': 'burn',
  '0x48c89491': 'unlock',
  '0x6276cbbe': 'initialize',
};

export const ERC20_METHODS = {
  '0xa9059cbb': 'transfer',
  '0x23b872dd': 'transferFrom',
  '0x095ea7b3': 'approve',
  '0x70a08231': 'balanceOf',
  '0xd0e30db0': 'deposit',
  '0x2e1a7d4d': 'withdraw',
};

// --- word-level ABI decoding -------------------------------------------------

export const selector = (data) => (data && data.length >= 10 ? data.slice(0, 10).toLowerCase() : null);

/** Split calldata (after the 4-byte selector) into 32-byte words. */
export function words(data) {
  const hex = data.slice(10);
  const out = [];
  for (let i = 0; i + 64 <= hex.length; i += 64) out.push(hex.slice(i, i + 64));
  return out;
}

/** Split a raw return blob (no selector) into 32-byte words. */
export function retWords(data) {
  const hex = (data ?? '0x').replace(/^0x/, '');
  const out = [];
  for (let i = 0; i + 64 <= hex.length; i += 64) out.push(hex.slice(i, i + 64));
  return out;
}

export const toAddress = (word) => '0x' + word.slice(24);
export const toUint = (word) => BigInt('0x' + word);

export function toInt(word, bits = 256) {
  const v = BigInt('0x' + word);
  const max = 1n << BigInt(bits - 1);
  return v >= max ? v - (1n << BigInt(bits)) : v;
}

/**
 * BalanceDelta is a packed int256: upper 128 bits = amount0, lower 128 = amount1.
 * Sign extension has to happen per-half, not on the whole word.
 */
export function unpackBalanceDelta(word) {
  const v = BigInt('0x' + word);
  const sext = (x) => (x >= 1n << 127n ? x - (1n << 128n) : x);
  return { amount0: sext(v >> 128n), amount1: sext(v & ((1n << 128n) - 1n)) };
}

/** BeforeSwapDelta packs (deltaSpecified, deltaUnspecified) the same way. */
export function unpackBeforeSwapDelta(word) {
  const { amount0, amount1 } = unpackBalanceDelta(word);
  return { deltaSpecified: amount0, deltaUnspecified: amount1 };
}

/** PoolKey is 5 head words: currency0, currency1, fee, tickSpacing, hooks. */
export function decodePoolKey(w, offset) {
  return {
    currency0: toAddress(w[offset]),
    currency1: toAddress(w[offset + 1]),
    fee: Number(toUint(w[offset + 2])),
    tickSpacing: Number(toInt(w[offset + 3], 24)),
    hooks: toAddress(w[offset + 4]),
  };
}

/** poolManager.swap(PoolKey, SwapParams, bytes) — all head words, no dynamic offsets before them. */
export function decodeSwapCall(data) {
  const w = words(data);
  return {
    key: decodePoolKey(w, 0),
    params: {
      zeroForOne: toUint(w[5]) === 1n,
      amountSpecified: toInt(w[6]),
      sqrtPriceLimitX96: toUint(w[7]),
    },
  };
}

export function decodeModifyLiquidityCall(data) {
  const w = words(data);
  return {
    key: decodePoolKey(w, 0),
    params: {
      tickLower: Number(toInt(w[5], 24)),
      tickUpper: Number(toInt(w[6], 24)),
      liquidityDelta: toInt(w[7]),
      salt: '0x' + w[8],
    },
  };
}

/** hook.beforeSwap(sender, PoolKey, SwapParams, bytes) */
export function decodeBeforeSwapCall(data) {
  const w = words(data);
  return {
    sender: toAddress(w[0]),
    key: decodePoolKey(w, 1),
    params: {
      zeroForOne: toUint(w[6]) === 1n,
      amountSpecified: toInt(w[7]),
      sqrtPriceLimitX96: toUint(w[8]),
    },
  };
}

/** hook.afterSwap(sender, PoolKey, SwapParams, BalanceDelta, bytes) */
export function decodeAfterSwapCall(data) {
  const w = words(data);
  return {
    sender: toAddress(w[0]),
    key: decodePoolKey(w, 1),
    params: {
      zeroForOne: toUint(w[6]) === 1n,
      amountSpecified: toInt(w[7]),
      sqrtPriceLimitX96: toUint(w[8]),
    },
    delta: unpackBalanceDelta(w[9]),
  };
}

// v4 encodes a hook's permissions in the low 14 bits of its own address.
// This matters for reconstruction: a hook can *return* a delta and have it
// silently ignored by PoolManager if the corresponding RETURNS_DELTA bit is unset.
export const HOOK_FLAGS = {
  BEFORE_INITIALIZE: 1 << 13,
  AFTER_INITIALIZE: 1 << 12,
  BEFORE_ADD_LIQUIDITY: 1 << 11,
  AFTER_ADD_LIQUIDITY: 1 << 10,
  BEFORE_REMOVE_LIQUIDITY: 1 << 9,
  AFTER_REMOVE_LIQUIDITY: 1 << 8,
  BEFORE_SWAP: 1 << 7,
  AFTER_SWAP: 1 << 6,
  BEFORE_DONATE: 1 << 5,
  AFTER_DONATE: 1 << 4,
  BEFORE_SWAP_RETURNS_DELTA: 1 << 3,
  AFTER_SWAP_RETURNS_DELTA: 1 << 2,
  AFTER_ADD_LIQUIDITY_RETURNS_DELTA: 1 << 1,
  AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA: 1 << 0,
};

export function hookPermissions(address) {
  const bits = Number(BigInt(address) & 0x3fffn);
  const out = { bits };
  for (const [name, flag] of Object.entries(HOOK_FLAGS)) out[name] = (bits & flag) !== 0;
  return out;
}

export const hookPermissionNames = (address) =>
  Object.entries(HOOK_FLAGS).filter(([, f]) => (Number(BigInt(address) & 0x3fffn) & f) !== 0).map(([n]) => n);

export const NATIVE = '0x0000000000000000000000000000000000000000';
export const eq = (a, b) => a?.toLowerCase() === b?.toLowerCase();

/**
 * Depth-first walk over a callTracer frame tree.
 *
 * `reverted` is true when the frame itself OR any ancestor reverted. This matters:
 * a router that simulates a swap inside try/catch and reverts to undo it leaves
 * *successful* child frames under a reverted parent. Counting those draws flows
 * that never happened, so callers must skip anything with reverted === true.
 */
export function* walk(frame, depth = 0, path = [], reverted = false) {
  const isReverted = reverted || Boolean(frame.error) || Boolean(frame.revertReason);
  yield { frame, depth, path, reverted: isReverted };
  const kids = frame.calls ?? [];
  for (let i = 0; i < kids.length; i++) yield* walk(kids[i], depth + 1, [...path, i], isReverted);
}

/** Only the frames that actually took effect on chain. */
export function* walkEffective(frame) {
  for (const node of walk(frame)) if (!node.reverted) yield node;
}
