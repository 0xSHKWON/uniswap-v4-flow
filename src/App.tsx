// M1 — 단일 트랜잭션 렌더링. 해시 하드코딩, 배포 안 함 (기획서 §8).
//
// 입력창은 M2, 모드 토글은 M3이므로 여기엔 없다.
// 예시 선택기는 레이아웃이 복잡도 사다리 전체에서 무너지지 않는지 확인하려고 둔 개발용 장치다.
// 언어는 EN 기본, ?lang=ko 또는 우상단 토글 (i18n.ts).
import { useState } from 'react';
import { Diagram } from './Diagram';
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

  return (
    <div className="viz-root">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <h1>{t(locale, 'title')}</h1>
        </div>

        {/* 해시는 헤더에 산다 — 본문 위에 메타 줄을 쌓으면 캔버스 시작이 밀린다. */}
        <button className="tx-chip" onClick={copyHash} title={graph.txHash}>
          <span className="chain">{graph.chain}</span>
          <code>{copied ? t(locale, 'hash.copied') : `${graph.txHash.slice(0, 10)}…${graph.txHash.slice(-8)}`}</code>
        </button>

        <div className="lang-toggle" role="group" aria-label="Language">
          <button className={locale === 'ko' ? 'is-active' : ''} onClick={() => setLocale('ko')}>
            KR
          </button>
          <button className={locale === 'en' ? 'is-active' : ''} onClick={() => setLocale('en')}>
            EN
          </button>
        </div>
      </header>

      <main className="page">
        <section className="canvas">
          <Diagram key={slug} graph={graph} locale={locale} />
          {meta && (
            <div className="caption" aria-hidden="true">
              <strong>{meta.title[locale]}</strong>
              <span>{meta.blurb[locale]}</span>
            </div>
          )}
          <div className="canvas-foot">
            <p className="legend">
              <span className="swatch swatch-flow" /> {t(locale, 'legend.settled')}
              <span className="swatch swatch-hidden" /> {t(locale, 'legend.hidden')}
              <span className="swatch swatch-hook" /> {t(locale, 'legend.hook')}
            </p>
            <p className="note">{t(locale, 'note')}</p>
          </div>
        </section>

        <nav className="examples" aria-label={t(locale, 'examples.label')}>
          <span className="examples-label">{t(locale, 'examples.label')}</span>
          <div className="examples-row">
            {FIXTURES.map((f) => (
              <button key={f.slug} className={f.slug === slug ? 'is-active' : ''} onClick={() => setSlug(f.slug)}>
                {f.title[locale]}
                <span>{t(locale, 'examples.meta', { nodes: f.nodes, hooks: f.hooks })}</span>
              </button>
            ))}
          </div>
        </nav>
      </main>
    </div>
  );
}
