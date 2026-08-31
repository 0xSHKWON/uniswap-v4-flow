// M2' — 앱 카탈로그. 트랜잭션 목록이 아니라 v4 위의 앱(훅 프로토콜) 목록으로 조직하고,
// 앱마다 대표 트랜잭션(흐름)을 2~3개 보여준다. 해시 하드코딩, 배포 안 함 (기획서 §8).
//
// 레이아웃은 인스펙터 구조다: 왼쪽 사이드바(트랜잭션 정보 · 요약 · 앱 목록),
// 오른쪽 풀블리드 캔버스. 입력창(M4')은 사이드바의 트랜잭션 섹션 자리에 들어온다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Diagram, type Mode } from './Diagram';
import { describeHookKeys, shortAddress, tokenOf } from './format';
import { t, useLocale } from './i18n';
import type { AppEntry, Graph } from './types';

import appsJson from './fixtures/apps.json';

// 플로우 픽스처는 슬러그가 곧 파일명이라 글롭으로 한 번에 집는다.
const GRAPHS: Record<string, Graph> = Object.fromEntries(
  Object.entries(import.meta.glob('./fixtures/*.json', { eager: true, import: 'default' }))
    .filter(([path]) => !path.endsWith('apps.json'))
    .map(([path, mod]) => [path.replace('./fixtures/', '').replace('.json', ''), mod as Graph]),
);

const APPS = appsJson as AppEntry[];
const DEFAULT_CHAIN = 'unichain';
/** 체인별 기본 앱 — 그 체인에서 가장 이야기가 좋은 것. */
const DEFAULT_APP: Record<string, string> = { unichain: 'aegis', base: 'zora' };

const appsOn = (chain: string) => APPS.filter((a) => a.chain === chain);
const defaultAppOn = (chain: string) =>
  APPS.find((a) => a.chain === chain && a.id === DEFAULT_APP[chain]) ?? appsOn(chain)[0];

// 앱/흐름 선택은 URL(?chain=base&app=zora&flow=…)에 담는다 — 공유 링크가 보던 화면
// 그대로 열려야 한다는 기획서 §4 규칙. 언어(?lang)와 같은 방식: 기본값이면 파라미터를 지운다.
function selectionFromURL(): { chain: string; appId: string; slug: string } {
  const p = new URLSearchParams(window.location.search);
  // flow가 있으면 앱과 체인까지 유도된다 — 슬러그는 전 체인에서 고유하다.
  const flow = p.get('flow');
  if (flow) {
    const app = APPS.find((a) => a.flows.some((f) => f.slug === flow));
    if (app) return { chain: app.chain, appId: app.id, slug: flow };
  }
  const chain = appsOn(p.get('chain') ?? '').length ? (p.get('chain') as string) : DEFAULT_CHAIN;
  const app = APPS.find((a) => a.chain === chain && a.id === p.get('app'));
  if (app) return { chain, appId: app.id, slug: app.flows[0].slug };
  const def = defaultAppOn(chain);
  return { chain, appId: def.id, slug: def.flows[0].slug };
}

// 보기 모드(M3 엔지니어 모드)도 같은 규칙: URL에 담고, 기본값(trader)이면 지운다.
function modeFromURL(): Mode {
  return new URLSearchParams(window.location.search).get('mode') === 'engineer' ? 'engineer' : 'trader';
}

function modeToURL(mode: Mode) {
  const url = new URL(window.location.href);
  if (mode === 'trader') url.searchParams.delete('mode');
  else url.searchParams.set('mode', mode);
  history.replaceState(null, '', url);
}

function selectionToURL(chain: string, appId: string, slug: string) {
  const url = new URL(window.location.href);
  const app = APPS.find((a) => a.chain === chain && a.id === appId);
  const isFirstFlow = slug === app?.flows[0]?.slug;
  if (chain === DEFAULT_CHAIN) url.searchParams.delete('chain');
  else url.searchParams.set('chain', chain);
  if (appId === defaultAppOn(chain).id && isFirstFlow) {
    url.searchParams.delete('app');
    url.searchParams.delete('flow');
  } else {
    url.searchParams.set('app', appId);
    // 흐름이 그 앱의 첫 번째면 굳이 적지 않는다
    if (isFirstFlow) url.searchParams.delete('flow');
    else url.searchParams.set('flow', slug);
  }
  history.replaceState(null, '', url);
}

// 체인 선택. 복원 엔진은 체인 무관(M0에서 Base 98/98 검증) — 카탈로그가 있는 체인만 활성화한다.
const CHAINS = [
  { id: 'unichain', label: 'Unichain', color: '#f50db4', live: true },
  { id: 'base', label: 'Base', color: '#0052ff', live: true },
  { id: 'ethereum', label: 'Ethereum', color: '#627eea', live: false },
  { id: 'arbitrum', label: 'Arbitrum', color: '#12aaff', live: false },
] as const;

// 드롭다운을 바깥 클릭/Esc로 닫는다. 앱·체인 두 곳에서 쓰므로 훅으로 뺐다.
function useDismiss<T extends HTMLElement>(open: boolean, setOpen: (v: boolean) => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);
  return ref;
}

export default function App() {
  const [locale, setLocale] = useLocale();
  const [sel, setSel] = useState(selectionFromURL);
  const [mode, setModeState] = useState<Mode>(modeFromURL);
  const [copied, setCopied] = useState(false);
  const setMode = (m: Mode) => {
    setModeState(m);
    modeToURL(m);
  };
  const [chainOpen, setChainOpen] = useState(false);
  const [appOpen, setAppOpen] = useState(false);
  const chainRef = useDismiss<HTMLDivElement>(chainOpen, setChainOpen);
  const appRef = useDismiss<HTMLDivElement>(appOpen, setAppOpen);
  const chainApps = appsOn(sel.chain);
  const app = chainApps.find((a) => a.id === sel.appId) ?? chainApps[0];
  const meta = app.flows.find((f) => f.slug === sel.slug) ?? app.flows[0];
  const graph = GRAPHS[meta.slug];
  const currentChain = CHAINS.find((c) => c.id === sel.chain) ?? CHAINS[0];

  const select = (chain: string, appId: string, slug: string) => {
    setSel({ chain, appId, slug });
    selectionToURL(chain, appId, slug);
  };
  const selectApp = (a: AppEntry) => {
    select(sel.chain, a.id, a.flows[0].slug);
    setAppOpen(false);
  };
  const selectChain = (chain: string) => {
    const def = defaultAppOn(chain);
    select(chain, def.id, def.flows[0].slug);
    setChainOpen(false);
  };

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
        known: n.known ?? null,
        traits: describeHookKeys(n.permissions).map((k) => t(locale, k)),
      }));
    return { movements: settlements.length, hiddenCount, symbols, hooks };
  }, [graph, locale]);

  return (
    <div className="viz-root">
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand">
            <h1>{t(locale, 'title')}</h1>
          </div>

          {/* 체인이 앱 목록을 거르므로 체인 → 앱 순으로 왼쪽에 나란히 둔다. */}
          <div className="chain-select" ref={chainRef}>
            <button
              className="chain-trigger"
              aria-haspopup="menu"
              aria-expanded={chainOpen}
              aria-label={t(locale, 'chain.select')}
              onClick={() => setChainOpen((v) => !v)}
            >
              <span className="chain-dot" style={{ background: currentChain.color }} />
              {currentChain.label}
              <span className="chain-caret" aria-hidden="true">
                ▾
              </span>
            </button>
            {chainOpen && (
              <div className="chain-menu" role="menu">
                {CHAINS.map((c) => (
                  <button
                    key={c.id}
                    role="menuitemradio"
                    aria-checked={c.id === sel.chain}
                    disabled={!c.live}
                    className={c.id === sel.chain ? 'is-current' : ''}
                    onClick={() => c.live && selectChain(c.id)}
                  >
                    <span className="chain-dot" style={{ background: c.color }} />
                    <span className="chain-name">{c.label}</span>
                    {c.id === sel.chain ? (
                      <span className="chain-check" aria-hidden="true">
                        ✓
                      </span>
                    ) : c.live ? null : (
                      <span className="chain-soon">{t(locale, 'chain.soon')}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 앱 선택은 상단으로 — 예전엔 사이드바 목록이었는데 카드가 펼쳐지고 접히며
              사이드바 전체 폭이 흔들렸다. 드롭다운은 그 흔들림을 없애고, 사이드바는
              현재 흐름의 인스펙터(설명·트랜잭션·훅)로 안정된다. */}
          <div className="app-select" ref={appRef}>
            <button
              className="app-trigger"
              aria-haspopup="menu"
              aria-expanded={appOpen}
              aria-label={t(locale, 'apps.label')}
              onClick={() => setAppOpen((v) => !v)}
            >
              <span className="app-trigger-name">{app.name[locale]}</span>
              <span className="app-caret" aria-hidden="true">
                ▾
              </span>
            </button>
            {appOpen && (
              <div className="app-menu" role="menu">
                {chainApps.map((a) => (
                  <button
                    key={a.id}
                    role="menuitemradio"
                    aria-checked={a.id === app.id}
                    className={a.id === app.id ? 'is-current' : ''}
                    onClick={() => selectApp(a)}
                  >
                    <span className="app-menu-name">{a.name[locale]}</span>
                    <span className="app-menu-tagline">{a.tagline[locale]}</span>
                    {a.flows.length > 1 && (
                      <span className="app-menu-flows">{t(locale, 'apps.flows', { n: a.flows.length })}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="topbar-right">
          <div className="mode-toggle" role="group" aria-label={t(locale, 'mode.label')}>
            <button className={mode === 'trader' ? 'is-active' : ''} onClick={() => setMode('trader')}>
              {t(locale, 'mode.trader')}
            </button>
            <button className={mode === 'engineer' ? 'is-active' : ''} onClick={() => setMode('engineer')}>
              {t(locale, 'mode.engineer')}
            </button>
          </div>

          <div className="lang-toggle" role="group" aria-label="Language">
            <button className={locale === 'ko' ? 'is-active' : ''} onClick={() => setLocale('ko')}>
              KR
            </button>
            <button className={locale === 'en' ? 'is-active' : ''} onClick={() => setLocale('en')}>
              EN
            </button>
          </div>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          {/* 현재 앱: 설명 + 대표 흐름 목록. 앱 선택 자체는 상단 드롭다운으로 옮겼다. */}
          <section className="side-section">
            <h2>{t(locale, 'side.app')}</h2>
            <p className="app-desc">{app.description[locale]}</p>
            {/* 도메인을 그대로 보여준다 — 언어 중립이고, 어디로 가는지 먼저 말해준다. */}
            {app.url && (
              <a className="app-link" href={app.url} target="_blank" rel="noopener noreferrer">
                {new URL(app.url).hostname.replace(/^www\./, '')} ↗
              </a>
            )}
            {app.flows.length > 1 && (
              <div className="flow-list">
                {app.flows.map((f) => (
                  <button
                    key={f.slug}
                    className={f.slug === meta.slug ? 'is-active' : ''}
                    onClick={() => select(sel.chain, app.id, f.slug)}
                  >
                    <span className="flow-title">{f.title[locale]}</span>
                    <span className="flow-meta">{t(locale, 'flow.meta', { nodes: f.nodes, hooks: f.hooks })}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="side-section">
            <h2>{t(locale, 'side.tx')}</h2>
            <button className="tx-chip" onClick={copyHash} title={graph.txHash}>
              <span className="chain">{graph.chain}</span>
              <code>{copied ? t(locale, 'hash.copied') : `${graph.txHash.slice(0, 10)}…${graph.txHash.slice(-8)}`}</code>
            </button>
            <h3 className="side-title">{meta.title[locale]}</h3>
            <p className="side-blurb">{meta.blurb[locale]}</p>
            <p className="sum-line">
              {t(locale, summary.movements === 1 ? 'sum.move1' : 'sum.moves', { n: summary.movements })}
              {summary.hiddenCount > 0 && (
                <>
                  {' · '}
                  <em>{t(locale, 'sum.hiddenShort', { n: summary.hiddenCount })}</em>
                </>
              )}
            </p>
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
          </section>

          {summary.hooks.length > 0 && (
            <section className="side-section">
              <h2>{t(locale, 'sum.hooks')}</h2>
              <ul className="hook-list">
                {summary.hooks.map((h) => (
                  <li key={h.address} className={h.known ? 'has-name' : ''}>
                    {h.known && <strong>{h.known}</strong>}
                    <code>{shortAddress(h.address)}</code>
                    <span>{h.traits.join(' · ')}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>

        <section className="canvas">
          <Diagram key={meta.slug} graph={graph} locale={locale} mode={mode} />
          <div className="canvas-foot">
            <p className="legend">
              <span className="swatch swatch-flow" /> {t(locale, 'legend.settled')}
              <span className="swatch swatch-hidden" /> {t(locale, 'legend.hidden')}
              {mode === 'engineer' && (
                <>
                  <span className="swatch swatch-acct" /> {t(locale, 'legend.acct')}
                </>
              )}
              <span className="swatch swatch-hook" /> {t(locale, 'legend.hook')}
            </p>
            <p className="note">{t(locale, 'note')}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
