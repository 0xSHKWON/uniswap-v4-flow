// 엔지니어 모드의 코드 패널 (M3'). 다이어그램 옆에 도킹되어
// unlock() 안의 장부 기록을 실행 순서대로 보여준다. trace.ts 참조.
//
// 다이어그램과 양방향으로 붙어 있다: 줄 호버 → 해당 엣지 강조(onHoverLine),
// 줄 클릭 → 카메라 포커스(onClickLine), 다이어그램 호버/포커스 → 줄 강조(activeEdges).
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatAmount, tokenOf } from './format';
import { t, type Locale } from './i18n';
import { HOOK_FLAGS, buildTrace, hookBits, nodeName, type TraceLine } from './trace';
import type { Graph, GraphEdge } from './types';

interface Props {
  graph: Graph;
  locale: Locale;
  /** 다이어그램에서 호버/포커스된 줄기에 속한 원본 엣지들. 줄 강조용. */
  activeEdges: Set<GraphEdge> | null;
  onHoverLine: (edge: GraphEdge | null) => void;
  onClickLine: (edge: GraphEdge) => void;
}

export function TracePanel({ graph, locale, activeEdges, onHoverLine, onClickLine }: Props) {
  const trace = useMemo(() => buildTrace(graph), [graph]);
  const [raw, setRaw] = useState(false);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const insideRef = useRef(false);

  // 다이어그램 쪽에서 강조가 오면 그 줄이 보이게 스크롤한다.
  // 포인터가 패널 안에 있으면(강조의 출처가 이 패널이면) 건드리지 않는다.
  useEffect(() => {
    if (!activeEdges || insideRef.current) return;
    scrollRef.current?.querySelector('.trace-line.is-hl')?.scrollIntoView({ block: 'nearest' });
  }, [activeEdges]);

  const signed = (v: bigint, token: string) => {
    const meta = tokenOf(graph.tokens, token);
    const body = raw ? v.toString() : formatAmount(v.toString(), meta.decimals);
    return `${v > 0n ? '+' : ''}${body} ${meta.symbol}`;
  };

  const lineClass = (l: TraceLine) =>
    l.hookCut ? 'is-hookcut' : l.hidden ? 'is-hidden' : l.kind === 'accounting' ? 'is-acct' : 'is-settle';

  // 푸터: 호버 중이면 그 줄 직후 스냅샷, 아니면 종료 시점.
  const snapLine = hoverIdx === null ? null : trace.lines[hoverIdx - 1];
  const snapshot = snapLine ? snapLine.outstanding : trace.residual;

  const hooks = graph.nodes.filter((n) => n.type === 'hook');
  const reachOf = (hookId: string) =>
    graph.edges
      .filter((e) => e.layer === 'reach' && e.from === hookId)
      .map((e) => ({ to: nodeName(graph, e.to), count: e.engineer.count ?? 1 }));

  return (
    <aside className={`trace-panel${raw ? ' is-raw' : ''}`} aria-label={t(locale, 'trace.title')}>
      <header className="trace-head">
        <div>
          <h2>{t(locale, 'trace.title')}</h2>
          <p className="trace-ops">{t(locale, 'trace.ops', { n: trace.lines.length })}</p>
        </div>
        <div className="trace-units" role="group" aria-label="Units">
          <button className={raw ? '' : 'is-active'} onClick={() => setRaw(false)}>
            fmt
          </button>
          <button className={raw ? 'is-active' : ''} onClick={() => setRaw(true)}>
            raw
          </button>
        </div>
      </header>

      <div
        className="trace-scroll"
        ref={scrollRef}
        onPointerEnter={() => {
          insideRef.current = true;
        }}
        onPointerLeave={() => {
          insideRef.current = false;
        }}
      >
        <ol className="trace-lines">
          {trace.lines.map((l) => (
            <li key={l.idx}>
              <button
                className={`trace-line ${lineClass(l)}${activeEdges?.has(l.edge) ? ' is-hl' : ''}`}
                onMouseEnter={() => {
                  setHoverIdx(l.idx);
                  onHoverLine(l.edge);
                }}
                onMouseLeave={() => {
                  setHoverIdx(null);
                  onHoverLine(null);
                }}
                onClick={() => onClickLine(l.edge)}
                title={`${l.signed} (raw)`}
              >
                <span className="tl-idx">{String(l.idx).padStart(2, '0')}</span>
                <span className="tl-call">
                  {l.call}
                  {l.args && <span className="tl-args">({l.args})</span>}
                </span>
                <span className="tl-amt">{signed(l.signed, l.token)}</span>
                <span className="tl-route">
                  {nodeName(graph, l.from)} → {nodeName(graph, l.to)}
                  {l.edge.via && <span className="tl-via"> · via {nodeName(graph, l.edge.via)}</span>}
                  {l.zeroed.length > 0 && <span className="tl-zero">Δ→0</span>}
                </span>
              </button>
            </li>
          ))}
        </ol>

        {hooks.length > 0 && (
          <section className="trace-hooks">
            <h3>{t(locale, 'trace.hooks')}</h3>
            <p className="trace-hooks-sub">{t(locale, 'trace.hooksSub')}</p>
            {hooks.map((h) => {
              const bits = h.address ? hookBits(h.address) : 0;
              return (
                <div key={h.id} className="trace-hook">
                  {h.known && <strong>{h.known}</strong>}
                  <code className="th-addr">{h.address}</code>
                  <div className="th-bits">
                    <span className="th-bits-label">&amp; 0x3FFF</span>
                    <code>
                      {HOOK_FLAGS.map(([name, bit]) => (
                        <span key={bit}>
                          <span className={bits & (1 << bit) ? 'is-set' : ''} title={name}>
                            {bits & (1 << bit) ? '1' : '0'}
                          </span>
                          {bit % 4 === 0 && bit > 0 ? ' ' : ''}
                        </span>
                      ))}
                    </code>
                  </div>
                  <ul className="th-flags">
                    {HOOK_FLAGS.filter(([, bit]) => bits & (1 << bit)).map(([name]) => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                  {h.callbacks && h.callbacks.length > 0 && (
                    <p className="th-cb">
                      {t(locale, 'trace.callbacks')}: <code>{h.callbacks.join(', ')}</code>
                    </p>
                  )}
                  {reachOf(h.id).map((r) => (
                    <p key={r.to} className="th-reach">
                      → {r.to}
                      {r.count > 1 && ` ×${r.count}`}
                    </p>
                  ))}
                </div>
              );
            })}
          </section>
        )}
      </div>

      <footer className="trace-foot">
        <div className="trace-foot-head">
          <span className="trace-foot-label">{t(locale, 'trace.outstanding')}</span>
          <span className="trace-foot-ctx">
            {snapLine ? t(locale, 'trace.afterLine', { n: snapLine.idx }) : t(locale, 'trace.atEnd')}
          </span>
        </div>
        {snapshot.length === 0 ? (
          <p className={`trace-zero${graph.balanced ? '' : ' is-warn'}`}>
            {t(locale, graph.balanced || snapLine ? 'trace.allZero' : 'trace.unbalanced')}
          </p>
        ) : (
          <ul className="trace-outstanding">
            {snapshot.map(([token, v]) => (
              <li key={token}>
                <span className="to-token">{tokenOf(graph.tokens, token).symbol}</span>
                <span className="to-amt">{signed(v, token)}</span>
              </li>
            ))}
          </ul>
        )}
        {!snapLine && snapshot.length > 0 && <p className="trace-zero is-warn">{t(locale, 'trace.unbalanced')}</p>}
        <p className="trace-sign-hint">{t(locale, 'trace.signHint')}</p>
      </footer>
    </aside>
  );
}
