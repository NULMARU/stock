# Stock 소스 분석 및 InfraWheel Lite 통합 검토

> 후속 결정: 사용자의 내부 앱·정밀도·확장성 요구를 반영한 [시뮬레이션 랩 개발계획](simulation-lab-development-plan.md)을 최신 구현 기준으로 사용한다. 아래 내용은 최초 소스 분석과 통합 검토 기록이다.

검토일: 2026-09-12. 현재 작업 사본 `79caa6adba70a2e13c8a5a04e03e6e5bba47cd78`과 [InfraWheel Lite](https://github.com/NULMARU/infrawheel-lite/tree/09c710e1f790ad505af4f8f9807944bed8663b99) 기본 브랜치 `main`의 `09c710e1f790ad505af4f8f9807944bed8663b99`를 기준으로 한다. 원격 저장소는 임시 경로에 복제해 실제 소스와 테스트를 확인했다.

**권장안: Stock에 ‘산업 시나리오’ 페이지를 추가하고, InfraWheel 계산 코어와 필요한 UI를 모듈로 편입한다. 종목과 산업 노드의 연결 정보를 별도로 관리한다.** 두 앱 모두 React·TypeScript와 정적 배포를 사용하므로 초기 통합에 별도 서버가 필요하지 않다. 산업 시뮬레이션을 종목 목표가·수익률·추천 점수에 직접 반영하는 것은 현재 모델의 검증 수준으로 뒷받침되지 않는다.

## 1. 현재 프로젝트

초보 투자자가 AI·우주 관련 종목의 지표, 뉴스, 용어를 함께 살펴보는 학습 앱이다. README 명칭은 ‘스페이스AI 스톡랩’, 실제 헤더는 ‘Dsup 주식’이다.

| 영역 | 실제 구현 | 주요 파일 |
|---|---|---|
| 프런트엔드 | React 19, TypeScript 5.9, Vite 7, Tailwind 3, Radix 기반 UI, Recharts 2 | `package.json`, `src/index.css` |
| 화면 이동 | HashRouter: `/`, `/stock/:ticker`, `/news`, `/glossary` | `src/main.tsx`, `src/App.tsx` |
| 종목 탐색 | 미국·한국·중국 필터, 테마·초성 검색, 관심 등록·숨김, 멋주, 전체 종목 검색 | `src/pages/HomePage.tsx`, `src/components/UniverseSearchPanel.tsx` |
| 종목 상세 | 가격 차트, 재무 지표, 비교 그룹, 5축 점수, 예측, 판단 일기, 뉴스·용어 연결 | `src/pages/StockDetailPage.tsx` |
| 사용자 상태 | localStorage와 이벤트 구독. 로그인·서버 동기화는 없음 | `src/lib/userStore.ts`, `judgments.ts`, `mission.ts`, `analytics.ts` |
| 데이터 공급 | 번들 JSON을 기본값으로 표시한 뒤 `./data/*.json`을 조회 | `src/lib/liveData.ts` |
| 배포·오프라인 | GitHub Pages, 상대 경로 에셋, 서비스워커 | `.github/workflows/deploy.yml`, `public/sw.js` |

데이터 흐름은 `외부 데이터 → Python 수집·계산 → src/data + public/data → Pages 배포 → React 조회`다. UI 새로고침은 게시된 JSON을 다시 읽는다. Yahoo 데이터 수집을 브라우저에서 직접 실행하는 기능은 아니다. 환율 표시에는 별도로 외부 환율 API 요청이 있다.

Python 처리 역할:

- `refresh_data.py` / `scoring_config.py`: yfinance 시세·재무·가격 이력, 가치평가·성장·수익성·재무건전성·모멘텀의 5축 점수(총 25점), 해석 문장 생성.
- `predict.py`: 평균회귀·추세·드리프트 조합으로 익일 방향 산출, 과거 예측 정산 및 가중치 조정. 장기는 애널리스트 목표가·밸류에이션·몬테카를로 3요소를 사용한다. LLM 추론 서비스는 아니다.
- `unicorn_evaluate.py`: 가치평가 40·퀄리티 35·성장 25점의 별도 평가 및 제외 조건으로 ‘멋주’ 후보 선정.
- `fetch_news.py`: Google 뉴스 RSS를 종목별로 수집한다.
- `build_universe.py`: 대량 종목 검색용 목록 생성. 검색 등록만으로 해당 종목의 시세·재무·예측 수집 대상이 자동 확대되지는 않는다.
- `auto_*.py`: 수집·계산 후 Git 커밋/푸시까지 수행하는 외부 자동화용 실행기다. 검토 중 실행하지 않았다.

작업 사본의 데이터 현황:

| 데이터 | 규모 | 저장된 기준일 |
|---|---|---|
| 학습 종목 | 26개: 미국 9·한국 8·중국 9 | 2026-09-05 |
| 단기·장기 예측 | 25개, 학습 종목 중 SPCX 항목 없음 | 2026-09-05 |
| 종목 뉴스 | 26개 티커 | 2026-09-05 |
| 멋주 | 58개 평가, 29개 통과 | 2026-09-05 |
| 검색 목록 | 14,336개 항목 | 2026-08-22 |
| 용어 | 26개 | 별도 기준일 필드 없음 |
| 개선 보고서 | 1개 | 2026-08-23 |

`src/data`의 JSON 7개는 모두 `public/data`와 바이트 단위로 일치했다. 위 날짜는 로컬 소스의 스냅샷이며 배포 사이트나 외부 스케줄러의 현재 상태를 의미하지 않는다.

## 2. InfraWheel Lite

AI 산업의 공급·수요·재투자 관계를 가정에 따라 분기별로 계산하는 브라우저 시뮬레이터다. 종목별 가격·재무 데이터 수집기나 주가 예측 엔진은 포함하지 않는다.

- 화면은 **반도체, 에너지, AI 인프라, 지능, AI 응용, 자본**의 6개 노드와 14개 입력을 제공한다.
- 내부 계산은 기존 8개 노드·18개 입력 엔진을 유지한다. `liteMapping.ts`가 복합 지수를 내부 변수로 변환하고, `liteEngine.ts`가 병목 표시를 6개 노드로 집계한다.
- `simulateLite(params, config)`는 분기별 매출·CAPEX·병목·루프 속도 등의 결과를 반환한다. 기본 기간은 `2025Q1`~`2035Q4`다.
- Lite 프리셋은 기준, 전력 병목, 한국 공간 컴퓨팅 선도, 알고리즘 혁신, 메모리 병목, Physical AI 도약의 6개다.
- 지정학 확장은 블록화·에너지 축과 대만/러시아-NATO/중동 사건을 적용한다. 사건 단계·시작 분기·지속 기간, 충격의 결합과 회복을 처리한다.
- UI는 Zustand 상태, 한·영 번역, 휠 SVG, Recharts 3 타임라인, URL 상태 공유로 구성된다.

주요 통합 API는 [`src/index.ts`](https://github.com/NULMARU/infrawheel-lite/blob/09c710e1f790ad505af4f8f9807944bed8663b99/src/index.ts)의 `simulateLite`, `DEFAULT_LITE_PARAMS`, `DEFAULT_CONFIG`와 [`src/geopolitical/index.ts`](https://github.com/NULMARU/infrawheel-lite/blob/09c710e1f790ad505af4f8f9807944bed8663b99/src/geopolitical/index.ts)의 `simulateGeopolitical`이다. 지정학 API는 현재 최상위 배럴에서 다시 내보내지 않으므로 패키지화할 때 공개 경로를 정의해야 한다.

## 3. 통합 방식 비교

| 방식 | 장점 | 비용·제약 | 판단 |
|---|---|---|---|
| 별도 앱 링크 또는 iframe | 변경량이 적고 원본 유지가 쉬움 | 상태·테마·접근성·종목 이동 연결이 별도 작업, 독립 배포 필요 | 짧은 데모 용도 |
| Stock 내부 기능 모듈 | 기존 종목·뉴스·용어와 자연스럽게 연결, 한 번에 정적 배포 | URL·CSS·차트·상태 생명주기 조정 | **초기 권장** |
| 모노레포 + 공통 엔진 패키지 | 두 앱에서 엔진과 테스트를 함께 유지 | 패키징·워크스페이스·CI 변경 필요 | 두 앱을 계속 독립 운영한다면 후속 권장 |

현재 `infrawheel-lite/package.json`은 `main: index.js`를 선언하지만 빌드는 Vite 웹앱 산출물이다. `exports`·라이브러리 산출물 설정이 없어 Git URL을 npm 의존성으로 추가하는 것만으로 정상적인 코어 패키지가 되지는 않는다. 초기에는 출처와 커밋을 기록한 소스 모듈 편입, 장기에는 코어 패키지 추출이 적합하다.

제안 구조(아직 구현하지 않음):

```text
src/features/infrawheel/
  core/                  # engine, types, defaults, liteMapping, liteEngine
  geopolitical/          # 사건·타임라인·충격 계산
  scenarios.ts
  ui/                    # 필요한 원본 UI를 앱 레이아웃에 맞춰 편입
  store.ts               # 페이지에서 초기화하는 상태 저장소
  routeState.ts          # React Router를 통한 공유 상태 복원·기록
src/data/infra-exposures.json
src/pages/IndustryScenarioPage.tsx
src/components/StockIndustryPanel.tsx
```

순수 코어에 React·Zustand·종목 데이터 의존성을 넣지 않는다. 계산 엔진 회귀 테스트와 Stock 연결 테스트도 구분한다.

## 4. 제품과 데이터 연결

첫 사용 흐름은 `종목 상세 → 산업 내 역할 → 관련 노드가 선택된 시나리오 → 병목 및 관련 종목·뉴스 탐색`으로 구성한다. 상단에는 ‘산업’ 메뉴를 추가하고 `/industry`를 사용한다.

종목 연결은 기존 `theme`·`valueChain`을 참고하되 티커별 명시적 매핑으로 저장한다. 현재 테마에는 `클우드` 같은 표기 차이가 있고 한 회사가 여러 역할을 갖기 때문에 문자열 자동 매칭만으로 확정하면 안 된다.

| 노드 | 현 소스의 역할 설명을 이용한 초기 연결 후보 |
|---|---|
| 반도체 | NVDA, 삼성전자, SK하이닉스, SMIC, 캠브리콘 |
| AI 인프라 | MSFT, GOOGL, 알리바바 |
| 지능 | GOOGL, 네이버, 바이두, 아이플라이텍 |
| AI 응용 | TSLA, PLTR, 텐센트, 샤오미 |
| 에너지·자본 | 현재 학습 종목만으로는 직접 대표 종목을 충분히 구성하기 어려움 |

위 표는 사업 노출도를 실증 측정한 결과가 아닌 **큐레이션 초안**이다. 우주·방산 종목은 모델에 대응하는 직접 노드가 없는 경우 ‘모델 범위 밖’으로 두고 설명을 제공한다. 미국·한국·중국이라는 상장 시장만으로 지정학적 수혜·피해를 결정하지 않는다.

`infra-exposures.json`의 항목에는 `ticker`, 복수의 `nodes`, `relation`(공급자/운영자/사용자), `rationale`, `sourceUrls`, `asOf`, `modelVersion`을 두는 안을 권장한다. 초기에는 근거 없는 노출 가중치나 예상 수익률을 추가하지 않는다. 등록만 된 간이 종목과 검색 목록의 미매핑 종목도 허용해야 한다.

화면은 기준/변경 시나리오와 변경한 가정, 병목 발생 분기, 관련 종목을 제시한다. 종목 매출 성장률과 산업 전체 성장률은 모집단이 다르며 단위도 현재 Stock은 소수, InfraWheel은 퍼센트 값을 사용한다. 필드명이 유사해도 자동으로 서로 대입하면 안 된다. 산업 결과의 정규화된 비교에도 원 모델의 계산 한계는 남는다.

## 5. 반드시 설계에 반영할 충돌

1. **URL 소유권:** Stock의 HashRouter와 InfraWheel의 `history.replaceState(null, '', '#…')`가 동일한 해시를 사용한다. 원본 `ui/store.ts`를 그대로 가져오면 라우트가 덮어써진다. `#/industry?sim=…&ticker=NVDA` 형태로 바꾸고, `useSearchParams` 등 라우터 API로 직렬화된 상태를 한 번 인코딩해 저장한다. `location.hash` 직접 쓰기를 없애고 뒤로가기·앞으로가기·공유 링크 재진입 시 재복원을 구현한다.
2. **전역 상태 부작용:** 원본 store는 import 시 URL을 읽고 영구 구독을 시작한다. 페이지별 store 생성 또는 주입 구조로 바꾸고 URL 동기화 구독은 마운트/해제 시 관리한다. 현재 앱의 localStorage 사용자 상태는 계속 사용할 수 있으며 전체를 Zustand로 이관할 필요는 없다.
3. **CSS와 언어:** 원본 `styles.css`는 `*`, `:root`, `html/body/#root`, `--border`, `--accent`, `--radius`를 정의한다. Stock의 HSL 토큰을 hex 값으로 덮어쓸 수 있다. 스타일을 기능 컨테이너에 한정하고 토큰을 접두사로 분리하거나 Stock 토큰으로 교체한다. 원본의 문서 전체 `lang` 변경 대신 기능 컨테이너에 한국어 기본값을 적용한다.
4. **레이아웃:** 원본 `.app`의 `height: 100vh; overflow: hidden` 및 3열 구성은 Stock 헤더·티커바 아래에 그대로 맞지 않는다. 사용 가능한 높이를 기준으로 구성하고 작은 화면에서는 제어·결과 영역을 순차 배치한다.
5. **의존성:** Stock은 Vite 7/Recharts 2, InfraWheel은 Vite 8/Recharts 3/Zustand 5다. 코어 통합만으로 Vite 업그레이드는 필요하지 않다. 초기 차트는 기존 Recharts 2 API에 맞춰 이식·검증하고, Recharts 3 전환은 기존 `PriceChart`, `ui/chart`를 포함한 별도 마이그레이션으로 다룬다. 두 메이저 차트 라이브러리를 번들에 동시에 넣는 방안은 피한다.
6. **로딩·PWA:** 기존 메인 JS가 약 1.86 MB로 크다. 산업 페이지와 UI를 lazy-load하고 기존 화면의 첫 로딩에 추가하지 않는다. 현재 서비스워커는 방문하지 않은 lazy chunk를 미리 저장하지 않으므로 오프라인 첫 진입 지원 여부를 정하고, 지원한다면 해당 파일을 사전 캐시한다.
7. **출처:** 원격 `UPSTREAM_SOURCE.md`는 원작 저장소와 가져온 커밋을 기록하며 라이선스 본문·저작자 및 책 관련 콘텐츠 권리가 확인되지 않았다고 명시한다. 이 출처를 보존하고 공개 배포 전 해당 미확인 사항을 정리한다. 이번 소스 검토를 막는 조건은 아니다.

## 6. 모델과 기존 소스의 한계

InfraWheel의 [`MODEL_ACCURACY_NOTES.md`](https://github.com/NULMARU/infrawheel-lite/blob/09c710e1f790ad505af4f8f9807944bed8663b99/MODEL_ACCURACY_NOTES.md)에 6가지 알려진 문제가 기록되어 있다. 엔진 코드에서도 Physical AI 매출은 `K units × $K/unit / 4`로 계산되어 `$M/분기`가 되는데 `$B/분기`인 디지털 매출과 그대로 합산되는 것을 확인했다. CAPEX 재투자에도 전파되므로 표시 숫자만 바꿔서는 해결되지 않는다.

또한 서로 다른 물리 단위를 `min()`으로 비교하고, 공간/엣지 공급 제약 연결이 불완전하며, `cycleUnit: month` 선언에도 실제 계산은 분기 단위다. 월별 기능은 노출하지 않고, 절대 매출·CAPEX를 사실상 전망치로 제공하거나 주가 모델에 연결하려면 단위 정합성·공급 제약·현실 데이터 보정이 선행돼야 한다. 기존 테스트 통과는 동작·회귀 보존의 근거이지 현실 예측 정확성의 증명은 아니다.

Stock에서 추가로 확인한 사항:

- **개발 명령 설명 차이:** `npm run dev`는 `dist`를 서빙하고, 없을 때만 빌드한다. 수정 즉시 반영되는 개발 서버가 아니며 HMR 개발은 `npm run dev:vite`에 해당한다. README는 이를 정확히 구분하지 않는다.
- **갱신 스케줄 근거 부족:** UI는 매일 06:47 KST 자동 수집을 안내하지만 저장소 Actions에는 정기 `schedule`이 없다. 수동/이슈 기반 갱신과 외부 자동화용 실행기는 있다. 외부 스케줄러 운영 여부는 이번 검토로 확인하지 못했다. GitHub Pages에는 새 데이터 산출물의 배포가 필요하다.
- **장기 검증 기록 보존:** `predict.py:78`은 53개를 ‘주 1회 × 약 1년’이라고 설명하지만 `predict.py:761`부터 실제로 실행 날짜별로 추가하고 53개만 남긴다. 매일 실행하면 1년 후 검증 전에 기록이 사라진다. 주별 저장이나 기간 기반 장기 보존으로 수정할 필요가 있다.
- **판단 일기 채점:** `src/lib/judgments.ts`는 과거의 하루 방향을 주 단위 샘플 가격의 변화로 채점할 수 있다. 산업 시나리오 학습과 연결하기 전에 정확한 일별 데이터 또는 채점 대기 정책을 마련하는 편이 좋다.
- **런타임 데이터 검증:** `useLiveData`는 응답을 `as T`로 취급하며 스키마를 검사하지 않는다. 통합 데이터에는 `schemaVersion`과 런타임 검증을 추가하고 게시 기준일과 실제 조회 시각을 구분한다.
- **정리 대상:** `src/pages/Home.tsx`와 연결된 `App.css`는 현재 라우트가 사용하지 않는 Vite 예제다. 기능 통합 시 시작점으로 삼으면 안 된다.

## 7. 구현 순서와 완료 조건

| 단계 | 범위 | 완료 조건 |
|---|---|---|
| 1. 코어 편입 | 커밋 고정, 출처 보존, 순수 엔진·지정학·프리셋·기존 테스트 복사 | 기존 154개 테스트에 대응하는 회귀 검증, Stock 빌드 성공 |
| 2. 산업 페이지 | `/industry`, 14개 입력·6개 노드, 기준/변경 비교, 한국어, URL 어댑터, 스타일 분리 | 공유 링크 복원, 뒤로가기, 기존 라우트·색상 보존, 모바일 동작 |
| 3. 종목 연결 | 큐레이션 파일, 상세 패널, 노드별 종목·뉴스·용어 연결 | 복수 역할·미매핑·간이 종목 처리, 기존 점수/예측과 별도 표시 |
| 4. 모델 개선 | 단위 정합성, 엣지 공급 제약, 가정 보정·모델 버전 분리 | 단위 검증, 민감도 검증, 근거 데이터 및 변경 전후 결과 비교 |

1~3단계는 학습용 통합의 범위다. UI 전체를 원본과 동일하게 이식할지, 핵심 입력·휠·결과만 채택할지에 따라 작업량이 달라진다. 4단계를 완료하기 전에는 시나리오를 이용한 종목별 수익률 산출을 완료 조건에 넣지 않는다.

## 8. 실행 검증과 범위

| 대상 | 실행 | 결과 |
|---|---|---|
| Stock | `npm ci --no-audit --no-fund` | 성공, lockfile 변경 없음 |
| Stock | `npm run build` | 타입 검사·프로덕션 빌드 성공 |
| Stock | `npm run lint` | 기존 오류 9개·경고 2개. 판단 패널의 effect, UI export 규칙, sidebar의 렌더 중 난수 사용 등 |
| Stock 데이터 | JSON 파싱·규모·두 디렉터리 비교 | 7개 JSON 정상 파싱 및 동일본 확인 |
| InfraWheel Lite | `npm ci --no-audit --no-fund` | 성공 |
| InfraWheel Lite | `npm test` | 테스트 파일 12개, 테스트 154개 통과 |
| InfraWheel Lite | `npm run build` | 타입 검사·프로덕션 빌드 성공 |

실행 환경은 Node 22.23.1, npm 10.9.8이다. 두 앱 모두 큰 청크 경고가 있다. 실제 통합 빌드, 브라우저 화면·모바일·PWA 테스트, Python 외부 수집 및 예측 재실행, 배포 상태 검증은 수행하지 않았다. 검토 산출물은 이 문서이며 애플리케이션 소스 변경, 커밋, 푸시, 배포는 하지 않았다.
