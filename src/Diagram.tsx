// SVG를 직접 쓴다 (기획서 §9). 다이어그램 라이브러리 없음.
import { useMemo, useState } from 'react';
import type { Graph } from './types';
import { declutter, layout, nodeObstacles, type LabelBox, type PlacedNode, type RoutedEdge } from './layout';
import { describeHook, formatEdgeAmount, shortAddress } from './format';

const ROLE_LABEL: Record<PlacedNode['role'], string> = {
  pool: 'v4 코어',
  payer: '지불',
  recipient: '수령',
  hook: '훅',
  external: '훅이 호출한 컨트랙트',
};

/** 직교 폴리라인 — 모서리를 둥글게. 훅 박스를 피해 도는 개입선에 쓴다. */
function polyPath(points: Array<{ x: number; y: number }>, radius = 12): string {
  if (points.length < 3) return `M${points[0].x},${points[0].y} L${points[1].x},${points[1].y}`;
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const r1 = Math.min(radius, Math.hypot(cur.x - prev.x, cur.y - prev.y) / 2);
    const r2 = Math.min(radius, Math.hypot(next.x - cur.x, next.y - cur.y) / 2);
    const from = lerpTo(cur, prev, r1);
    const to = lerpTo(cur, next, r2);
    d += ` L${from.x},${from.y} Q${cur.x},${cur.y} ${to.x},${to.y}`;
  }
  const last = points[points.length - 1];
  return `${d} L${last.x},${last.y}`;
}

function lerpTo(from: { x: number; y: number }, toward: { x: number; y: number }, dist: number) {
  const len = Math.hypot(toward.x - from.x, toward.y - from.y) || 1;
  return { x: from.x + ((toward.x - from.x) / len) * dist, y: from.y + ((toward.y - from.y) / len) * dist };
}

function pathOf(points: Array<{ x: number; y: number }>): string {
  const [a, b] = [points[0], points[points.length - 1]];
  // 가로 이동이면 완만한 S커브, 세로 이동이면 직선에 가깝게.
  if (Math.abs(a.x - b.x) > Math.abs(a.y - b.y)) {
    const dx = (b.x - a.x) * 0.42;
    return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
  }
  const dy = (b.y - a.y) * 0.45;
  return `M${a.x},${a.y} C${a.x},${a.y + dy} ${b.x},${b.y - dy} ${b.x},${b.y}`;
}

interface Props {
  graph: Graph;
}

export function Diagram({ graph }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [hovered, setHovered] = useState<RoutedEdge | null>(null);

  const view = useMemo(() => layout(graph, expanded), [graph, expanded]);

  // 라벨은 배치가 끝난 뒤 실제 글자 폭으로 한 번 더 정리한다.
  // 같은 글상자를 겹침 해소와 경계 계산에 함께 쓴다 — 따로 재면 어긋나서 라벨이 잘린다.
  const labelBoxes = useMemo<LabelBox[]>(
    () =>
      view.edges.map((e) => {
        const text = formatEdgeAmount(graph.tokens, e.amount, e.token);
        const w = Math.max(text.length * 7.6, e.hidden ? 110 : 0);
        const cx =
          e.label.anchor === 'start' ? e.label.x + w / 2 : e.label.anchor === 'end' ? e.label.x - w / 2 : e.label.x;
        return { key: e.key, x: cx, y: e.label.y, w, h: e.hidden ? 26 : 14 };
      }),
    [view, graph.tokens],
  );

  const nudge = useMemo(() => declutter(labelBoxes, nodeObstacles(view.nodes)), [labelBoxes, view.nodes]);

  // 라벨을 밀어낸 뒤 상하좌우로 넘칠 수 있으므로 viewBox를 다시 잡는다.
  const box = useMemo(() => {
    const vb = view.viewBox;
    let [minX, minY, maxX, maxY] = [vb.x, vb.y, vb.x + vb.w, vb.y + vb.h];
    for (const b of labelBoxes) {
      const dy = nudge.get(b.key) ?? 0;
      minX = Math.min(minX, b.x - b.w / 2 - 10);
      maxX = Math.max(maxX, b.x + b.w / 2 + 10);
      minY = Math.min(minY, b.y + dy - b.h / 2 - 10);
      maxY = Math.max(maxY, b.y + dy + b.h / 2 + 10);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }, [view.viewBox, labelBoxes, nudge]);

  const toggleHook = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const reachCount = (hookId: string) =>
    graph.edges.filter((e) => e.layer === 'reach' && e.from === hookId).length;

  return (
    <div className="diagram-wrap">
      <svg
        className="diagram"
        style={{ maxWidth: box.w }}
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        role="img"
        aria-label={`트랜잭션 ${graph.txHash} 자금 흐름도`}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,1 L9,5 L0,9 z" className="arrow-head" />
          </marker>
          <marker id="arrow-hidden" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,1 L9,5 L0,9 z" className="arrow-head hidden" />
          </marker>
          <marker id="arrow-muted" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,1 L9,5 L0,9 z" className="arrow-head muted" />
          </marker>
        </defs>

        {/* 값은 안 움직였지만 호출된 훅 — 떠 있지 않도록 중립선으로 잇는다. */}
        {view.intervene.map((i) => (
          <g key={i.key} className="intervene">
            <path d={polyPath(i.points)} markerEnd="url(#arrow-muted)" />
          </g>
        ))}

        {/* 훅 → 외부 컨트랙트. 금액이 없는 관계선이므로 점선으로 구분한다. */}
        {view.reach.map((r) => (
          <g key={r.key} className="reach">
            <path d={pathOf(r.points)} markerEnd="url(#arrow-muted)" />
          </g>
        ))}

        {view.edges.map((e) => {
          const isHovered = hovered?.key === e.key;
          return (
            <g
              key={e.key}
              className={`edge${e.hidden ? ' is-hidden-value' : ''}${isHovered ? ' is-hovered' : ''}`}
              onMouseEnter={() => setHovered(e)}
              onMouseLeave={() => setHovered(null)}
            >
              <path className="edge-hit" d={pathOf(e.points)} />
              <path className="edge-line" d={pathOf(e.points)} markerEnd={e.hidden ? 'url(#arrow-hidden)' : 'url(#arrow)'} />
            </g>
          );
        })}

        {view.nodes.map((n) => {
          const traits = n.type === 'hook' ? describeHook(n.permissions) : [];
          const extras = n.type === 'hook' ? reachCount(n.id) : 0;
          const isOpen = expanded.has(n.id);
          return (
            <g
              key={n.id}
              className={`node node-${n.type}`}
              transform={`translate(${n.x}, ${n.y})`}
              onClick={n.type === 'hook' && extras > 0 ? () => toggleHook(n.id) : undefined}
              style={n.type === 'hook' && extras > 0 ? { cursor: 'pointer' } : undefined}
            >
              <rect width={n.w} height={n.h} rx="10" />
              <text className="node-role" x="14" y="20">
                {n.known ?? ROLE_LABEL[n.role]}
              </text>
              <text className="node-label" x="14" y="42">
                {n.type === 'core' ? 'PoolManager' : n.address ? shortAddress(n.address) : n.label}
              </text>
              {n.type === 'core' && (
                <text className="node-sub" x="14" y="60">
                  모든 정산이 여기를 통과한다
                </text>
              )}
              {n.role === 'payer' && n.type === 'eoa' && (
                <text className="node-sub" x="14" y="60">
                  이 트랜잭션을 보낸 지갑
                </text>
              )}
              {n.role === 'recipient' && n.type === 'eoa' && (
                <text className="node-sub" x="14" y="60">
                  이 트랜잭션을 보낸 지갑
                </text>
              )}
              {n.type === 'hook' && (
                <>
                  <text className="node-sub" x="14" y="60">
                    {traits.join(' · ') || '권한 정보 없음'}
                  </text>
                  {extras > 0 && (
                    <text className="node-toggle" x="14" y="78">
                      {isOpen ? '▾' : '▸'} 외부 컨트랙트 {extras}개
                    </text>
                  )}
                </>
              )}
            </g>
          );
        })}

        {/* 라벨은 마지막에 — 선이나 노드 박스에 가리지 않도록 */}
        {view.edges.map((e) => {
          const amount = formatEdgeAmount(graph.tokens, e.amount, e.token);
          return (
            <g
              key={`label-${e.key}`}
              className={`edge-labels${e.hidden ? ' is-hidden-value' : ''}`}
              transform={`translate(${e.label.x}, ${e.label.y + (nudge.get(e.key) ?? 0)})`}
            >
              <text className="edge-label" textAnchor={e.label.anchor} dy={e.hidden ? '-4' : '0'}>
                {amount}
              </text>
              {e.hidden && (
                <text className="edge-sub" textAnchor={e.label.anchor} dy="11">
                  Transfer 이벤트 없음
                </text>
              )}
            </g>
          );
        })}
        {view.intervene.map((i) => (
          <text key={`ilabel-${i.key}`} className="intervene-label" x={i.label.x} y={i.label.y}>
            개입 · 값 이동 없음
          </text>
        ))}
        {view.reach.map((r) =>
          r.count > 1 ? (
            <text key={`rlabel-${r.key}`} className="reach-label" x={r.label.x} y={r.label.y}>
              호출 {r.count}회
            </text>
          ) : null,
        )}
      </svg>

      {hovered && <EdgeDetail edge={hovered} graph={graph} />}
    </div>
  );
}

function EdgeDetail({ edge, graph }: { edge: RoutedEdge; graph: Graph }) {
  const amount = formatEdgeAmount(graph.tokens, edge.amount, edge.token);
  const calls = edge.calls.map((c) => c.engineer.call);
  const unique = [...new Set(calls)];
  return (
    <aside className="edge-detail" aria-live="polite">
      <div className="edge-detail-amount">{amount}</div>
      <div className="edge-detail-row">
        <span>호출</span>
        <code>
          {unique.join(', ')}
          {calls.length > unique.length ? ` ×${calls.length}` : ''}
        </code>
      </div>
      {edge.claim && (
        <p className="edge-detail-note">
          ERC-6909 청구권이라 토큰이 PoolManager 밖으로 나가지 않는다. Transfer 이벤트가 없으므로
          일반 익스플로러에는 이 이동이 표시되지 않는다.
        </p>
      )}
    </aside>
  );
}
