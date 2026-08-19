// 기획서 §7 데이터 모델. spike/graph.mjs 가 내보내는 형태와 1:1로 맞춘다.

export type NodeType = 'core' | 'hook' | 'external' | 'router' | 'eoa';

/** 엣지 층. 섞으면 같은 값을 두 번 세게 된다 — spike/graph.mjs 주석 참조. */
export type EdgeLayer =
  | 'settlement' // 실제로 움직인 값 (settle/take/mint/burn) — trader 모드
  | 'accounting' // 그 값을 설명하는 채무 (swap 델타, 훅 몫) — engineer 모드 (M3)
  | 'reach'; //     훅이 호출한 외부 컨트랙트 — 금액 없음

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  address?: string;
  /** 주소 → 프로토콜명 매핑. M4에서 채운다. */
  known?: string | null;
  permissions?: string[];
  callbacks?: string[];
}

export interface GraphEdge {
  layer: EdgeLayer;
  from: string;
  to: string;
  /** 'native' 또는 토큰 주소. reach 엣지는 null. */
  token: string | null;
  /** raw 정수 문자열. reach 엣지는 null. */
  amount: string | null;
  /** 양 끝이 아닌 제3자가 이 정산을 호출했을 때 그 주소 (보통 훅). */
  via?: string | null;
  /** ERC-6909 청구권 등 ERC20 Transfer 이벤트를 남기지 않는 이동. */
  hidden?: boolean;
  claim?: boolean;
  hookCut?: boolean;
  engineer: {
    call: string;
    note?: string;
    delta?: string;
    side?: string;
    native?: boolean;
    count?: number;
    zeroForOne?: boolean;
  };
}

export interface TokenMeta {
  address: string;
  symbol: string;
  decimals: number;
  name: string | null;
}

export interface Graph {
  txHash: string;
  chain: string;
  /** 트랜잭션을 보낸 EOA. 그림에서 "지갑"으로 표시된다. */
  origin: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  tokens: Record<string, TokenMeta>;
  /** 델타 제로 불변식 통과 여부. false면 복원이 불완전하다는 뜻. */
  balanced: boolean;
}

export interface LocalizedText {
  ko: string;
  en: string;
}

export interface FixtureIndexEntry {
  slug: string;
  hash: string;
  title: LocalizedText;
  blurb: LocalizedText;
  nodes: number;
  edges: number;
  hooks: number;
  hiddenValueEdges: number;
  file: string;
  balanced: boolean;
}
