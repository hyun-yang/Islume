# Islume (ISL) — 메인넷 Solscan Token Update 제출 체크리스트

목적: 메인넷에서 ISL 토큰이 Solscan에 **이름·심볼·로고**로 표시되고, 검색/신뢰도(reputation)가
올라가도록 하기 위한 절차. (devnet 단계에서는 이름/심볼 검색이 불가하며, 이 절차는 **메인넷 전용**.)

핵심 사실 (Solscan 공식 가이드, 2026-05-31 기준):
- Solscan은 **프로젝트 대신 온체인 메타데이터를 수정해주지 않는다.** 이름/심볼/로고는 우리가
  Metaplex 메타데이터로 직접 박아야 하고(이미 devnet에 적용한 그 방식), Solscan은 그 **표시 여부와
  reputation**만 관리한다.
- 신규 토큰은 기본 **`Unclassified`** reputation → **로고가 표시되지 않음**(스팸/사칭 방지용 의도된 동작).
  로고가 뜨려면 최소 **`Neutral`** 으로 올려야 하고, 그 방법이 이 Token Update 요청이다.
- 제출은 **공식 폼**으로만: `https://solscan.io/token-update` (다른 채널 제출은 검토 안 함).
- **무료**. 단 24시간 처리 보장이 필요하면 유료 Priority Support.

---

## 0. 전제 — 메인넷 mint부터 새로 발행

- [ ] **devnet mint(`CtTT8tLpNaoo8MyrrziVBv5nbxF9m8y3hZsqRuk7Y6iP`)는 메인넷으로 옮길 수 없다.**
      메인넷에 **새 mint를 발행**해야 한다(주소가 새로 생김).
- [ ] 메인넷 mint에 Metaplex 메타데이터(name=`Islume`, symbol=`ISL`, image) 부착.
      스크립트는 `--network mainnet` + 환경변수 override를 지원하므로 **devnet `.env`를 건드릴 필요 없음**:
      ```bash
      ISL_MINT=<mainnet_mint> \
      ISL_MINT_AUTHORITY_SECRET=<mainnet_secret> \
      ISL_RPC_URL=<paid_mainnet_rpc> \   # 선택; 기본 https://api.mainnet-beta.solana.com
      node set_isl_metadata.mjs --network mainnet
      ```
      - 메인넷 Irys(`https://node1.irys.xyz`)는 **유료** → mint authority 지갑에 ATA rent + 업로드비용
        만큼의 **실 SOL** 필요. (Irys 엔드포인트가 바뀌면 `ISL_IRYS_ADDRESS`로 override)
- [ ] 온체인 확인:
      ```bash
      ISL_MINT=<mainnet_mint> node verify_isl_metadata.mjs --network mainnet
      ```

> 메인넷 키 관리: mint authority 시크릿은 평문 env가 아니라 안전한 보관(하드웨어/KMS) 권장.
> (devnet은 평문이어도 무방했지만 메인넷은 실자산.)

---

## 1. 제출 전 준비물 (사전 충족 권장)

- [ ] **토큰 로고 이미지의 공개 URL** — 비공개/비밀번호 보호 금지. 우리 arweave.net 이미지 URL 사용 가능
      (`https://arweave.net/<id>`; 메인넷 재업로드 시 새 id). 직접 다운로드 가능해야 함.
- [ ] **공식 프로젝트 웹사이트** — 프로젝트/토큰 설명이 명확하고 충분해야 함(필수 항목).
- [ ] **공식 도메인 이메일** — 요청자 이메일은 **프로젝트 도메인 주소**(예: `you@islume.xxx`)여야 함.
      공식 이메일이 없으면, 사용한 이메일이 **웹사이트에 게시**돼 있어야 함.
- [ ] **소셜 링크(선택, 신뢰도 ↑)** — Twitter/Discord/Telegram/Medium **전체 URL**
      (`https://x.com/...` 형태, `@handle` 아님). 모두 작동·공식 계정이어야 함.
- [ ] **중립적 설명문** — "최고의/가장 빠른/가장 안정적인" 같은 과장·비교 표현 금지.
- [ ] (선택) 백서·감사 리포트 등 보조 자료.
- [ ] **mint/update authority 지갑** 준비 — 메타데이터 수정 및 소유권 증명(아래 3번)에 필요.

---

## 2. 제출 절차

1. - [ ] 토큰 페이지에서 현재 **reputation 상태** 확인
      (`https://solscan.io/token/<MAINNET_MINT>` — `Unclassified`면 로고 미표시가 정상).
2. - [ ] `https://solscan.io/token-update` 접속.
3. - [ ] **Request Type** 선택:
      - 로고/이름이 안 뜨는 신규 토큰을 검증받아 표시 → **`Reputation Update`** (Neutral 승격)
      - 기존 정보 수정/소셜·로고 갱신 → **`Social Links & Logo Update`**
      - (참고) 나머지: `Community Takeover`, `Token Migration`
4. - [ ] 폼 작성 (모두 **정확·최종**, 제출 후 수정 불가):
      - `Token Contract Address *` → **메인넷 mint 주소**
      - `Requester Name *`
      - `Requester Email Address *` → 공식 도메인 이메일
      - `Official Project Website *`
      - `Link to Token Image *` → 공개 로고 URL
      - `Short Description *` → 중립적 소개
      - `CoinMarketCap Ticker` / `CoinGecko Ticker` (선택)
      - `Discord / Medium / Telegram / Twitter` (선택, 전체 URL)
5. - [ ] **한 번만 제출**. 같은 주소로 중복 제출 금지(처리 지연 유발).
6. - [ ] 검토 대기(보통 며칠). 재촉은 **원 메일에 회신**으로만, 팀원 DM 금지.

---

## 3. (권장) 소유권 증명 — Verified Signature

폼에 서명 필드는 없지만, Solscan이 **추가 증빙을 요청**할 수 있고 Community Takeover 등에선 사실상 필수.
미리 서명을 만들어 `Short Description`에 공개 URL을 첨부하면 신뢰도/처리 속도에 유리.

- [ ] Solscan 상단 **Resources → Verified Signature** 진입.
- [ ] mint/update authority 지갑 연결 → 메시지 입력(예: `Islume token update request <date>`) → **Sign**.
- [ ] 서명 결과를 **Publish**해 공개 URL 확보 → 폼 설명란에 첨부.
- [ ] (민감정보가 메시지에 들어가지 않도록 주의.)

---

## 4. 비용 · 거절 사유

- [ ] **무료**. 24시간 내 처리가 필요하면 유료 Priority Support.
- 거절/숨김 사유: 부정확·과장·사칭·스캠/피싱 의심, 저작권 침해, 비활성 프로젝트, 사용자 신고 등.
  → 모든 링크 작동, 정보 일치, 중립적 서술을 반드시 지킬 것.

---

## 5. (선택) 생태계 전역 검색 노출 — Solscan 너머

Solscan 등록만으로는 지갑/애그리게이터 검색까지 보장되지 않는다. 심볼 `ISL`은 유일하지 않으므로,
이름/심볼로 폭넓게 검색되려면:

- [ ] **Jupiter 검증 토큰 리스트** 등재(메인넷, **유동성/풀 필요**) — 다수 지갑·DEX·익스플로러가 이를 참조.
- [ ] **CoinGecko / CoinMarketCap** 등재 → 메타데이터·티커가 여러 서비스로 전파.

> 현실: 이름/심볼 검색은 **메인넷 + 검증 + (보통) 유동성**이 모여야 동작. devnet 데모 단계에선
> 주소/직접 링크 공유가 정석.

---

## 출처

- Token Update Submission Guideline — https://info.solscan.io/solscan-token-update-guideline/
- How to Update Token Reputation — https://info.solscan.io/how-to-update-token-reputation-on-solscan/
- Update Token Details (Metaplex) — https://docs.solscan.io/integration/update-token-details
- Verified Signature Tool — https://info.solscan.io/solscan-verified-signature-tool/
- Token Update Form — https://solscan.io/token-update
