# M0 스파이크 — v4 트레이스 복원 검증

기획서 v2 §8의 **M0**. `debug_traceTransaction`의 callTracer 출력만으로
Uniswap v4 플래시 어카운팅 흐름을 복원할 수 있는지 확인하는 것이 목적이다.

**결과 요약과 M1 권고사항은 [M0-FINDINGS.md](./M0-FINDINGS.md)에 있다.** 이 파일은 코드 안내만 담는다.

## 결론

187건(Unichain 89 / Base 98) 전부 복원 성공. 커스텀 트레이서 불필요.

**첫 지원 체인은 Unichain으로 결정됐다.** Unichain은 훅 트랜잭션 비율이 낮아(25.8%)
아무 해시나 넣으면 밋밋한 그림이 나오므로, `fixtures/`에 훅이 잘 드러나는 예시를 큐레이션해뒀다.

## 파일

| 파일 | 역할 |
|---|---|
| `v4.mjs` | v4 상수, 셀렉터, ABI 디코딩, 훅 권한 비트, 트레이스 순회 |
| `reconstruct.mjs` | **핵심.** 트레이스 → (주소, 통화) 델타 장부 복원 |
| `graph.mjs` | 복원 결과 → 기획서 §7 데이터 모델 JSON |
| `verify.mjs` | 델타 제로 불변식 + 실제 Transfer 대조 이중 검증 |
| `stats.mjs` | 코퍼스 통계 (§5.1 전제 검증용 수치) |
| `collect-pools.mjs` | 풀당 1건씩 표본 수집 |
| `find-hook-txs.mjs` | 훅이 붙은 트랜잭션 탐색 |
| `curate.mjs` | 예시 해시 후보 랭킹 (훅 가시성 기준) |
| `build-fixtures.mjs` | 큐레이션된 예시를 정적 그래프 JSON으로 생성 |
| `fixtures/` | 예시 6건 + `index.json` — M1에서 RPC 없이 렌더링 작업 가능 |
| `cache/` | 트레이스 디스크 캐시 (gitignore) |

## 사용법

의존성 없음. Node 18+ (`fetch` 필요).

```bash
node verify.mjs -v <txHash>                   # 단건 상세 — 단계별 금액과 검증 결과
node verify.mjs --file corpus-unichain.txt    # 코퍼스 일괄 검증
node stats.mjs corpus-unichain.txt            # 통계
node graph.mjs <txHash> > out.json            # §7 JSON 출력
node collect-pools.mjs unichain 8 450 swap    # 표본 수집 (체인, 윈도수, 윈도크기, 이벤트)
node curate.mjs corpus-unichain.txt           # 예시 해시 후보 랭킹
node build-fixtures.mjs                       # fixtures/ 재생성
```

체인 전환:

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
