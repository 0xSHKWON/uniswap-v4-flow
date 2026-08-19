// SVG를 직접 쓴다 (기획서 §9). 다이어그램 라이브러리 없음.
import { useMemo, useState } from 'react';
import type { Graph } from './types';
import { declutter, layout, nodeObstacles, type LabelBox, type PlacedNode, type RoutedEdge } from './layout';
import { describeHookKeys, formatEdgeAmount, shortAddress } from './format';
import { t, type Locale, type StringKey } from './i18n';

const ROLE_KEY: Record<PlacedNode['role'], StringKey> = {
  pool: 'role.pool',
  payer: 'role.payer',
  recipient: 'role.recipient',
  hook: 'role.hook',
  external: 'role.external',
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
  locale: Locale;
}

export function Diagram({ graph, locale }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [hovered, setHovered] = useState<RoutedEdge | null>(null);

  const view = useMemo(() => layout(graph, expanded), [graph, expanded]);

  // 라벨은 배치가 끝난 뒤 실제 글자 폭으로 한 번 더 정리한다.
  // 같은 글상자를 겹침 해소와 경계 계산에 함께 쓴다 — 따로 재면 어긋나서 라벨이 잘린다.
  // 줄기 하나의 블록(금액 목록 + 배지)이 상자 하나다.
  const labelBoxes = useMemo<LabelBox[]>(
    () =>
      view.edges.map((e) => {
        const texts = e.rows.map((r) => formatEdgeAmount(graph.tokens, r.amount, r.token));
        const w = Math.max(...texts.map((x) => x.length * 7.6), e.hidden ? 110 : 0);
        const top = e.label.rowsY[0] - 11;
        const bottom = (e.label.badgeY ?? e.label.rowsY[e.label.rowsY.length - 1]) + 4;
        const cx =
          e.label.anchor === 'start' ? e.label.x + w / 2 : e.label.anchor === 'end' ? e.label.x - w / 2 : e.label.x;
        return { key: e.key, x: cx, y: (top + bottom) / 2, w, h: bottom - top };
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
        aria-label={t(locale, 'diagram.aria', { hash: graph.txHash })}
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
          const allTraits = n.type === 'hook' ? describeHookKeys(n.permissions).map((k) => t(locale, k)) : [];
          const traits = allTraits.length > 2 ? [...allTraits.slice(0, 2), '…'] : allTraits;
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
                {n.known ?? t(locale, ROLE_KEY[n.role])}
              </text>
              <text className="node-label" x="14" y="42">
                {n.type === 'core' ? 'PoolManager' : n.address ? shortAddress(n.address) : n.label}
              </text>
              {n.type === 'core' && (
                <text className="node-sub" x="14" y="60">
                  {t(locale, 'node.pm.sub')}
                </text>
              )}
              {n.type === 'eoa' && (n.role === 'payer' || n.role === 'recipient') && (
                <text className="node-sub" x="14" y="60">
                  {t(locale, 'node.wallet.sub')}
                </text>
              )}
              {n.type === 'hook' && (
                <>
                  <text className="node-sub" x="14" y="60">
                    {traits.join(' · ') || t(locale, 'node.hook.noInfo')}
                  </text>
                  {extras > 0 && (
                    <text className="node-toggle" x="14" y="78">
                      {isOpen ? '▾' : '▸'} {t(locale, 'node.hook.externals', { n: extras })}
                    </text>
                  )}
                </>
              )}
            </g>
          );
        })}

        {/* 라벨은 마지막에 — 선이나 노드 박스에 가리지 않도록. 블록 전체가 함께 밀린다. */}
        {view.edges.map((e) => (
          <g
            key={`label-${e.key}`}
            className={`edge-labels${e.hidden ? ' is-hidden-value' : ''}`}
            transform={`translate(0, ${nudge.get(e.key) ?? 0})`}
          >
            {e.rows.map((row, ri) => (
              <text
                key={ri}
                className="edge-label"
                textAnchor={e.label.anchor}
                x={e.label.x}
                y={e.label.rowsY[ri]}
              >
                {formatEdgeAmount(graph.tokens, row.amount, row.token)}
              </text>
            ))}
            {e.label.badgeY !== null && (
              <text className="edge-sub" textAnchor={e.label.anchor} x={e.label.x} y={e.label.badgeY}>
                {t(locale, 'edge.noTransfer')}
              </text>
            )}
          </g>
        ))}
        {view.intervene.map((i) => (
          <text key={`ilabel-${i.key}`} className="intervene-label" x={i.label.x} y={i.label.y}>
            {t(locale, 'edge.intervened')}
          </text>
        ))}
        {view.reach.map((r) =>
          r.count > 1 ? (
            <text key={`rlabel-${r.key}`} className="reach-label" x={r.label.x} y={r.label.y}>
              {t(locale, 'edge.calls', { n: r.count })}
            </text>
          ) : null,
        )}
      </svg>

      {hovered && <EdgeDetail edge={hovered} graph={graph} locale={locale} />}
    </div>
  );
}

function EdgeDetail({ edge, graph, locale }: { edge: RoutedEdge; graph: Graph; locale: Locale }) {
  const headline =
    edge.rows.length > 1
      ? t(locale, 'detail.movements', { n: edge.rows.length })
      : formatEdgeAmount(graph.tokens, edge.rows[0].amount, edge.rows[0].token);
  return (
    <aside className="edge-detail" aria-live="polite">
      <div className="edge-detail-amount">{headline}</div>
      <div className="edge-detail-rows">
        {edge.rows.map((row, i) => {
          const unique = [...new Set(row.calls.map((c) => c.engineer.call))];
          return (
            <div className="edge-detail-line" key={i}>
              <span className="amt">{formatEdgeAmount(graph.tokens, row.amount, row.token)}</span>
              <code>{unique.join(', ')}</code>
            </div>
          );
        })}
      </div>
      {edge.rows.some((r) => r.claim) && <p className="edge-detail-note">{t(locale, 'detail.claimNote')}</p>}
    </aside>
  );
}
