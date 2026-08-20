// M1 — 단일 트랜잭션 렌더링. 해시 하드코딩, 배포 안 함 (기획서 §8).
//
// 레이아웃은 인스펙터 구조다: 왼쪽 사이드바(트랜잭션 정보 · 요약 · 예시 목록),
// 오른쪽 풀블리드 캔버스. 입력창(M2)은 사이드바의 트랜잭션 섹션 자리에 들어온다.
import { useMemo, useState } from 'react';
import { Diagram } from './Diagram';
import { describeHookKeys, shortAddress, tokenOf } from './format';
import { t, useLocale } from './i18n';
import type { FixtureIndexEntry, Graph } from './types';

import index from './fixtures/index.json';
import noHook from './fixtures/01-no-hook.json';
import hookFee from './fixtures/02-hook-takes-fee.json';
import hookReach from './fixtures/03-hook-with-reach.json';
import dense from './fixtures/04-dense.json';
import twoHooks from './fixtures/05-two-hooks.json';
import multihop from './fixtures/06-multihop-three-hooks.json';

const GRAPHS: Record<string, Graph> = {
  '01-no-hook': noHook as Graph,
  '02-hook-takes-fee': hookFee as Graph,
  '03-hook-with-reach': hookReach as Graph,
  '04-dense': dense as Graph,
  '05-two-hooks': twoHooks as Graph,
  '06-multihop-three-hooks': multihop as Graph,
};

const FIXTURES = index as FixtureIndexEntry[];
const DEFAULT_SLUG = '03-hook-with-reach';

export default function App() {
  const [locale, setLocale] = useLocale();
  const [slug, setSlug] = useState(DEFAULT_SLUG);
  const [copied, setCopied] = useState(false);
  const graph = GRAPHS[slug];
  const meta = FIXTURES.find((f) => f.slug === slug);

  const copyHash = () => {
    navigator.clipboard?.writeText(graph.txHash).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  // 요약 통계 — 전부 그래프 JSON에서 유도한다. RPC 없음.
  const summary = useMemo(() => {
    const settlements = graph.edges.filter((e) => e.layer === 'settlement' && e.amount);
    const hiddenCount = settlements.filter((e) => e.hidden).length;
    const symbols = [
      ...new Set(settlements.map((e) => tokenOf(graph.tokens, e.token).symbol).filter(Boolean)),
    ];
    const hooks = graph.nodes
      .filter((n) => n.type === 'hook')
      .map((n) => ({
        address: n.address ?? '',
        traits: describeHookKeys(n.permissions).map((k) => t(locale, k)),
      }));
    return { movements: settlements.length, hiddenCount, symbols, hooks };
  }, [graph, locale]);

  return (
    <div className="viz-root">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <h1>{t(locale, 'title')}</h1>
        </div>
        <div className="lang-toggle" role="group" aria-label="Language">
          <button className={locale === 'ko' ? 'is-active' : ''} onClick={() => setLocale('ko')}>
            KR
          </button>
          <button className={locale === 'en' ? 'is-active' : ''} onClick={() => setLocale('en')}>
            EN
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <section className="side-section">
            <h2>{t(locale, 'side.tx')}</h2>
            <button className="tx-chip" onClick={copyHash} title={graph.txHash}>
              <span className="chain">{graph.chain}</span>
              <code>{copied ? t(locale, 'hash.copied') : `${graph.txHash.slice(0, 10)}…${graph.txHash.slice(-8)}`}</code>
            </button>
            {meta && (
              <>
                <h3 className="side-title">{meta.title[locale]}</h3>
                <p className="side-blurb">{meta.blurb[locale]}</p>
              </>
            )}
          </section>

          <section className="side-section">
            <h2>{t(locale, 'side.summary')}</h2>
            <dl className="stats">
              <div>
                <dt>{t(locale, 'sum.movements')}</dt>
                <dd>{summary.movements}</dd>
              </div>
              <div className={summary.hiddenCount ? 'is-hidden-stat' : ''}>
                <dt>{t(locale, 'sum.hidden')}</dt>
                <dd>{summary.hiddenCount}</dd>
              </div>
            </dl>
            {summary.symbols.length > 0 && (
              <div className="side-row">
                <span className="side-row-label">{t(locale, 'sum.tokens')}</span>
                <div className="token-chips">
                  {summary.symbols.map((s) => (
                    <span key={s} className="token-chip">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {summary.hooks.length > 0 && (
              <div className="side-row">
                <span className="side-row-label">{t(locale, 'sum.hooks')}</span>
                <ul className="hook-list">
                  {summary.hooks.map((h) => (
                    <li key={h.address}>
                      <code>{shortAddress(h.address)}</code>
                      <span>{h.traits.join(' · ')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="side-section side-examples">
            <h2>{t(locale, 'examples.label')}</h2>
            <div className="example-list">
              {FIXTURES.map((f) => (
                <button key={f.slug} className={f.slug === slug ? 'is-active' : ''} onClick={() => setSlug(f.slug)}>
                  <span className="example-title">{f.title[locale]}</span>
                  <span className="example-meta">{t(locale, 'examples.meta', { nodes: f.nodes, hooks: f.hooks })}</span>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="canvas">
          <Diagram key={slug} graph={graph} locale={locale} />
          <div className="canvas-foot">
            <p className="legend">
              <span className="swatch swatch-flow" /> {t(locale, 'legend.settled')}
              <span className="swatch swatch-hidden" /> {t(locale, 'legend.hidden')}
              <span className="swatch swatch-hook" /> {t(locale, 'legend.hook')}
            </p>
            <p className="note">{t(locale, 'note')}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
