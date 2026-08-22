// 코퍼스에서 관측된 훅들의 레지스트리를 뽑는다 (체인 무관, CHAIN env로 선택).
// 출력: hook-registry-<chain>.json — 앱 카탈로그 큐레이션의 원재료.
//   node build-hook-registry.mjs --file corpus-base.txt
import { readFileSync, writeFileSync } from 'node:fs';
import { trace } from './rpc.mjs';
import { reconstruct } from './reconstruct.mjs';
import { POOL_MANAGER, hookPermissionNames } from './v4.mjs';

const CHAIN = process.env.CHAIN ?? 'unichain';
const PM = POOL_MANAGER[CHAIN];
const file = process.argv[2] === '--file' ? process.argv[3] : `corpus-${CHAIN}.txt`;
const hashes = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8').trim().split('\n');

const registry = new Map();
for (const hash of hashes) {
  let r;
  try {
    r = reconstruct(await trace(hash), { poolManager: PM });
  } catch {
    process.stderr.write('x');
    continue;
  }
  process.stderr.write('.');
  for (const h of r.hooks) {
    const found = registry.get(h.address) ?? {
      address: h.address,
      txCount: 0,
      sampleTxs: [],
      permissions: hookPermissionNames(h.address),
      callbacks: new Set(),
      externals: new Set(),
    };
    found.txCount++;
    if (found.sampleTxs.length < 3) found.sampleTxs.push(hash);
    for (const cb of h.callbacks) found.callbacks.add(cb);
    for (const c of h.externalCalls) found.externals.add(c.to);
    registry.set(h.address, found);
  }
}
process.stderr.write('\n');

const out = [...registry.values()]
  .sort((a, b) => b.txCount - a.txCount)
  .map((h) => ({ ...h, callbacks: [...h.callbacks], externals: [...h.externals] }));
writeFileSync(new URL(`./hook-registry-${CHAIN}.json`, import.meta.url), JSON.stringify(out, null, 2));
console.log(`${out.length} hooks across ${hashes.length} txs -> hook-registry-${CHAIN}.json`);
for (const h of out) console.log(`${h.address}  txs=${h.txCount} cbs=[${h.callbacks.join(',')}] ext=${h.externals.length}`);
