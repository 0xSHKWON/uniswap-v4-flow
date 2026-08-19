// 노드 배치는 손으로 한다 (기획서 §9). 자동 레이아웃 라이브러리 없음.
//
// 배치 원리: PoolManager가 허브다. 돈을 낸 쪽이 왼쪽, 받은 쪽이 오른쪽,
// 훅은 PoolManager 아래 레인에 둔다. 훅을 거쳐서만 값을 받은 주소는 오른쪽 위가 아니라
// 그 훅 옆에 붙인다 — 그래야 선이 교차하지 않고 "PM → 훅 → 어디로" 가 한 줄로 읽힌다.
import type { Graph, GraphEdge, GraphNode } from './types';

export interface PlacedNode extends GraphNode {
  x: number;
  y: number;
  w: number;
  h: number;
  role: 'pool' | 'payer' | 'recipient' | 'hook' | 'external';
}

export interface RoutedEdge {
  key: string;
  from: string;
  to: string;
  via: string | null;
  token: string | null;
  amount: string;
  hidden: boolean;
  claim: boolean;
  calls: GraphEdge[];
  points: Array<{ x: number; y: number }>;
  label: { x: number; y: number; anchor: 'middle' | 'start' | 'end' };
}

/** 값은 안 움직였지만 호출은 된 훅 — 이것도 보여줘야 "훅이 뭘 했는지"가 정직해진다. */
export interface InterveneEdge {
  key: string;
  points: Array<{ x: number; y: number }>;
  label: { x: number; y: number };
}

export interface ReachEdge {
  key: string;
  points: Array<{ x: number; y: number }>;
  count: number;
  label: { x: number; y: number };
}

export interface Layout {
  /** 실제 그려진 것들의 경계에서 계산한다. 상수로 잡으면 레인이 위로 넘칠 때 잘린다. */
  viewBox: { x: number; y: number; w: number; h: number };
  width: number;
  height: number;
  nodes: PlacedNode[];
  edges: RoutedEdge[];
  reach: ReachEdge[];
  intervene: InterveneEdge[];
}

const SIZE = {
  core: { w: 190, h: 76 },
  hook: { w: 214, h: 86 },
  actor: { w: 182, h: 70 },
  external: { w: 172, h: 50 },
};

const COL = { left: 48, mid: 436, right: 820 };
const PAD_TOP = 36;
const GAP = 34;
/** 라벨 두 줄이 들어갈 만큼 벌린다. 이보다 좁으면 겹친다. */
const LANE = 40;

function aggregate(edges: GraphEdge[]): Omit<RoutedEdge, 'points' | 'label'>[] {
  const groups = new Map<string, Omit<RoutedEdge, 'points' | 'label'>>();
  for (const e of edges) {
    if (!e.amount) continue;
    const key = [e.from, e.to, e.token, e.via ?? '', e.hidden ? 'h' : ''].join('|');
    const found = groups.get(key);
    if (found) {
      found.amount = (BigInt(found.amount) + BigInt(e.amount)).toString();
      found.calls.push(e);
    } else {
      groups.set(key, {
        key,
        from: e.from,
        to: e.to,
        via: e.via ?? null,
        token: e.token,
        amount: e.amount,
        hidden: Boolean(e.hidden),
        claim: Boolean(e.claim),
        calls: [e],
      });
    }
  }
  return [...groups.values()];
}

export function layout(graph: Graph, expandedHooks: Set<string>): Layout {
  const aggregated = aggregate(graph.edges.filter((e) => e.layer === 'settlement'));
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const hooks = graph.nodes.filter((n) => n.type === 'hook');
  const hookIds = new Set(hooks.map((h) => h.id));

  const payers = new Set<string>();
  const directRecipients = new Set<string>();
  /** 훅을 거쳐서만 값을 받은 주소 → 그 훅 옆에 붙인다. */
  const viaRecipients = new Map<string, string>();

  for (const e of aggregated) {
    if (e.from !== 'pm' && !hookIds.has(e.from)) payers.add(e.from);
    if (e.to !== 'pm' && !hookIds.has(e.to)) {
      if (e.via && hookIds.has(e.via)) viaRecipients.set(e.to, e.via);
      else directRecipients.add(e.to);
    }
  }
  for (const id of payers) {
    directRecipients.delete(id);
    viaRecipients.delete(id);
  }
  for (const id of directRecipients) viaRecipients.delete(id);

  const placed: PlacedNode[] = [];
  const place = (node: GraphNode, x: number, y: number, s: { w: number; h: number }, role: PlacedNode['role']) => {
    placed.push({ ...node, x, y, w: s.w, h: s.h, role });
  };

  // --- 상단 밴드: 지불 | PoolManager | 수령 ---
  const blockHeight = (n: number, h: number) => (n ? n * h + (n - 1) * GAP : 0);
  const bandHeight = Math.max(
    blockHeight(payers.size, SIZE.actor.h),
    blockHeight(directRecipients.size, SIZE.actor.h),
    SIZE.core.h,
  );
  const columnAt = (ids: string[], x: number, s: { w: number; h: number }, role: PlacedNode['role']) => {
    let y = PAD_TOP + (bandHeight - blockHeight(ids.length, s.h)) / 2;
    for (const id of ids) {
      const n = byId.get(id);
      if (n) place(n, x, y, s, role);
      y += s.h + GAP;
    }
  };

  columnAt([...payers], COL.left, SIZE.actor, 'payer');
  columnAt([...directRecipients], COL.right, SIZE.actor, 'recipient');
  const pmNode = byId.get('pm');
  if (pmNode) place(pmNode, COL.mid, PAD_TOP + (bandHeight - SIZE.core.h) / 2, SIZE.core, 'pool');

  // --- 훅 레인: 훅 | (그 훅을 거쳐 받은 주소, 훅이 부른 컨트랙트) ---
  const placedAddresses = new Set(placed.map((n) => n.address?.toLowerCase()).filter(Boolean) as string[]);
  let y = PAD_TOP + bandHeight + 84;
  for (const h of hooks) {
    const rightSide: Array<{ node: GraphNode; size: { w: number; h: number }; role: PlacedNode['role'] }> = [];
    for (const [recipient, viaHook] of viaRecipients) {
      if (viaHook !== h.id) continue;
      const n = byId.get(recipient);
      if (n) rightSide.push({ node: n, size: SIZE.actor, role: 'recipient' });
    }
    if (expandedHooks.has(h.id)) {
      for (const e of graph.edges.filter((r) => r.layer === 'reach' && r.from === h.id)) {
        const n = byId.get(e.to);
        // 이미 '수령'으로 그려진 주소면 노드를 또 만들지 않고 그쪽으로 잇는다.
        // 같은 레인에서 방금 추가한 수령 노드까지 포함해서 본다.
        const addr = n?.address?.toLowerCase() ?? '';
        const inThisLane = rightSide.some((r) => r.node.address?.toLowerCase() === addr);
        if (!n || placedAddresses.has(addr) || inThisLane) continue;
        rightSide.push({ node: n, size: SIZE.external, role: 'external' });
      }
    }

    const rightHeight = rightSide.reduce((acc, r, i) => acc + r.size.h + (i ? 14 : 0), 0);
    const laneHeight = Math.max(SIZE.hook.h, rightHeight);

    place(h, COL.mid, y + (laneHeight - SIZE.hook.h) / 2, SIZE.hook, 'hook');
    let ry = y + (laneHeight - rightHeight) / 2;
    for (const r of rightSide) {
      place(r.node, COL.right, ry, r.size, r.role);
      ry += r.size.h + 14;
    }
    y += laneHeight + GAP;
  }

  // --- 라우팅 ---
  const pos = new Map(placed.map((n) => [n.id, n]));
  const right = (n: PlacedNode) => ({ x: n.x + n.w, y: n.y + n.h / 2 });
  const left = (n: PlacedNode) => ({ x: n.x, y: n.y + n.h / 2 });
  const top = (n: PlacedNode) => ({ x: n.x + n.w / 2, y: n.y });
  const bottom = (n: PlacedNode) => ({ x: n.x + n.w / 2, y: n.y + n.h });

  const routed: RoutedEdge[] = [];
  for (const e of aggregated) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    const viaNode = e.via ? pos.get(e.via) : null;

    if (viaNode && viaNode.role === 'hook') {
      // PoolManager → 훅 → 최종 수령자. 훅이 경로 위에 실제로 놓인다.
      const inSeg = [bottom(a), top(viaNode)];
      routed.push({ ...e, key: `${e.key}#in`, to: viaNode.id, points: inSeg, label: labelFor(inSeg) });
      const outSeg = [right(viaNode), left(b)];
      routed.push({ ...e, key: `${e.key}#out`, from: viaNode.id, points: outSeg, label: labelFor(outSeg) });
      continue;
    }

    const seg = a.x < b.x ? [right(a), left(b)] : a.x > b.x ? [left(a), right(b)] : [bottom(a), top(b)];
    routed.push({ ...e, points: seg, label: labelFor(seg) });
  }

  // 같은 두 노드 사이 선이 여러 개면 벌린다 — 가로 선은 세로로, 세로 선은 가로로.
  // 방향 무관하게 묶고(반대 방향 엣지가 겹치던 문제), 노드 중심을 기준으로 좌우 대칭 배치한다.
  // 한쪽으로만 밀면 아래 훅 레인을 침범한다.
  const laneKey = (r: RoutedEdge) => [r.from, r.to].sort().join('|');
  const laneSize = new Map<string, number>();
  for (const r of routed) laneSize.set(laneKey(r), (laneSize.get(laneKey(r)) ?? 0) + 1);

  const laneSeen = new Map<string, number>();
  for (const r of routed) {
    const key = laneKey(r);
    const n = laneSize.get(key) ?? 1;
    if (n < 2) continue;
    const i = laneSeen.get(key) ?? 0;
    laneSeen.set(key, i + 1);

    const [p, q] = [r.points[0], r.points[r.points.length - 1]];
    const horizontal = Math.abs(q.x - p.x) > Math.abs(q.y - p.y);
    const shift = (i - (n - 1) / 2) * LANE;
    r.points = r.points.map((pt) => (horizontal ? { ...pt, y: pt.y + shift } : { ...pt, x: pt.x + shift }));
    r.label = labelFor(r.points, 0.5 + (i - (n - 1) / 2) * 0.14, i % 2 === 0 ? 1 : -1);
  }

  const reach: ReachEdge[] = [];
  const intervene: InterveneEdge[] = [];
  for (const h of hooks) {
    const hookNode = pos.get(h.id);
    if (!hookNode) continue;

    // 값을 움직이지 않은 훅은 정산 엣지가 없어서 그림에서 떠 있게 된다.
    // 호출은 됐다는 사실 자체를 중립선으로 남긴다.
    const touched = routed.some((r) => r.from === h.id || r.to === h.id);
    if (!touched && pmNode) {
      const pm = pos.get('pm')!;
      const channel = COL.mid - 52;
      intervene.push({
        key: `intervene:${h.id}`,
        points: [
          { x: pm.x, y: pm.y + pm.h / 2 },
          { x: channel, y: pm.y + pm.h / 2 },
          { x: channel, y: hookNode.y + hookNode.h / 2 },
          { x: hookNode.x, y: hookNode.y + hookNode.h / 2 },
        ],
        // 채널 왼쪽 빈 공간에 둔다. 오른쪽에 두면 훅 박스 글자와 겹친다.
        label: { x: channel - 10, y: hookNode.y + hookNode.h / 2 - 10 },
      });
    }

    if (!expandedHooks.has(h.id)) continue;
    const byAddress = new Map(placed.map((n) => [n.address?.toLowerCase() ?? '', n]));
    for (const e of graph.edges.filter((r) => r.layer === 'reach' && r.from === h.id)) {
      const declared = byId.get(e.to);
      const target = pos.get(e.to) ?? byAddress.get(declared?.address?.toLowerCase() ?? '');
      if (!target || target.id === h.id) continue;
      const seg = [right(hookNode), left(target)];
      reach.push({
        key: `${e.from}->${e.to}`,
        points: seg,
        count: e.engineer.count ?? 1,
        label: { x: (seg[0].x + seg[1].x) / 2, y: (seg[0].y + seg[1].y) / 2 - 8 },
      });
    }
  }

  // 노드·선·라벨을 모두 포함하는 경계 상자.
  const xs: number[] = [];
  const ys: number[] = [];
  for (const n of placed) {
    xs.push(n.x, n.x + n.w);
    ys.push(n.y, n.y + n.h);
  }
  for (const r of routed) {
    for (const pt of r.points) {
      xs.push(pt.x);
      ys.push(pt.y);
    }
    ys.push(r.label.y - 18, r.label.y + 18);
  }
  for (const group of [...intervene, ...reach]) {
    for (const pt of group.points) {
      xs.push(pt.x);
      ys.push(pt.y);
    }
    xs.push(group.label.x - 110, group.label.x + 20);
    ys.push(group.label.y - 14, group.label.y + 8);
  }

  const PAD = 26;
  const minX = Math.min(...xs) - PAD;
  const minY = Math.min(...ys) - PAD;
  const w = Math.max(...xs) + PAD - minX;
  const h = Math.max(...ys) + PAD - minY;
  return { viewBox: { x: minX, y: minY, w, h }, width: w, height: h, nodes: placed, edges: routed, reach, intervene };
}

/**
 * 라벨을 선 위에 얹지 않고 선과 직교하는 방향으로 밀어낸다.
 * 얹으면 선이 글자를 관통해서 읽기 어려워진다.
 */
function labelFor(points: Array<{ x: number; y: number }>, t = 0.5, side: 1 | -1 = 1): RoutedEdge['label'] {
  const [a, b] = [points[0], points[points.length - 1]];
  const at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  const horizontal = Math.abs(b.x - a.x) > Math.abs(b.y - a.y);
  if (horizontal) return { x: at.x, y: at.y - 14, anchor: 'middle' };
  // 세로 선은 좌우 번갈아 — 같은 쪽에 쌓으면 폭 넓은 금액 라벨끼리 겹친다.
  return side > 0 ? { x: at.x + 12, y: at.y, anchor: 'start' } : { x: at.x - 12, y: at.y, anchor: 'end' };
}

export interface LabelBox {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 노드 박스도 장애물로 넣는다 — 라벨이 박스 안 글자 위에 얹히던 문제. */
export const nodeObstacles = (nodes: PlacedNode[]): LabelBox[] =>
  nodes.map((n) => ({ key: `node:${n.id}`, x: n.x + n.w / 2, y: n.y + n.h / 2, w: n.w, h: n.h }));

/**
 * 라벨끼리 겹치면 아래로 밀어낸다.
 *
 * 레인 간격을 손으로 맞추는 방식은 토큰 심볼 길이에 따라 계속 깨졌다.
 * 배치가 끝난 뒤 실제 글상자 크기로 한 번 정리하는 편이 확실하다.
 */
export function declutter(boxes: LabelBox[], fixed: LabelBox[] = [], gap = 6): Map<string, number> {
  const moved = new Map<string, number>();
  const settled: LabelBox[] = [...fixed];
  for (const box of [...boxes].sort((a, b) => a.y - b.y)) {
    const cur = { ...box };
    let guard = 0;
    let collided = true;
    while (collided && guard++ < 40) {
      collided = false;
      for (const s of settled) {
        const overlapX = Math.abs(cur.x - s.x) < (cur.w + s.w) / 2 + gap;
        const overlapY = Math.abs(cur.y - s.y) < (cur.h + s.h) / 2 + gap;
        if (overlapX && overlapY) {
          cur.y = s.y + (s.h + cur.h) / 2 + gap;
          collided = true;
        }
      }
    }
    settled.push(cur);
    if (cur.y !== box.y) moved.set(box.key, cur.y - box.y);
  }
  return moved;
}
