# uniswapv4-flow

Uniswap v4 트랜잭션 해시를 넣으면, 그 거래에서 돈이 어떻게 움직였는지를 흐름도 한 장으로 보여준다.
훅이 중간에 뭘 했는지가 그림에 드러난다.

기존 익스플로러는 ERC20 `Transfer` 이벤트를 모아 흐름도를 그리는데, v4는 플래시 어카운팅이라
중간 단계에서 토큰이 안 움직인다. **훅이 값을 가져간 트랜잭션의 75%는 Transfer 로그에 훅 주소가
아예 등장하지 않는다** (Unichain 표본 기준). 그 격차를 메우는 게 이 도구다.

## 현재 상태

| 마일스톤 | 상태 |
|---|---|
| M0 — 트레이스 복원 검증 | 완료. 187/187 복원 ([spike/M0-FINDINGS.md](./spike/M0-FINDINGS.md)) |
| M1 — 단일 트랜잭션 렌더링 | 완료. 해시 하드코딩, 배포 안 함 |
| M2 — 입력창 + 첫 공개 | 미착수 |
| M3 — 모드 토글 (engineer) | 미착수 |
| M4 — 훅 라벨링 | 미착수 |
| M5 — 다중 체인 | 미착수 (복원 엔진은 이미 체인 무관) |

첫 지원 체인은 **Unichain**.

## 실행

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
```

RPC는 필요 없다. 렌더링은 `src/fixtures/`의 정적 그래프 JSON만 읽는다.

## 구조

```
src/
  types.ts      기획서 §7 데이터 모델
  layout.ts     손으로 짠 노드 배치 + 엣지 라우팅 + 라벨 겹침 해소
  Diagram.tsx   SVG 렌더링 (다이어그램 라이브러리 없음)
  format.ts     금액/주소/훅 권한 표기
  fixtures/     검증된 예시 6건 + index.json
spike/          M0 스파이크 — 트레이스 복원 엔진과 검증 하네스
```

데이터는 `spike/`가 만든다. 트레이스를 복원해 (`reconstruct.mjs`) §7 모델로 바꾸고
(`graph.mjs`) 정적 JSON으로 굽는다 (`build-fixtures.mjs`). 자세한 내용은
[spike/README.md](./spike/README.md).

## 엣지 층

같은 값을 두 번 세지 않도록 엣지를 두 층으로 나눈다.

- **settlement** — 실제로 움직인 값 (`settle`/`take`/`mint`/`burn`). 지금 화면에 그리는 층.
- **accounting** — 그 값을 설명하는 채무 (swap 델타, 훅 몫). M3 engineer 모드에서 덧씌운다.

두 층은 같은 값을 장부 반대편에서 본 것이라, 섞어 그리면 금액이 두 배로 보인다.

## 안 하는 것

수익률·추천·위험 판정을 하지 않는다. MEV 패턴도 분류하지 않는다.
"이 트랜잭션에서 이런 일이 있었다"는 사실 서술만 한다.
