# uniswapv4-flow

Uniswap v4 위에 올라온 앱(훅 프로토콜)들이 **스왑 한 번에 돈을 어떻게 움직이는지**를
흐름도 한 장으로 보여준다.

기존 익스플로러는 ERC20 `Transfer` 이벤트로 흐름을 그리는데, v4는 플래시 어카운팅이라
훅이 가져간 값이 Transfer 로그에 아예 안 잡힌다. 그 안 보이는 흐름까지 그려주는 도구다.

```bash
npm install
npm run dev
```
