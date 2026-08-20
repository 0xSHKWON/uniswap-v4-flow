// 엔지니어 모드의 호출 트레이스 (M3').
//
// spike/graph.mjs 는 엣지를 r.steps 실행 순서 그대로 push 한다 — 즉 픽스처의
// edges 배열이 곧 unlock() 안에서 장부가 변한 순서다. 여기서는 그 순서를
// 그대로 줄 세워 "델타 저널"로 복원한다. RPC 없음, 픽스처만 읽는다.
//
// 부호 규약은 v4의 currencyDelta 와 같다: PM 상대방 관점에서
// 양수 = PM이 줄 것(채권), 음수 = PM이 받을 것(채무).
//   accounting pm→X  : +a   (스왑 산출 등 — PM이 X에게 빚짐)
//   accounting X→pm  : −a   (스왑 투입 등 — X가 PM에 빚짐)
//   settlement pm→X  : −a   (take/mint — 채권 소진)
//   settlement X→pm  : +a   (settle/burn/clear — 채무 상환)
// 이렇게 접으면 토큰별 러닝 합계가 트랜잭션 끝에서 전부 0이 된다
// (플래시 어카운팅의 델타-제로 불변식 — 픽스처 20건 전수 확인).
import type { Graph, GraphEdge } from './types';

export interface TraceLine {
  /** 1부터 시작하는 줄 번호. */
  idx: number;
  /** 원본 엣지 — 다이어그램 쪽과 객체 동일성으로 매칭한다. */
  edge: GraphEdge;
  kind: 'settlement' | 'accounting';
  /** 표시용 호출어. 'beforeSwap/afterSwap returnDelta'는 'returnDelta'로 줄인다. */
  call: string;
  /** 호출어 뒤에 붙는 인자 표기 — swap(0→1), settle(native) 등. */
  args: string | null;
  token: string;
  /** 위 규약대로 부호를 붙인 델타. */
  signed: bigint;
  hidden: boolean;
  hookCut: boolean;
  from: string;
  to: string;
  /** 이 줄 직후의 토큰별 미정산 델타. 0인 토큰은 뺀다. */
  outstanding: Array<[string, bigint]>;
  /** 이 줄에서 미정산이 0으로 떨어진 토큰들 — "장부가 닫힌 순간" 표시용. */
  zeroed: string[];
}

export interface Trace {
  lines: TraceLine[];
  /** 마지막 줄 이후 남은 미정산. balanced 픽스처면 빈 배열. */
  residual: Array<[string, bigint]>;
}

function displayCall(e: GraphEdge): { call: string; args: string | null } {
  const c = e.engineer.call;
  if (c.includes('returnDelta')) return { call: 'returnDelta', args: null };
  if (c === 'swap') {
    const z = e.engineer.zeroForOne;
    return { call: 'swap', args: z === undefined ? null : z ? '0→1' : '1→0' };
  }
  if ((c === 'settle' || c === 'settleFor') && e.engineer.native) return { call: c, args: 'native' };
  if (c === 'mint' || c === 'burn') return { call: c, args: '6909' };
  return { call: c, args: null };
}

export function buildTrace(graph: Graph): Trace {
  const running = new Map<string, bigint>();
  const lines: TraceLine[] = [];

  for (const e of graph.edges) {
    if (e.layer === 'reach' || !e.amount || !e.token) continue;
    const a = BigInt(e.amount);
    const signed =
      e.layer === 'accounting' ? (e.from === 'pm' ? a : -a) : e.from === 'pm' ? -a : a;

    const before = running.get(e.token) ?? 0n;
    const after = before + signed;
    if (after === 0n) running.delete(e.token);
    else running.set(e.token, after);

    lines.push({
      idx: lines.length + 1,
      edge: e,
      kind: e.layer,
      ...displayCall(e),
      token: e.token,
      signed,
      hidden: Boolean(e.hidden),
      hookCut: Boolean(e.hookCut),
      from: e.from,
      to: e.to,
      outstanding: [...running.entries()],
      zeroed: before !== 0n && after === 0n ? [e.token] : [],
    });
  }

  return { lines, residual: [...running.entries()] };
}

// v4는 훅 권한을 훅 자신의 주소 하위 14비트에 인코딩한다 (spike/v4.mjs 와 동일).
// 비트 순서는 상위(13)부터 — 렌더링에서 이 순서대로 비트 문자열을 만든다.
export const HOOK_FLAGS: Array<[name: string, bit: number]> = [
  ['BEFORE_INITIALIZE', 13],
  ['AFTER_INITIALIZE', 12],
  ['BEFORE_ADD_LIQUIDITY', 11],
  ['AFTER_ADD_LIQUIDITY', 10],
  ['BEFORE_REMOVE_LIQUIDITY', 9],
  ['AFTER_REMOVE_LIQUIDITY', 8],
  ['BEFORE_SWAP', 7],
  ['AFTER_SWAP', 6],
  ['BEFORE_DONATE', 5],
  ['AFTER_DONATE', 4],
  ['BEFORE_SWAP_RETURNS_DELTA', 3],
  ['AFTER_SWAP_RETURNS_DELTA', 2],
  ['AFTER_ADD_LIQUIDITY_RETURNS_DELTA', 1],
  ['AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA', 0],
];

export const hookBits = (address: string): number => Number(BigInt(address) & 0x3fffn);

/** 노드의 표시 이름 — 프로토콜명 > 짧은 주소 > 라벨 순. */
export function nodeName(graph: Graph, id: string): string {
  if (id === 'pm') return 'PoolManager';
  const n = graph.nodes.find((x) => x.id === id);
  if (!n) return id;
  if (n.known) return n.known;
  if (n.type === 'eoa') return n.label;
  return n.address ? `${n.address.slice(0, 6)}…${n.address.slice(-4)}` : n.label;
}
