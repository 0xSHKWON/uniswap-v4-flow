// M0 verification harness.
//
// PASS criteria per tx:
//   1. balanced   — every (account, currency) delta nets to zero, as v4 requires
//   2. netMatch   — reconstructed net settlement per account matches the real
//                   ERC20 Transfer / native value moves observed in the trace
//   3. hookVisible— if the pool has a hook, its callbacks and deltas were recovered
import { readFileSync } from 'node:fs';
import { trace } from './rpc.mjs';
import { reconstruct, externalTransfers } from './reconstruct.mjs';
import { POOL_MANAGER } from './v4.mjs';

const CHAIN = process.env.CHAIN ?? 'unichain';
const PM = POOL_MANAGER[CHAIN];

/**
 * From external transfers, compute each account's net movement of each token.
 * PoolManager's own net movement should mirror the sum of settle/take activity.
 */
function netByAccount(transfers) {
  const m = new Map();
  for (const t of transfers) {
    const bump = (acct, amt) => {
      const k = `${acct}|${t.token}`;
      m.set(k, (m.get(k) ?? 0n) + amt);
    };
    bump(t.from, -t.amount);
    bump(t.to, t.amount);
  }
  return m;
}

/**
 * Cross-check: the sum of settle amounts minus take amounts, per currency,
 * must equal PoolManager's real net token inflow for that currency.
 * This is the check that proves the amounts are right, not just internally consistent.
 */
function checkSettlementVsTransfers(result, transfers) {
  const recon = new Map(); // currency -> net into PoolManager
  for (const s of result.steps) {
    if (s.kind === 'settle' || s.kind === 'settleFor') {
      recon.set(s.currency, (recon.get(s.currency) ?? 0n) + s.amount);
    } else if (s.kind === 'take') {
      recon.set(s.currency, (recon.get(s.currency) ?? 0n) - s.amount);
    }
  }
  const real = netByAccount(transfers);
  const rows = [];
  for (const [currency, reconAmt] of recon) {
    // Native ETH settled via msg.value shows up as a value-bearing frame into PM.
    const realAmt = real.get(`${PM}|${currency}`) ?? 0n;
    rows.push({ currency, recon: reconAmt, real: realAmt, match: reconAmt === realAmt });
  }
  return rows;
}

const fmt = (n) => (n < 0n ? '-' : '+') + (n < 0n ? -n : n).toString();
const short = (a) => (a ? a.slice(0, 10) + '…' : '?');

async function verifyOne(hash, { verbose = false } = {}) {
  const t = await trace(hash);
  const result = reconstruct(t, { poolManager: PM });
  const transfers = externalTransfers(t);
  const settleRows = checkSettlementVsTransfers(result, transfers);

  const netMatch = settleRows.every((r) => r.match);
  const hasHook = result.hooks.length > 0;
  const hookVisible = !hasHook || result.hooks.every((h) => h.callbacks.length > 0);
  const pass = result.balanced && netMatch && hookVisible;

  if (verbose) {
    console.log(`\n${'='.repeat(78)}\n${hash}\n${'='.repeat(78)}`);
    console.log(`steps=${result.steps.length} hooks=${result.hooks.length} transfers=${transfers.length}`);
    console.log('\n--- reconstructed steps ---');
    for (const s of result.steps) {
      const pad = '  '.repeat(Math.max(0, s.depth - 1));
      let line = `${pad}${s.kind}`;
      if (s.kind === 'swap') {
        line += ` caller=${short(s.caller)} hook=${short(s.pool.hooks)} delta0=${fmt(s.callerDelta.amount0)} delta1=${fmt(s.callerDelta.amount1)}`;
        if (s.hookDelta) line += ` hookKeeps=(${fmt(s.hookDelta.amount0)},${fmt(s.hookDelta.amount1)})`;
      } else if (s.kind === 'hookCallback') {
        line += `:${s.name} hook=${short(s.hook)}`;
        if (s.beforeSwapDelta) line += ` bsd=(${fmt(s.beforeSwapDelta.deltaSpecified)},${fmt(s.beforeSwapDelta.deltaUnspecified)})`;
        if (s.afterSwapDelta !== undefined) line += ` afterDelta=${fmt(s.afterSwapDelta)}`;
        if (s.hookDelta) line += ` hookDelta=(${fmt(s.hookDelta.amount0)},${fmt(s.hookDelta.amount1)})`;
      } else if (s.kind === 'take' || s.kind === 'settle' || s.kind === 'settleFor' || s.kind === 'mint6909' || s.kind === 'burn6909' || s.kind === 'clear') {
        line += ` by=${short(s.caller)} ${short(s.currency)} amount=${s.amount}`;
        if (s.recipient) line += ` -> ${short(s.recipient)}`;
      } else if (s.kind === 'sync') {
        line += ` ${short(s.currency)}`;
      } else if (s.kind === 'modifyLiquidity') {
        line += ` caller=${short(s.caller)} delta0=${fmt(s.callerDelta.amount0)} delta1=${fmt(s.callerDelta.amount1)}`;
      }
      console.log(line);
    }
    console.log('\n--- settle/take vs real token transfers (into PoolManager) ---');
    for (const r of settleRows) {
      console.log(`  ${r.match ? 'OK  ' : 'FAIL'} ${short(r.currency)} recon=${fmt(r.recon)} real=${fmt(r.real)}`);
    }
    if (result.residual.length) {
      console.log('\n--- UNBALANCED residual deltas ---');
      for (const r of result.residual) console.log(`  ${short(r.account)} ${short(r.currency)} ${fmt(r.amount)}`);
    }
    for (const h of result.hooks) {
      const targets = [...new Set(h.externalCalls.map((c) => c.to))];
      console.log(`\n  hook ${h.address} [${h.callbacks.join(', ')}] reaches ${targets.length} external contract(s)`);
      for (const tg of targets.slice(0, 8)) console.log(`    -> ${tg}`);
    }
  }

  return { hash, pass, balanced: result.balanced, netMatch, hookVisible, hasHook, steps: result.steps.length, hooks: result.hooks.length, residual: result.residual, settleRows };
}

// --- entrypoint --------------------------------------------------------------
const args = process.argv.slice(2);
const verbose = args.includes('-v');
const fileArg = args.indexOf('--file');
const hashes = fileArg >= 0
  ? readFileSync(args[fileArg + 1], 'utf8').trim().split('\n').filter(Boolean)
  : args.filter((a) => a.startsWith('0x'));

const results = [];
for (const h of hashes) {
  try {
    results.push(await verifyOne(h, { verbose }));
  } catch (e) {
    results.push({ hash: h, pass: false, error: e.message });
  }
}

console.log(`\n${'='.repeat(78)}\nM0 RESULT\n${'='.repeat(78)}`);
const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad('tx', 22)} ${pad('bal', 5)} ${pad('net', 5)} ${pad('hook', 5)} steps  hooks`);
for (const r of results) {
  if (r.error) { console.log(`${pad(r.hash.slice(0, 20), 22)} ERROR ${r.error}`); continue; }
  console.log(`${pad(r.hash.slice(0, 20), 22)} ${pad(r.balanced ? 'ok' : 'FAIL', 5)} ${pad(r.netMatch ? 'ok' : 'FAIL', 5)} ${pad(r.hasHook ? (r.hookVisible ? 'yes' : 'FAIL') : '-', 5)} ${pad(r.steps, 6)} ${r.hooks}`);
}
const passed = results.filter((r) => r.pass).length;
const hooked = results.filter((r) => r.hasHook).length;
console.log(`\n${passed}/${results.length} fully reconstructed  (${hooked} involved hooks)`);
