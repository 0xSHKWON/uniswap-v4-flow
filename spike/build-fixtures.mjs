// Build the curated 예시 해시 set (기획서 §6) as static graph JSON.
//
// Unichain is the launch chain, but only ~26% of its transactions touch a hook,
// so the landing examples are chosen deliberately: a complexity ladder where every
// hooked entry shows value that a Transfer-based explorer cannot see.
// Serving these as static JSON also covers the §10 RPC cost/limit risk.
import { mkdirSync, writeFileSync } from 'node:fs';
import { trace } from './rpc.mjs';
import { toGraph } from './graph.mjs';

const EXAMPLES = [
  {
    slug: '01-no-hook',
    hash: '0xa5e79837530b749b9b1d9942256d43e90f7d5cf924a8264ef85eb5f238e34ac8',
    title: '훅 없는 스왑',
    blurb: '기준선. 지갑에서 나가고 들어오는 두 방향이 전부다.',
  },
  {
    slug: '02-hook-takes-fee',
    hash: '0x7d92432dd0b63a002f295f5be79218988589071acd5a88d71c20aecc99059b23',
    title: '훅이 수수료를 가져가는 스왑',
    blurb: '가장 단순한 훅. 훅이 가져간 몫이 Transfer 이벤트에는 없다.',
  },
  {
    slug: '03-hook-with-reach',
    hash: '0xe0a7208ca3ea14960608d6a2d32b9b5cced5b4480437b2428a72d5a1e09594c1',
    title: '훅이 외부 프로토콜을 부르는 스왑',
    blurb: 'ERC-6909 청구권으로 수수료를 챙기고, 컨트랙트 4개를 추가로 호출한다. 실제 ERC20 Transfer는 2건뿐.',
  },
  {
    slug: '04-dense',
    hash: '0xe84009a28799a4bb408a7a4991d7170ee9d35a0083cabb1702ab5e25a60fc0bf',
    title: '한 훅이 많이 움직이는 스왑',
    blurb: '노드는 적은데 엣지가 42개. 접기/펼치기가 필요해지는 지점.',
  },
  {
    slug: '05-two-hooks',
    hash: '0xbd31a2249ce2d5e6ed10a3de7a6e2aa7d32830295fd0f446925bfec3fa8fc10a',
    title: '서로 다른 훅 두 개',
    blurb: '한 트랜잭션이 성격이 다른 훅 두 개를 거친다.',
  },
  {
    slug: '06-multihop-three-hooks',
    hash: '0x74803911a975a65f424bf2bce3bfa8ec46892c794629fa401ecfc5ea3f8ab088',
    title: '멀티홉 · 훅 세 개',
    blurb: '노드 22 / 엣지 47. 레이아웃 상한을 시험하는 케이스 (기획서 §10 "스파게티" 리스크).',
  },
];

const dir = new URL('./fixtures/', import.meta.url);
mkdirSync(dir, { recursive: true });

const index = [];
for (const ex of EXAMPLES) {
  let graph;
  try {
    graph = toGraph(await trace(ex.hash), { txHash: ex.hash, chain: 'unichain' });
  } catch (e) {
    console.error(`SKIP ${ex.slug}: ${e.message}`);
    continue;
  }
  writeFileSync(new URL(`${ex.slug}.json`, dir), JSON.stringify(graph, null, 2));
  const hookNodes = graph.nodes.filter((n) => n.type === 'hook').length;
  const hiddenEdges = graph.edges.filter((e) => e.engineer?.note && e.amount).length;
  index.push({ ...ex, nodes: graph.nodes.length, edges: graph.edges.length, hooks: hookNodes, hiddenValueEdges: hiddenEdges, file: `${ex.slug}.json`, balanced: graph.balanced });
  console.log(`${ex.slug.padEnd(26)} nodes=${String(graph.nodes.length).padStart(2)} edges=${String(graph.edges.length).padStart(2)} hooks=${hookNodes} hidden=${hiddenEdges} balanced=${graph.balanced}`);
}

writeFileSync(new URL('index.json', dir), JSON.stringify(index, null, 2));
console.log(`\nwrote ${index.length} fixtures + index.json`);
