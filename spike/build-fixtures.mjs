// Build the app catalog (M2') as static graph JSON.
//
// 구조가 트랜잭션 목록 → 앱 목록으로 바뀌었다: v4 위에 올라온 앱(훅 프로토콜)마다
// 대표 트랜잭션 2~3개를 골라 "이 앱은 돈을 이렇게 움직인다"를 보여준다.
// 한 트랜잭션이 앱 구조 전체를 대변하지 못하므로 흐름 종류별로 나눠 담는다.
// 앱 신원은 spike/known-hooks.json (수동 관리, 근거 기록) 에서 온다.
// Serving these as static JSON also covers the §10 RPC cost/limit risk.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { trace } from './rpc.mjs';
import { toGraph } from './graph.mjs';
import { resolveTokens } from './tokens.mjs';

const APPS = [
  {
    id: 'baseline',
    name: { ko: '훅 없는 v4', en: 'Plain v4' },
    tagline: { ko: '기준선 — 훅이 없는 스왑', en: 'The baseline — a swap with no hook' },
    description: {
      ko: '비교 기준. 훅이 없으면 지갑에서 나가고 들어오는 두 방향이 전부다. 아래 앱들이 여기에 무엇을 얹는지 보기 위한 출발점.',
      en: 'The reference point. Without a hook, a swap is just two arrows — out of the wallet and back. Everything the apps below add starts from here.',
    },
    hooks: [],
    flows: [
      {
        slug: 'baseline-swap',
        hash: '0xa5e79837530b749b9b1d9942256d43e90f7d5cf924a8264ef85eb5f238e34ac8',
        title: { ko: '훅 없는 스왑', en: 'Swap without a hook' },
        blurb: {
          ko: '지갑에서 나가고 들어오는 두 방향이 전부다.',
          en: 'Two arrows — out of the wallet and back — and nothing else.',
        },
      },
    ],
  },
  {
    id: 'aegis',
    name: { ko: 'Aegis', en: 'Aegis' },
    tagline: { ko: '수수료를 청구권으로 쌓는 AMM 훅', en: 'AMM hook that banks fees as claims' },
    description: {
      ko: '스왑마다 수수료 몫을 ERC-6909 청구권으로 챙기고, 외부 컨트랙트를 호출해 전략을 실행한다. 청구권은 Transfer 이벤트가 없어서 일반 익스플로러에는 이 수수료가 아예 보이지 않는다.',
      en: 'Takes its cut of every swap as an ERC-6909 claim and calls out to external contracts to run its strategy. Claims emit no Transfer event, so ordinary explorers never see this fee at all.',
    },
    hooks: ['0xa0b0d2d00fd544d8e0887f1a3cedd6e24baf10cc', '0x88c9ff9fc0b22cca42265d3f1d1c2c39e41cdacc'],
    flows: [
      {
        slug: 'aegis-swap',
        hash: '0xe0a7208ca3ea14960608d6a2d32b9b5cced5b4480437b2428a72d5a1e09594c1',
        title: { ko: '스왑 + 숨은 수수료', en: 'Swap + hidden fee' },
        blurb: {
          ko: 'ERC-6909 청구권으로 수수료를 챙기고, 컨트랙트 4개를 추가로 호출한다. 실제 ERC20 Transfer는 2건뿐.',
          en: 'Takes its fee as an ERC-6909 claim and reaches four other contracts. Only two real ERC20 Transfers.',
        },
      },
      {
        slug: 'aegis-v3-busy',
        hash: '0xe84009a28799a4bb408a7a4991d7170ee9d35a0083cabb1702ab5e25a60fc0bf',
        title: { ko: 'v3 훅의 바쁜 스왑', en: 'A busy v3 swap' },
        blurb: {
          ko: '한 스왑에 이동이 19건. 노드는 적은데 훅이 풀과 여러 번 정산을 주고받는다.',
          en: 'Nineteen movements in one swap. Few nodes, but the hook settles back and forth with the pool many times.',
        },
      },
      {
        slug: 'aegis-two-hooks',
        hash: '0xbd31a2249ce2d5e6ed10a3de7a6e2aa7d32830295fd0f446925bfec3fa8fc10a',
        title: { ko: 'v2 · v3 동시 통과', en: 'Through v2 and v3 at once' },
        blurb: {
          ko: '한 라우트가 Aegis v2 풀과 v3 풀을 연달아 지난다. 두 훅이 각자 수수료를 챙긴다.',
          en: 'One route passes an Aegis v2 pool and a v3 pool back to back. Each hook takes its own cut.',
        },
      },
    ],
  },
  {
    id: 'eulerswap',
    name: { ko: 'EulerSwap', en: 'EulerSwap' },
    tagline: { ko: 'Euler 볼트를 유동성으로 쓰는 AMM', en: 'AMM backed by Euler vaults' },
    description: {
      ko: '풀에 토큰을 쌓아두는 대신, 스왑이 들어오면 훅이 Euler 볼트(EVC/EVault)를 호출해 유동성을 조달한다. 다이어그램의 외부 호출 선이 그 배관이다.',
      en: 'Instead of parking tokens in the pool, the hook borrows liquidity from Euler vaults (EVC/EVault) as swaps come in. The external-call lines in the diagram are that plumbing.',
    },
    hooks: ['0xb5c643879006742699d1cc2581c28f177963a8a8'],
    flows: [
      {
        slug: 'euler-swap',
        hash: '0x9ad78d6abf0ac007bd1d28a649d97508901413c51985c4cc2eb4c26901f10e6e',
        title: { ko: '훅이 상대방이 되는 스왑', en: 'The hook is the counterparty' },
        blurb: {
          ko: '풀에 쌓인 유동성이 없다. 훅이 입력 토큰을 직접 받아가고 출력 토큰을 정산하며, 그 뒤에서 볼트 호출 수십 건이 오간다.',
          en: 'No liquidity sits in the pool. The hook takes the input tokens itself and settles the output, with dozens of vault calls behind it.',
        },
      },
      {
        slug: 'euler-multihop',
        hash: '0x74803911a975a65f424bf2bce3bfa8ec46892c794629fa401ecfc5ea3f8ab088',
        title: { ko: 'EulerSwap을 지나는 멀티홉', en: 'Multihop through EulerSwap' },
        blurb: {
          ko: '라우트가 훅 세 개(EulerSwap · Limit Order · 미확인)를 지난다. EulerSwap 구간에서 볼트 호출이 뻗어 나간다.',
          en: 'The route crosses three hooks (EulerSwap, Limit Order, one unidentified). Vault calls fan out at the EulerSwap leg.',
        },
      },
    ],
  },
  {
    id: 'backgeo',
    name: { ko: 'BackGeoOracle', en: 'BackGeoOracle' },
    tagline: { ko: '스왑 가격을 기록하는 오라클 훅', en: 'Oracle hook that records swap prices' },
    description: {
      ko: 'RigoBlock의 온체인 오라클. 풀을 지나는 스왑마다 가격을 기록하고, 가격 조작을 되돌리는 백런 로직을 내장한다. 외부 호출 없이 훅 안에서만 동작한다.',
      en: "RigoBlock's on-chain oracle. Records the price of every swap through the pool and carries back-run logic to undo manipulation. Runs entirely inside the hook — no external calls.",
    },
    hooks: ['0x54bd666ea7fd8d5404c0593eab3dcf9b6e2a3ac4'],
    flows: [
      {
        slug: 'backgeo-swap',
        hash: '0x65c8aeb0a3724cd3760308de861bab99fa2867b2de0cf186abc43e4f24acda68',
        title: { ko: '오라클 풀 스왑', en: 'Swap through the oracle pool' },
        blurb: {
          ko: '겉보기엔 평범한 스왑. 훅은 값을 움직이지 않고 가격만 기록한다.',
          en: 'Looks like an ordinary swap. The hook moves no value — it only records the price.',
        },
      },
      {
        slug: 'backgeo-route',
        hash: '0x5c146270cf05fe1fbbcdb1925b9281486bf3951983143d0eeaad6ae697cbd51d',
        title: { ko: '두 풀을 잇는 라우트', en: 'Route across two pools' },
        blurb: {
          ko: '한 트랜잭션이 오라클 풀 두 개를 연달아 지난다. 각 풀에서 가격이 기록된다.',
          en: 'One transaction crosses two oracle pools back to back; each records its price.',
        },
      },
    ],
  },
  {
    id: 'volatility-fee',
    name: { ko: 'Volatility Fee Hook', en: 'Volatility Fee Hook' },
    tagline: { ko: '변동성에 따라 수수료를 바꾸는 훅', en: 'Fees that move with volatility' },
    description: {
      ko: '변동성에 따라 스왑 수수료를 조정하고, 자기 몫을 ERC-6909 청구권으로 챙긴다. 컨트랙트명은 검증됐지만 어느 프로젝트의 배포인지는 확인하지 못했다.',
      en: 'Adjusts the swap fee with volatility and keeps its cut as an ERC-6909 claim. The contract name is verified, but we could not confirm which project deployed it.',
    },
    hooks: ['0x3002a90b7c510d33debee13e46854711f45a50c4'],
    flows: [
      {
        slug: 'volfee-swap',
        hash: '0x7d92432dd0b63a002f295f5be79218988589071acd5a88d71c20aecc99059b23',
        title: { ko: '훅이 수수료를 가져가는 스왑', en: 'Hook takes a fee' },
        blurb: {
          ko: '가장 단순한 훅 수수료. 훅이 가져간 몫이 Transfer 이벤트에는 없다.',
          en: 'The simplest hook fee. The cut it takes never appears in a Transfer event.',
        },
      },
    ],
  },
  {
    id: 'limit-order',
    name: { ko: 'Limit Order Hook', en: 'Limit Order Hook' },
    tagline: { ko: '풀 가격에 지정가 주문을 얹는 훅', en: 'Limit orders on top of pool price' },
    description: {
      ko: '풀 가격이 지정가에 닿으면 afterSwap에서 주문을 체결한다. 체결 대금은 ERC-6909 청구권으로 보관돼 주문자가 찾아갈 때까지 Transfer 이벤트가 없다.',
      en: 'Fills resting orders in afterSwap when the pool price crosses their limit. Proceeds sit as ERC-6909 claims — no Transfer event until the maker withdraws.',
    },
    hooks: ['0x2016c0e4f8bb1d6fea777dc791be919e2eda40c0', '0xcab5a0b38b36bacd781a6ab9cc931fc6560ac0c0'],
    flows: [
      {
        slug: 'limit-fill',
        hash: '0xb7ba37dc7adc8100152ed48da9f8ca754626955b2763b8db7fd1f9a10895e27d',
        title: { ko: '체결 대금이 청구권으로 숨는다', en: 'Fill proceeds hide as claims' },
        blurb: {
          ko: '왕복 스왑의 차익이 제3의 주소 앞으로 ERC-6909 청구권으로 발행된다. Transfer 이벤트 0건.',
          en: 'The residual of a round-trip swap is minted to a third address as an ERC-6909 claim. Zero Transfer events.',
        },
      },
      {
        slug: 'limit-route',
        hash: '0x95f8e3adae13181bf353b76cc1e99101a9c5ec00e6a00e9dbee4a80fbb1d1d31',
        title: { ko: '주문 풀을 지나는 멀티홉', en: 'Multihop through the order pool' },
        blurb: {
          ko: 'ETH → USDC → 토큰으로 이어지는 라우트가 지정가 풀을 지나고, 결과물은 다른 수신자에게 간다.',
          en: 'An ETH → USDC → token route passes the limit-order pool, with the output taken by a different recipient.',
        },
      },
    ],
  },
  {
    id: 'unidentified',
    name: { ko: '미확인 훅', en: 'Unidentified hooks' },
    tagline: { ko: '신원을 확인하지 못한 훅들', en: 'Hooks we could not identify' },
    description: {
      ko: '코퍼스에서 관측됐지만 배포자·프로젝트를 확인하지 못한 훅. 추측하는 대신 주소와 관측된 동작만 그대로 보여준다.',
      en: 'Hooks observed in the corpus whose deployer or project we could not confirm. Rather than guess, we show the address and the observed behavior as-is.',
    },
    hooks: [
      '0x8987d61840155c2256c8cbeb5dbaafd5e6f4d3c0',
      '0x5753ced012155da10431564b9cfde7ca238250c8',
      '0x5f35c46ac75cb102ff092dbbd9934cd02b4050c8',
      '0xcfd781e4c0e75c4137faa8299839cc765ca710c8',
      '0xad78e0a3b5a552813feb5eb8ecbe842f7b5e9088',
    ],
    flows: [
      {
        slug: 'unknown-pair',
        hash: '0x20c58196c4365808d53d15662da700ecaa3c0644acdf9b6982693c6e8046d74e',
        title: { ko: '미확인 훅 두 개를 지나는 라우트', en: 'Route through two unidentified hooks' },
        blurb: {
          ko: '한 트랜잭션이 신원 미상의 훅 풀 두 개를 연달아 지난다. 이동 8건 전부 복원·검증됨.',
          en: 'One transaction crosses two pools with unidentified hooks. All eight movements reconstructed and verified.',
        },
      },
      {
        slug: 'unknown-roundtrip',
        hash: '0xc703ae1449168b3f7585d2986b4123b9adebabdb3d77c1a21dd7e108828701c1',
        title: { ko: '미확인 훅 풀의 왕복 스왑', en: 'Round trip through an unidentified hook pool' },
        blurb: {
          ko: '같은 풀을 두 번 지나는 스왑. 훅은 자기 자신을 호출할 뿐 밖으로 나가지 않는다.',
          en: 'A swap crossing the same pool twice. The hook only calls itself — it never reaches outside.',
        },
      },
    ],
  },
];

// 앱이 읽는 사본과 스파이크의 사본을 동시에 쓴다. 한쪽만 갱신되면 조용히 어긋난다.
const targets = [new URL('./fixtures/', import.meta.url), new URL('../src/fixtures/', import.meta.url)];
for (const t of targets) {
  mkdirSync(t, { recursive: true });
  // 옛 슬러그의 잔재가 남으면 UI 글롭이 죽은 픽스처를 집어간다 — 전부 지우고 다시 쓴다.
  for (const f of readdirSync(t)) if (f.endsWith('.json')) rmSync(new URL(f, t));
}
const writeAll = (name, body) => targets.forEach((t) => writeFileSync(new URL(name, t), body));

const catalog = [];
for (const app of APPS) {
  const flows = [];
  for (const flow of app.flows) {
    let graph;
    try {
      graph = toGraph(await trace(flow.hash), { txHash: flow.hash, chain: 'unichain' });
    } catch (e) {
      console.error(`SKIP ${flow.slug}: ${e.message}`);
      continue;
    }
    graph.tokens = await resolveTokens(graph);
    writeAll(`${flow.slug}.json`, JSON.stringify(graph, null, 2));
    const hookNodes = graph.nodes.filter((n) => n.type === 'hook').length;
    const hiddenEdges = graph.edges.filter((e) => e.engineer?.note && e.amount).length;
    flows.push({ ...flow, nodes: graph.nodes.length, edges: graph.edges.length, hooks: hookNodes, hiddenValueEdges: hiddenEdges, file: `${flow.slug}.json`, balanced: graph.balanced });
    console.log(`${flow.slug.padEnd(20)} nodes=${String(graph.nodes.length).padStart(2)} edges=${String(graph.edges.length).padStart(2)} hooks=${hookNodes} hidden=${hiddenEdges} balanced=${graph.balanced}`);
  }
  catalog.push({ ...app, flows });
}

writeAll('apps.json', JSON.stringify(catalog, null, 2));
console.log(`\nwrote ${catalog.reduce((n, a) => n + a.flows.length, 0)} fixtures + apps.json to ${targets.length} locations`);
