// SVG를 직접 쓴다 (기획서 §9). 다이어그램 라이브러리 없음.
import { useEffect, useMemo, useRef, useState } from 'react';
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

export type Mode = 'trader' | 'engineer';

interface Props {
  graph: Graph;
  locale: Locale;
  /** trader = 정산만. engineer = 그 정산을 설명하는 회계 델타(채무)를 오버레이 (기획서 §4). */
  mode: Mode;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 화면 픽셀 → SVG 좌표. preserveAspectRatio "meet"의 레터박스 오프셋까지 계산한다. */
function clientToSvg(svg: SVGSVGElement, vb: Box, clientX: number, clientY: number) {
  const r = svg.getBoundingClientRect();
  const scale = Math.min(r.width / vb.w, r.height / vb.h);
  const ox = (r.width - vb.w * scale) / 2;
  const oy = (r.height - vb.h * scale) / 2;
  return {
    x: vb.x + (clientX - r.left - ox) / scale,
    y: vb.y + (clientY - r.top - oy) / scale,
    scale,
  };
}

export function Diagram({ graph, locale, mode }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [hovered, setHovered] = useState<RoutedEdge | null>(null);

  const view = useMemo(() => layout(graph, expanded, mode === 'engineer'), [graph, expanded, mode]);

  // 라벨은 배치가 끝난 뒤 실제 글자 폭으로 한 번 더 정리한다.
  // 같은 글상자를 겹침 해소와 경계 계산에 함께 쓴다 — 따로 재면 어긋나서 라벨이 잘린다.
  // 줄기 하나의 블록(금액 목록 + 배지)이 상자 하나다.
  const labelBoxes = useMemo<LabelBox[]>(() => {
    const boxes: LabelBox[] = view.edges.map((e) => {
      const texts = e.rows.map((r) => formatEdgeAmount(graph.tokens, r.amount, r.token));
      const w = Math.max(...texts.map((x) => x.length * 7.6), e.hidden ? 110 : 0);
      const top = e.label.rowsY[0] - 11;
      const bottom = (e.label.badgeY ?? e.label.rowsY[e.label.rowsY.length - 1]) + 4;
      const cx =
        e.label.anchor === 'start' ? e.label.x + w / 2 : e.label.anchor === 'end' ? e.label.x - w / 2 : e.label.x;
      return { key: e.key, x: cx, y: (top + bottom) / 2, w, h: bottom - top };
    });
    // "호출 N회" / "개입 · 값 이동 없음" 라벨도 같은 패스에 넣는다 —
    // 빼놓으면 정산 라벨의 배지와 겹친다 (실제로 겹쳤다).
    for (const r of view.reach) {
      if (r.count <= 1) continue;
      const text = t(locale, 'edge.calls', { n: r.count });
      boxes.push({ key: `reach:${r.key}`, x: r.label.x, y: r.label.y - 4, w: text.length * 6.4, h: 12 });
    }
    for (const i of view.intervene) {
      const text = t(locale, 'edge.intervened');
      const w = text.length * 6.4;
      // anchor: end — 오른쪽 끝이 label.x에 붙는다.
      boxes.push({ key: `intervene:${i.key}`, x: i.label.x - w / 2, y: i.label.y - 4, w, h: 12 });
    }
    return boxes;
  }, [view, graph.tokens, locale]);

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

  // --- 줌/팬 ---
  // box(전체가 들어오는 뷰)가 기본값. 사용자가 휠/드래그로 만지면 userBox가 우선한다.
  // 훅을 펼쳐 box가 바뀌어도 사용자가 잡은 시점은 유지한다.
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [userBox, setUserBox] = useState<Box | null>(null);
  const [dragging, setDragging] = useState(false);
  const animCancelRef = useRef<(() => void) | null>(null);
  const fitRef = useRef(box);
  fitRef.current = box;
  const vb = userBox ?? box;
  const vbRef = useRef(vb);
  vbRef.current = vb;
  const zoomPct = Math.round((box.w / vb.w) * 100);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // React의 onWheel은 passive라 preventDefault가 안 먹는다 — 직접 단다.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const svg = svgRef.current;
      if (!svg) return;
      if (animCancelRef.current) animCancelRef.current();
      const cur = vbRef.current;
      const fit = fitRef.current;
      const factor = Math.exp(e.deltaY * 0.0016);
      const w = Math.min(Math.max(cur.w * factor, fit.w / 6), fit.w * 2.5);
      const f = w / cur.w;
      const p = clientToSvg(svg, cur, e.clientX, e.clientY);
      setUserBox({
        x: p.x - (p.x - cur.x) * f,
        y: p.y - (p.y - cur.y) * f,
        w,
        h: cur.h * f,
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = (factor: number) => {
    const cur = vbRef.current;
    const fit = fitRef.current;
    const w = Math.min(Math.max(cur.w * factor, fit.w / 6), fit.w * 2.5);
    const f = w / cur.w;
    const cx = cur.x + cur.w / 2;
    const cy = cur.y + cur.h / 2;
    setUserBox({ x: cx - (cx - cur.x) * f, y: cy - (cy - cur.y) * f, w, h: cur.h * f });
  };

  // --- 흐름 따라가기 (기획서 §6 "단계별 보기") ---
  // 정산 줄기는 layout에서 시간순(첫 movement 기준)으로 나온다. 그 순서대로
  // 하나씩 포커스하며 카메라를 맞추고 나머지는 흐리게 한다.
  // 엔지니어 모드의 회계 오버레이는 따라가기에서 뺀다 — 이야기는 정산 순서다.
  const steps = useMemo(() => view.edges.filter((e) => e.kind === 'settlement'), [view.edges]);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const focusEdge = focusIdx === null ? null : (steps[Math.min(focusIdx, steps.length - 1)] ?? null);

  const animRef = useRef<number | null>(null);
  const cancelAnim = () => {
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
  };

  animCancelRef.current = cancelAnim;
  const animateTo = (target: Box, onDone?: () => void) => {
    cancelAnim();
    const from = vbRef.current;
    const t0 = performance.now();
    const DUR = 300;
    const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / DUR);
      const k = ease(p);
      setUserBox({
        x: from.x + (target.x - from.x) * k,
        y: from.y + (target.y - from.y) * k,
        w: from.w + (target.w - from.w) * k,
        h: from.h + (target.h - from.h) * k,
      });
      if (p < 1) animRef.current = requestAnimationFrame(tick);
      else {
        animRef.current = null;
        onDone?.();
      }
    };
    animRef.current = requestAnimationFrame(tick);
  };

  /** 현재 화살표 + 라벨 블록 + 양쪽 노드가 들어오는 상자. */
  const focusBoxFor = (e: RoutedEdge): Box => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const pt of e.points) {
      xs.push(pt.x);
      ys.push(pt.y);
    }
    const lb = labelBoxes.find((b) => b.key === e.key);
    if (lb) {
      const dy = nudge.get(e.key) ?? 0;
      xs.push(lb.x - lb.w / 2, lb.x + lb.w / 2);
      ys.push(lb.y + dy - lb.h / 2, lb.y + dy + lb.h / 2);
    }
    for (const id of [e.from, e.to]) {
      const n = view.nodes.find((nn) => nn.id === id);
      if (n) {
        xs.push(n.x, n.x + n.w);
        ys.push(n.y, n.y + n.h);
      }
    }
    const PAD = 56;
    const minX = Math.min(...xs) - PAD;
    const minY = Math.min(...ys) - PAD;
    return { x: minX, y: minY, w: Math.max(...xs) + PAD - minX, h: Math.max(...ys) + PAD - minY };
  };

  const stepTo = (idx: number | null) => {
    if (idx === null) {
      setFocusIdx(null);
      // 전체 보기로 되돌아온 뒤 fit 추적 상태(null)로 복귀시킨다.
      animateTo(fitRef.current, () => setUserBox(null));
      return;
    }
    setFocusIdx(Math.max(0, Math.min(steps.length - 1, idx)));
  };
  const stepNext = () => {
    if (focusIdx === null) stepTo(0);
    else if (focusIdx < steps.length - 1) stepTo(focusIdx + 1);
  };
  const stepPrev = () => {
    if (focusIdx === null) return;
    if (focusIdx === 0) stepTo(null);
    else stepTo(focusIdx - 1);
  };

  useEffect(() => {
    if (focusEdge) animateTo(focusBoxFor(focusEdge));
    // focusIdx가 바뀔 때만 카메라를 옮긴다. 훅 펼침(view 변경) 중에는 사용자가 잡은 시점 유지.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIdx]);

  // 키보드: ←/→ 스텝, Esc 종료. 핸들러는 ref로 최신을 참조한다.
  const keyRef = useRef({ stepNext, stepPrev, exit: () => stepTo(null), active: focusIdx !== null });
  keyRef.current = { stepNext, stepPrev, exit: () => stepTo(null), active: focusIdx !== null };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        keyRef.current.stepNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        keyRef.current.stepPrev();
      } else if (e.key === 'Escape' && keyRef.current.active) {
        keyRef.current.exit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 드래그 팬. 4px 넘게 움직였으면 이어지는 click을 삼켜 노드 클릭과 충돌하지 않게 한다.
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    // 캡처는 여기서 걸지 않는다 — pointerdown에서 걸면 click이 svg로
    // 재타게팅되어 노드 클릭(훅 펼치기)이 죽는다. 실제 드래그가 시작되면 건다.
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    const svg = svgRef.current;
    if (!d || !svg) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      d.moved = true;
      cancelAnim();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
    }
    if (!d.moved) return;
    const cur = vbRef.current;
    const { scale } = clientToSvg(svg, cur, e.clientX, e.clientY);
    setUserBox({ ...cur, x: cur.x - dx / scale, y: cur.y - dy / scale });
    d.x = e.clientX;
    d.y = e.clientY;
  };
  const onPointerUp = () => {
    setDragging(false);
    // click 이벤트가 pointer up 뒤에 오므로 moved 플래그는 클릭 캡처에서 지운다.
    if (drag.current && !drag.current.moved) drag.current = null;
  };
  const onClickCapture = (e: React.MouseEvent) => {
    if (drag.current?.moved) {
      e.stopPropagation();
    }
    drag.current = null;
  };

  return (
    <div ref={wrapRef} className={`diagram-wrap${dragging ? ' is-dragging' : ''}`}>
      <svg
        ref={svgRef}
        className={`diagram${focusEdge ? ' is-following' : ''}`}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={t(locale, 'diagram.aria', { hash: graph.txHash })}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
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
          <marker id="arrow-acct" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,1 L9,5 L0,9 z" className="arrow-head acct" />
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
          const isFocus = focusEdge?.key === e.key;
          const acct = e.kind === 'accounting';
          return (
            <g
              key={e.key}
              className={`edge${acct ? ' is-accounting' : ''}${e.hidden ? ' is-hidden-value' : ''}${isHovered ? ' is-hovered' : ''}${isFocus ? ' is-focus' : ''}`}
              onMouseEnter={() => setHovered(e)}
              onMouseLeave={() => setHovered(null)}
            >
              <path className="edge-hit" d={pathOf(e.points)} />
              <path
                className="edge-line"
                d={pathOf(e.points)}
                markerEnd={acct ? 'url(#arrow-acct)' : e.hidden ? 'url(#arrow-hidden)' : 'url(#arrow)'}
              />
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
              className={`node node-${n.type}${focusEdge && (focusEdge.from === n.id || focusEdge.to === n.id) ? ' is-focus-node' : ''}`}
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
            className={`edge-labels${e.kind === 'accounting' ? ' is-accounting' : ''}${e.hidden ? ' is-hidden-value' : ''}${focusEdge?.key === e.key ? ' is-focus-label' : ''}`}
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
          <text
            key={`ilabel-${i.key}`}
            className="intervene-label"
            x={i.label.x}
            y={i.label.y + (nudge.get(`intervene:${i.key}`) ?? 0)}
          >
            {t(locale, 'edge.intervened')}
          </text>
        ))}
        {view.reach.map((r) =>
          r.count > 1 ? (
            <text
              key={`rlabel-${r.key}`}
              className="reach-label"
              x={r.label.x}
              y={r.label.y + (nudge.get(`reach:${r.key}`) ?? 0)}
            >
              {t(locale, 'edge.calls', { n: r.count })}
            </text>
          ) : null,
        )}
      </svg>

      <div className="follow-controls" role="group" aria-label={t(locale, 'follow.label')}>
        <button onClick={stepPrev} disabled={focusIdx === null} aria-label={t(locale, 'follow.prev')}>
          ‹
        </button>
        {focusIdx === null ? (
          <button className="follow-start" onClick={stepNext} disabled={steps.length === 0}>
            {t(locale, 'follow.label')}
          </button>
        ) : (
          <span className="follow-count">
            {focusIdx + 1} / {steps.length}
          </span>
        )}
        <button
          onClick={stepNext}
          disabled={steps.length === 0 || (focusIdx !== null && focusIdx >= steps.length - 1)}
          aria-label={t(locale, 'follow.next')}
        >
          ›
        </button>
        {focusIdx !== null && (
          <button className="follow-exit" onClick={() => stepTo(null)} aria-label={t(locale, 'follow.exit')}>
            ✕
          </button>
        )}
      </div>

      <div className="zoom-controls" role="group" aria-label="Zoom">
        <button onClick={() => zoomBy(1.25)} aria-label={t(locale, 'zoom.out')}>
          −
        </button>
        <button className="zoom-pct" onClick={() => setUserBox(null)} title={t(locale, 'zoom.fit')}>
          {zoomPct}%
        </button>
        <button onClick={() => zoomBy(0.8)} aria-label={t(locale, 'zoom.in')}>
          +
        </button>
      </div>

      {(hovered ?? focusEdge) && <EdgeDetail edge={(hovered ?? focusEdge)!} graph={graph} locale={locale} />}
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
