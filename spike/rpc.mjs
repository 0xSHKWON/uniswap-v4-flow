// Minimal JSON-RPC helper + on-disk cache for the M0 spike.
// debug_traceTransaction is expensive and rate-limited, so every response is cached.
//
// 체인 선택: 호출별 { chain } 옵션 > CHAIN env > unichain. RPC_URL env가 있으면 전부 무시.
// 캐시 키에 URL이 들어가므로 체인이 다르면 캐시도 자연히 갈린다.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

// debug_traceTransaction을 열어주는 공개 엔드포인트는 dRPC뿐이다 (M0-FINDINGS §RPC).
export const RPCS = {
  unichain: 'https://unichain.drpc.org',
  base: 'https://base.drpc.org',
};
const urlFor = (chain) => process.env.RPC_URL ?? RPCS[chain ?? process.env.CHAIN ?? 'unichain'];

const CACHE = join(import.meta.dirname, 'cache');
mkdirSync(CACHE, { recursive: true });

export async function rpc(method, params, { cache = true, chain } = {}) {
  const url = urlFor(chain);
  const key = createHash('sha256').update(url + method + JSON.stringify(params)).digest('hex').slice(0, 32);
  const file = join(CACHE, `${method}.${key}.json`);
  if (cache && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const body = await res.json().catch(() => null);
    if (body?.error) {
      // rate limits are transient; anything else is a real failure
      if (/rate|limit|capacity|busy|timeout|upgrade/i.test(body.error.message) && attempt < 4) {
        await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
        continue;
      }
      throw new Error(`${method}: ${body.error.message}`);
    }
    if (cache) writeFileSync(file, JSON.stringify(body.result));
    return body.result;
  }
  throw new Error(`${method}: exhausted retries`);
}

export const trace = (hash, chain) =>
  rpc('debug_traceTransaction', [hash, { tracer: 'callTracer', tracerConfig: { withLog: true } }], { chain });
