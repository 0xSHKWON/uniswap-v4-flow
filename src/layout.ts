// 노드 배치는 손으로 한다 (기획서 §9). 자동 레이아웃 라이브러리 없음.
//
// 배치 원리: PoolManager가 허브다. 돈을 낸 쪽이 왼쪽, 받은 쪽이 오른쪽,
// 훅은 PoolManager 아래 레인에 둔다. 훅을 거쳐서만 값을 받은 주소는 오른쪽 위가 아니라
// 그 훅 옆에 붙인다 — 그래야 선이 교차하지 않고 "PM → 훅 → 어디로" 가 한 줄로 읽힌다.
//
// 엣지는 줄기(trunk)로 묶는다. 같은 구간(from→to)의 정산이 여러 토큰이면 화살표를
// 토큰 수만큼 긋는 게 아니라 화살표 하나에 금액을 목록으로 쌓는다. 한 트랜잭션이
// 토큰 8종을 만지는 경우(04-dense) 레인 방식은 라벨이 자기 화살표에서 떨어져 떠다녔다.
import type { Graph, GraphEdge, GraphNode } from './types';

export interface PlacedNode extends GraphNode {
  x: number;
  y: number;
  w: number;
  h: number;
  role: 'pool' | 'payer' | 'recipient' | 'hook' | 'external';
}

/** 줄기 하나에 쌓이는 금액 한 줄. */
export interface EdgeRow {
  token: string | null;
  amount: string;
  hidden: boolean;
  claim: boolean;
  calls: GraphEdge[];
}

export interface EdgeLabel {
  x: number;
  anchor: 'middle' | 'start' | 'end';
  /** 줄별 베이스라인 y. 겹침 해소(nudge)는 블록 전체를 함께 움직인다. */
  rowsY: number[];
  /** "Transfer 이벤트 없음" 배지 — 숨은 줄기에 하나만 단다. */
  badgeY: number | null;
}

export interface RoutedEdge {
  key: string;
  from: string;
  to: string;
  /** settlement = 실제 이동, accounting = 그 이동을 설명하는 채무 (엔지니어 모드 오버레이). */
  kind: 'settlement' | 'accounting';
  hidden: boolean;
  rows: EdgeRow[];
  points: Array<{ x: number; y: number }>;
  label: EdgeLabel;
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
/** 같은 통로를 지나는 줄기 사이 간격. */
const LANE = 44;
export const ROW_H = 15;
export const BADGE_H = 13;

interface FineEdge {
  key: string;
  from: string;
  to: string;
  via: string | null;
  layer: 'settlement' | 'accounting';
  row: EdgeRow;
}

/** 같은 (층, from, to, token, via, 숨김)끼리 금액을 합쳐 토큰 단위 흐름으로 만든다. */
function aggregate(edges: GraphEdge[]): FineEdge[] {
  const groups = new Map<string, FineEdge>();
  for (const e of edges) {
    if (!e.amount) continue;
    const key = [e.layer, e.from, e.to, e.token, e.via ?? '', e.hidden ? 'h' : ''].join('|');
    const found = groups.get(key);
    if (found) {
      found.row.amount = (BigInt(found.row.amount) + BigInt(e.amount)).toString();
      found.row.calls.push(e);
    } else {
      groups.set(key, {
        key,
        from: e.from,
        to: e.to,
        via: e.via ?? null,
        layer: e.layer as FineEdge['layer'],
        row: {
          token: e.token,
          amount: e.amount,
          hidden: Boolean(e.hidden),
          claim: Boolean(e.claim),
          calls: [e],
        },
      });
    }
  }
  return [...groups.values()];
}

export function layout(graph: Graph, expandedHooks: Set<string>, engineer = false): Layout {
  // 엔지니어 모드는 accounting 층(스왑 델타, 훅 몫)을 같은 줄기 시스템에 얹는다.
  // 정산과 채무가 같은 통로를 나눠 쓰므로 corridors가 알아서 벌려준다.
  const aggregated = aggregate(
    graph.edges.filter((e) => e.layer === 'settlement' || (engineer && e.layer === 'accounting')),
  );
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

  // 1) 훅 경유 흐름을 두 구간으로 나눈다. PM → 훅 → 최종 수령자.
  //    훅이 경로 위에 실제로 놓여야 "훅이 뭘 했는지"가 각주가 아니라 선의 모양이 된다.
  interface Segment {
    from: string;
    to: string;
    layer: FineEdge['layer'];
    row: EdgeRow;
  }
  const segments: Segment[] = [];
  for (const e of aggregated) {
    if (!pos.has(e.from) || !pos.has(e.to)) continue;
    const viaNode = e.via ? pos.get(e.via) : null;
    if (viaNode && viaNode.role === 'hook' && e.from !== viaNode.id && e.to !== viaNode.id) {
      segments.push({ from: e.from, to: viaNode.id, layer: e.layer, row: e.row });
      segments.push({ from: viaNode.id, to: e.to, layer: e.layer, row: e.row });
    } else {
      segments.push({ from: e.from, to: e.to, layer: e.layer, row: e.row });
    }
  }

  // 2) 같은 (층, from, to, 숨김) 구간을 줄기 하나로 묶는다. 화살표 하나, 금액은 목록.
  const trunkMap = new Map<
    string,
    { from: string; to: string; kind: FineEdge['layer']; hidden: boolean; rows: EdgeRow[] }
  >();
  for (const s of segments) {
    const key = `${s.layer}|${s.from}|${s.to}|${s.row.hidden ? 'h' : ''}`;
    const found = trunkMap.get(key);
    if (found) found.rows.push(s.row);
    else trunkMap.set(key, { from: s.from, to: s.to, kind: s.layer, hidden: s.row.hidden, rows: [s.row] });
  }

  // 3) 같은 통로(방향 무관)를 지나는 줄기들을 대칭으로 벌리고 라벨 블록을 단다.
  //    블록은 선에서 직교 방향으로 밀어낸다 — 선이 글자를 관통하면 안 읽힌다.
  const trunks = [...trunkMap.entries()];
  const corridorSize = new Map<string, number>();
  const corridorKey = (t: { from: string; to: string }) => [t.from, t.to].sort().join('|');
  for (const [, t] of trunks) corridorSize.set(corridorKey(t), (corridorSize.get(corridorKey(t)) ?? 0) + 1);

  const corridorSeen = new Map<string, number>();
  const routed: RoutedEdge[] = [];
  for (const [key, t] of trunks) {
    const a = pos.get(t.from)!;
    const b = pos.get(t.to)!;
    const n = corridorSize.get(corridorKey(t)) ?? 1;
    const i = corridorSeen.get(corridorKey(t)) ?? 0;
    corridorSeen.set(corridorKey(t), i + 1);
    const shift = (i - (n - 1) / 2) * LANE;

    let points: Array<{ x: number; y: number }>;
    let horizontal: boolean;
    if (a.x < b.x) {
      points = [right(a), left(b)];
      horizontal = true;
    } else if (a.x > b.x) {
      points = [left(a), right(b)];
      horizontal = true;
    } else {
      points = [bottom(a), top(b)];
      horizontal = false;
    }
    points = points.map((pt) => (horizontal ? { ...pt, y: pt.y + shift } : { ...pt, x: pt.x + shift }));

    const mid = {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2,
    };
    const rows = t.rows.length;
    const badge = t.hidden;

    let label: EdgeLabel;
    if (horizontal) {
      // 위 레인(shift ≤ 0)은 블록을 선 위로, 아래 레인은 선 아래로.
      if (shift <= 0) {
        const badgeY = badge ? mid.y - 12 : null;
        const lastRowY = mid.y - 12 - (badge ? BADGE_H : 0);
        label = {
          x: mid.x,
          anchor: 'middle',
          rowsY: Array.from({ length: rows }, (_, r) => lastRowY - (rows - 1 - r) * ROW_H),
          badgeY,
        };
      } else {
        const firstRowY = mid.y + 22;
        label = {
          x: mid.x,
          anchor: 'middle',
          rowsY: Array.from({ length: rows }, (_, r) => firstRowY + r * ROW_H),
          badgeY: badge ? firstRowY + rows * ROW_H - 2 : null,
        };
      }
    } else {
      // 세로 줄기는 좌우 번갈아, 블록은 세로로 중앙 정렬.
      const side: 'start' | 'end' = i % 2 === 0 ? 'start' : 'end';
      const total = rows * ROW_H + (badge ? BADGE_H : 0);
      const firstRowY = mid.y - total / 2 + 11;
      label = {
        x: side === 'start' ? mid.x + 12 : mid.x - 12,
        anchor: side,
        rowsY: Array.from({ length: rows }, (_, r) => firstRowY + r * ROW_H),
        badgeY: badge ? firstRowY + rows * ROW_H - 2 : null,
      };
    }

    routed.push({ key, from: t.from, to: t.to, kind: t.kind, hidden: t.hidden, rows: t.rows, points, label });
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
      // 라벨은 목적지 쪽(78% 지점)에 둔다. 부채꼴로 퍼지는 선들의 중점은
      // 시작점 근처에 모여 있어서 라벨끼리, 그리고 정산 라벨과 겹친다.
      const lt = 0.78;
      reach.push({
        key: `${e.from}->${e.to}`,
        points: seg,
        count: e.engineer.count ?? 1,
        label: {
          x: seg[0].x + (seg[1].x - seg[0].x) * lt,
          y: seg[0].y + (seg[1].y - seg[0].y) * lt - 8,
        },
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
    const blockTop = r.label.rowsY[0] - 12;
    const blockBottom = (r.label.badgeY ?? r.label.rowsY[r.label.rowsY.length - 1]) + 6;
    ys.push(blockTop, blockBottom);
    if (r.label.anchor === 'middle') xs.push(r.label.x - 90, r.label.x + 90);
    else if (r.label.anchor === 'start') xs.push(r.label.x, r.label.x + 150);
    else xs.push(r.label.x - 150, r.label.x);
  }
  for (const group of [...intervene, ...reach]) {
    for (const pt of group.points) {
      xs.push(pt.x);
      ys.push(pt.y);
    }
    xs.push(group.label.x - 170, group.label.x + 20);
    ys.push(group.label.y - 14, group.label.y + 8);
  }

  const PAD = 26;
  const minX = Math.min(...xs) - PAD;
  const minY = Math.min(...ys) - PAD;
  const w = Math.max(...xs) + PAD - minX;
  const h = Math.max(...ys) + PAD - minY;
  return { viewBox: { x: minX, y: minY, w, h }, width: w, height: h, nodes: placed, edges: routed, reach, intervene };
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
