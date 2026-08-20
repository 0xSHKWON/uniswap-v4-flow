# M0 스파이크 — v4 트레이스 복원 검증

기획서 v2 §8의 **M0**. `debug_traceTransaction`의 callTracer 출력만으로
Uniswap v4 플래시 어카운팅 흐름을 복원할 수 있는지 확인하는 것이 목적이다.

**결과 요약과 M1 권고사항은 [M0-FINDINGS.md](./M0-FINDINGS.md)에 있다.** 이 파일은 코드 안내만 담는다.

## 결론

187건(Unichain 89 / Base 98) 전부 복원 성공. 커스텀 트레이서 불필요.

M0 이후 데이터 파이프라인은 **앱 카탈로그**(M2′)로 확장됐다. 아무 해시나 넣으면 밋밋한
그림이 나오므로, 두 체인의 코퍼스에서 관측된 훅을 식별해 앱별 대표 트랜잭션을 골라
`fixtures/apps.json`으로 굽는다. 훅 신원은 `known-hooks.json`에 근거와 함께 수동 관리한다.

## 파일

**복원 엔진 (M0)**

| 파일 | 역할 |
|---|---|
| `v4.mjs` | v4 상수, 셀렉터, ABI 디코딩, 훅 권한 비트, 트레이스 순회 |
| `reconstruct.mjs` | **핵심.** 트레이스 → (주소, 통화) 델타 장부 복원 |
| `rpc.mjs` | JSON-RPC + 디스크 캐시. 체인별 엔드포인트(`{chain}` 옵션) |
| `graph.mjs` | 복원 결과 → §7 데이터 모델 JSON (훅에 `known` 이름 스탬프) |
| `tokens.mjs` | ERC20 심볼/소수점 해석 (빌드 시 JSON에 구움) |
| `verify.mjs` | 델타 제로 불변식 + 실제 Transfer 대조 이중 검증 |
| `stats.mjs` | 코퍼스 통계 (§5.1 전제 검증용 수치) |

**앱 카탈로그 파이프라인 (M2′ / M5)**

| 파일 | 역할 |
|---|---|
| `build-hook-registry.mjs` | 코퍼스 스캔 → 관측된 훅 레지스트리(`hook-registry-{chain}.json`) |
| `known-hooks.json` | 훅 주소 → 앱 이름 매핑 (근거 기록, 수동 관리) |
| `hooklist-upstream.json` | Uniswap/hooklist 공식 레지스트리 사본 (식별 근거) |
| `hunt-euler.mjs` | 특정 풀만 지나는 대표 tx 발굴 (예: EulerSwap 단독 스왑) |
| `build-fixtures.mjs` | 앱별 대표 흐름을 정적 그래프 JSON + `apps.json`으로 생성 |
| `collect-pools.mjs` · `find-hook-txs.mjs` · `curate.mjs` | 코퍼스 수집·탐색·랭킹 도구 |
| `fixtures/` | 흐름 20건 + `apps.json` — 앱이 RPC 없이 읽는 사본 |
| `cache/` | 트레이스 디스크 캐시 (gitignore) |

## 사용법

의존성 없음. Node 18+ (`fetch` 필요).

```bash
node verify.mjs -v <txHash>                   # 단건 상세 — 단계별 금액과 검증 결과
node verify.mjs --file corpus-unichain.txt    # 코퍼스 일괄 검증
node stats.mjs corpus-unichain.txt            # 통계
node graph.mjs <txHash> > out.json            # §7 JSON 출력
node build-hook-registry.mjs --file corpus-unichain.txt   # 훅 레지스트리 생성
node build-fixtures.mjs                       # fixtures/ + apps.json 재생성 (두 체인)
```

체인 전환 — 복원 엔진과 도구는 `CHAIN` env(또는 호출별 옵션)로 체인을 받는다.
`build-fixtures.mjs`는 `apps.json`의 `chain` 필드를 보고 알아서 두 체인을 함께 굽는다.

```bash
CHAIN=base RPC_URL=https://base.drpc.org node verify.mjs --file corpus-base.txt
```

## RPC 주의사항

`debug_traceTransaction`을 지원하는 엔드포인트가 필요하다. 확인 결과:

| 엔드포인트 | 지원 |
|---|---|
| `unichain.drpc.org`, `base.drpc.org` | 지원 (무료 플랜, 큰 트랜잭션은 타임아웃 발생) |
| `mainnet.unichain.org` (공식 퍼블릭) | **차단** (`rpc method is not whitelisted`) |
| `unichain-rpc.publicnode.com` | **차단** |

모든 응답은 `cache/`에 저장되므로 재실행은 RPC를 타지 않는다.
