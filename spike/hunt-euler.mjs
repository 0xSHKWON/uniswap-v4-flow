// EulerSwap 풀 단독 스왑 발굴 (M2' 카탈로그 보강).
// 코퍼스의 EulerSwap tx 2건은 둘 다 훅 3개짜리 멀티홉이라 앱 구조를 보여주기에 시끄럽다.
//
// poolId는 풀 키의 keccak인데 스파이크에 keccak 의존성이 없으므로, 대신
// 트레이스의 swap 스텝 순서와 영수증의 Swap 이벤트 순서가 같다는 점을 이용해
// "몇 번째 스왑이 EulerSwap 풀인가"로 poolId를 특정한다. 그 poolId로 로그를
// 넓게 스캔해 같은 풀만 지나는 조용한 tx를 찾는다.
import { rpc, trace } from './rpc.mjs';
import { toGraph } from './graph.mjs';
import { reconstruct } from './reconstruct.mjs';
import { POOL_MANAGER, eq } from './v4.mjs';

const SWAP_TOPIC = '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f';
const PM = POOL_MANAGER.unichain;
const EULER_HOOK = '0xb5c643879006742699d1cc2581c28f177963a8a8';
const KNOWN_TXS = [
  '0x74803911a975a65f424bf2bce3bfa8ec46892c794629fa401ecfc5ea3f8ab088',
  '0xa9ce5a09256abd53a2a8091e62ca6e3973f35d42930ccd793e204410e715c1c3',
];

// 1) swap 스텝 순서 × Swap 이벤트 순서를 짝지어 EulerSwap 풀의 poolId를 얻는다
const eulerPools = new Set();
let anchorBlock = 0;
for (const hash of KNOWN_TXS) {
  const [root, receipt] = [await trace(hash), await rpc('eth_getTransactionReceipt', [hash])];
  anchorBlock = Math.max(anchorBlock, Number(receipt.blockNumber));
  const swapLogs = receipt.logs.filter((l) => l.address.toLowerCase() === PM && l.topics[0] === SWAP_TOPIC);
  const swapSteps = reconstruct(root, { poolManager: PM }).steps.filter((s) => s.kind === 'swap');
  if (swapLogs.length !== swapSteps.length) {
    console.error(`${hash.slice(0, 10)}: step/log count mismatch (${swapSteps.length} vs ${swapLogs.length}) — skip`);
    continue;
  }
  swapSteps.forEach((s, i) => {
    if (eq(s.pool.hooks, EULER_HOOK)) eulerPools.add(swapLogs[i].topics[1]);
  });
}
console.error(`EulerSwap pools: ${[...eulerPools].join(', ') || 'none found'}`);
if (!eulerPools.size) process.exit(1);

// 2) 그 poolId의 Swap 로그를 앵커 블록 전후로 스캔
const txs = new Set();
const SPAN = Number(process.argv[2] ?? 2000);
const WINDOWS = Number(process.argv[3] ?? 60);
const head = Number(await rpc('eth_blockNumber', [], { cache: false }));
for (const anchor of [anchorBlock + (SPAN * WINDOWS) / 2, head]) {
  for (let i = 0; i < WINDOWS; i++) {
    const to = anchor - i * SPAN;
    const from = to - (SPAN - 1);
    if (to <= 0) break;
    try {
      const logs = await rpc('eth_getLogs', [
        { fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16), address: PM, topics: [SWAP_TOPIC, [...eulerPools]] },
      ]);
      for (const l of logs) txs.add(l.transactionHash);
      if (logs.length) process.stderr.write(`${from}-${to}: ${logs.length} logs (${txs.size} txs)\n`);
    } catch (e) {
      console.error(`${from}-${to}: ${e.message.slice(0, 80)}`);
      break;
    }
  }
}

// 3) 새 후보를 재구성해 훅 구성 확인 — EulerSwap 단독이면 당첨
const fresh = [...txs].filter((h) => !KNOWN_TXS.includes(h));
console.error(`\n${fresh.length} fresh candidates`);
let noisy = 0;
for (const hash of fresh) {
  try {
    const g = toGraph(await trace(hash), { txHash: hash });
    const settlements = g.edges.filter((e) => e.layer === 'settlement');
    const hooks = g.nodes.filter((n) => n.type === 'hook').map((n) => n.known ?? n.label);
    if (hooks.length === 1 && hooks[0] === 'EulerSwap') {
      console.log(
        `PURE ${hash}  nodes=${g.nodes.length} edges=${g.edges.length} moves=${settlements.length} balanced=${g.balanced}`,
      );
    } else noisy++;
  } catch (e) {
    console.log(`FAIL ${hash}  ${e.message.slice(0, 60)}`);
  }
}
console.error(`${noisy} multi-hook routes skipped`);
