# 배포 및 데이터 연결 운영 안내

작성일: 2026-09-13. 이번 릴리스는 GitHub Pages 프런트엔드와 별도 Node 재무 API 소스를 제공합니다. Pages는 Node 서버를 실행하지 않습니다. DART 키·시세 계약·백엔드 호스팅이 없어 운영 실데이터 연결은 미완료입니다. 프런트엔드는 이를 명시하고, 사용자가 선택한 학습용 가상기업만 별도 표시합니다.

## 사용자가 준비할 사항

1. Open DART(https://opendart.fss.or.kr/)에서 인증키 신청. 키는 백엔드의 `DART_API_KEY`에 저장합니다. 채팅이나 GitHub 소스, `VITE_` 변수에 넣지 않습니다.
2. 상시 Node 22 컨테이너와 영속 디스크 또는 PostgreSQL을 실행할 호스팅 계정 및 HTTPS 주소. 현재 유료 계정을 새로 만들거나 결제하지 않았습니다.
3. 사용할 시세 공급자와 웹사이트 표시 권한. 공급자마다 인증·심볼·지연 조건이 달라, 현재는 아래 고정 gateway 인터페이스까지만 구현했습니다. 실제 공급자 어댑터와 계약 확인은 선택 후 필요합니다.
4. SEC 운영 연락처를 포함한 `SEC_USER_AGENT`를 서버에 설정합니다. 로컬에서 SEC는 HTTP 403으로 응답했으므로 다른 배포 환경에서 공식 접근 정책에 따라 확인해야 합니다. 차단을 우회하지 않습니다.

## 로컬 실행

```sh
npm ci
cp .env.example .env
npm run server
```

다른 터미널에서 `npm run dev:vite`. `.env`의 `VITE_FINANCIAL_API_URL=http://localhost:8787`을 설정한 뒤 Vite를 재시작합니다. 정적 미리보기는 `npm run build && npm run dev -- --port 4173`입니다.

API 환경변수: `PORT`, `DATA_DIR`, `DATABASE_URL`, `DART_API_KEY`, `SEC_USER_AGENT`, `ALLOWED_ORIGINS`, `QUOTE_SERVICE_URL`, `QUOTE_API_KEY`. `.env.example` 참고.

## 서버 배포

```sh
docker build -f Dockerfile.financials -t stock-financials .
docker run --env-file .env -p 8787:8787 -v stock-data:/data stock-financials
```

운영 호스팅에서 HTTPS를 적용하고, `/health`를 확인합니다. 최초 운영은 **수집 프로세스 1개**로 실행합니다. 로컬 파일 저장은 같은 프로세스 안에서만 직렬화됩니다. 다중 인스턴스는 `DATABASE_URL` PostgreSQL을 사용해 트랜잭션 잠금을 걸 수 있지만, 제공자 전체 요청 제한·장시간 임대 heartbeat를 공유하는 운영 검증이 추가로 필요합니다.

`ALLOWED_ORIGINS`에 `https://nulmaru.github.io`를 포함합니다. GitHub 저장소 Settings → Secrets and variables → Actions → Variables에 공개 주소 `VITE_FINANCIAL_API_URL=https://...`를 등록하고 Pages 워크플로를 재실행합니다. 키는 이 변수에 넣지 않습니다. 비어 있으면 연결 대기 화면으로 정상 배포됩니다.

## API와 최신성

- `GET /v1/securities/resolve?exchange=US&ticker=NVDA`: 상장증권과 발행회사 구분. GOOG/GOOGL은 같은 SEC 발행회사로 중복 수집을 방지합니다.
- `GET /v1/issuers/sec%3A0001045810/financials`: 보관본 즉시 반환. 5분 TTL을 넘기면 영속 작업 생성. 첫 조회는 202, 자료가 있으면 200.
- `POST /v1/issuers/.../refresh`: 수동 확인. 동일 작업 합치기 및 재시도 간격 유지.
- `GET /v1/jobs/...`: queued/fetching/ready/failed.
- `GET /v1/issuers/.../analysis?financialVersion=...`: 해당 공시 버전의 규칙 해석.
- `GET /v1/securities/.../quote`: 선택한 시세 gateway.

TTL은 **최신 공시를 다시 확인하는 주기**입니다. 새로운 재무제표가 5분마다 생기거나 실시간 가격이라는 뜻이 아닙니다. 최근 24시간 조회된 회사만 자동 확인합니다. 실패 때 마지막 성공한 공시와 확인시각을 보존하고 재시도합니다. 브라우저는 대기 작업을 최대 2분 조회한 뒤 수동 재확인을 지원합니다.

## 시세 gateway 계약

서버가 고정된 HTTPS `QUOTE_SERVICE_URL`에 `securityId` 쿼리를 넣고, 선택적으로 `Authorization: Bearer QUOTE_API_KEY`를 보냅니다. 사용자 입력 URL로 요청하지 않습니다. 응답 예시:

```json
{"price":100,"marketCap":1000000000,"currency":"USD","quoteAt":"2026-09-11T20:00:00Z","delayClass":"close","source":"계약된 공급자"}
```

`delayClass`: realtime/delayed/close. `marketCap`이 없거나 재무 통화와 다르면 PER/PBR 계산을 보류합니다. 종목별/복수주식종류 시가총액과 보통주 귀속 이익·자본의 범위도 일치해야 합니다. 이 예시는 계약 형식 설명이며 실제 시세가 아닙니다.

## 데이터 범위와 운영 제한

- SEC: 표준 US-GAAP 전체 회사 태그. IFRS/고유 태그/주석 자동 추론 제외. 보고 기간·통화·원문 accession 보존. 누적 차감은 근거를 함께 제시하며, 정정 공시 혼합은 검토 대상입니다.
- DART: 검증된 회사코드는 삼성전자부터, 12월 결산 연결 표준 계정만. 신규 회사코드 등록/업종별 검증 필요. 실인증키 검증은 아직 못 했습니다.
- 보통주 귀속 자본/이익, 무형자산 CAPEX, 기초 잔액이 없으면 해당 지표를 0으로 대체하지 않습니다. 은행·보험 등은 범용 비율 일부를 보류합니다.
- 현재 저장은 정규화 스냅숏과 버전·작업 상태입니다. 계획의 원문 object storage, 테이블별 PostgreSQL 스키마, 관측 데이터 보정, AI 주석 추론, 운영 지표/알림과 다중 수집기 확장은 후속 단계입니다.
- PostgreSQL 경로는 타입 검사를 통과했으나 실제 DB 서비스가 없어 통합 검증하지 못했습니다. 파일 저장/재시작/중복 제거/실패 보관본 유지 경로는 자동 테스트했습니다.
- 백업: 서버 중지 후 `/data/state.json` 복사 또는 PostgreSQL 정기 백업. 손상 파일을 자동 초기화하지 않습니다. API는 개인 파일을 받지 않고 공시만 조회합니다. 대규모 공개 서비스 이전에는 인증/테넌트 제한 및 운영 부하 검증을 추가합니다.
