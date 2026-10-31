# 운영 준비 수정 및 최종 재검증

2026-10-31. 저장소 `wer134/HowdoIgetthere`, main에서 이어진 `work` 브랜치. 검증한 운영 코드 SHA는 `bee8a32`, 산출물 버전은 `c56afc3437629eed`다. 이후 검증 스크립트/보고서 변경은 공개 산출물에 포함되지 않는다. [원본 코드 리뷰](production-readiness.md)의 수정 가능한 항목을 반영했다. 실제 공개 서버 배포는 실행하지 않았다.

최종 78개 결과: **70 통과·0 결함 확인·8 검증 불가**. 실행하지 못한 항목은 통과로 처리하지 않는다. 단위 검사 **82/82 통과**, 별도 Chromium 데스크톱 1440px·모바일 390px 사용자 흐름 통과. Chrome의 화면 크기 모사는 iOS Safari·Android 실기기 검증과 다르다.

## 변경 및 근거

| 위험도 | 변경 | 검증 근거 |
|---|---|---|
| P1 | 저장소 루트 서비스 제거. 명시적 공개 자산만 dist에 복사하고 `.git`/`.env`/서버·검증 파일/외부 symlink 차단 | 실제 운영 산출물 [HTTP 검사](evidence/production-final/http.json), 서버 보안 단위 검사 |
| P1 | 기본 개발 실행과 운영 빌드에서 비공개 환경 키 제외. 로컬에서만 start:local 명시적 선택. 공개 Google 키만 별도 설정 | runtime-config 단위 검사, 운영 응답에서 설정된 비밀 키 부재 검사. 공개 공유 AI 서비스 대신 기존 BYOK 유지 |
| P2 | 손상·원시값·만료 캐시 복구, 정상 여행 데이터 보존, 정상 무경로 null 캐시 허용 | 캐시/경로 단위 검사, 실제 Places·Routes 조회 후 캐시 재사용 |
| P2 | AI 시간 겹침·역순·잘못된 범위 차단. 날짜를 넘기는 시간은 분리하도록 안내. 빈 시간은 허용 | 일별 수정 단위 검사와 데스크톱·모바일 미리보기/적용/취소/잠금/보존 검사 |
| P2 | 파일 20MiB·압축 해제 64MiB 제한, ZIP 중앙/로컬 정보 대조 및 실제 스트림 해제량 검사, 50시트·20,000행·200열 제한 | 크기 경계/실제 ZIP/조작된 크기 단위 검사. Worker에서 파싱하고 시간 초과·취소 시 종료 |
| P2 | 읽기 전용 화면 갱신의 전체 여행 저장 준비 제거, 변경 시 저장. 상세/사진/실패 URL 캐시 크기 상한, 화면 근처 사진만 요청 | 읽기 전용 탐색 6회에서 전체 snapshot 복제 0회. 2,000행 Worker 파싱 중 UI 타이머 28회 실행(이 환경 150ms). [안정성 결과](evidence/production-final/stability/results.json) |
| P2 | 개발/운영 서버 분리, 고정 PORT·healthz·압축·ETag·버전 캐시. CI에 비밀값/의존성/빌드/브라우저 검사와 산출물 보관 | [시작 실패 정책](evidence/production-final/startup.json), [HTTP 헤더](evidence/production-final/http.json), 동일 dist에서 브라우저 회귀 실행 |
| P3 | description·canonical·OG·공유 PNG·robots·sitemap·데이터/이용 안내. 글자 대비 및 body의 잘못된 ARIA 수정, 폰트 렌더 차단 제거 | 산출물 링크 검사·HTTP 200·모바일 Lighthouse 접근성/SEO 100 |

보안 헤더 중 object/base/frame 제한은 적용되지만 확장 CSP는 Report-Only다. 정적 호스팅에서 Node 헤더가 자동 적용되는 것은 아니다. 공유 AI 인증·사용자 한도 서버를 구현한 결과로 해석하지 않는다. 파일 제한과 Worker 종료는 보호 장치이며 모든 브라우저의 최대 힙 사용량을 보장하는 OS 메모리 격리는 아니다.

## 전체 회귀에서 발견해 추가로 고친 문제

첫 운영 빌드 회귀는 68 통과·2 결함 확인·8 검증 불가였다. 실패를 삭제하지 않고 [29번 사진 재요청](evidence/production-final/first-run/29.json), [62번 빈 파일 이후 재선택 실패](evidence/production-final/first-run/62.json)를 보관했다.

- 29번: 동일 여행을 다시 열면 완료/실패 캐시까지 초기화해 사진 3개를 반복 요청했다. 크기 제한이 있는 완료 캐시는 유지하고 실행되지 않을 대기 요청만 정리한다.
- 62번: 빈 시트가 현재 상태를 대체한 뒤 저장 형식 검사가 다음 업로드를 막았다. 데이터 행 없는 파일을 교체 전에 거부하여 원래 여행과 다음 파일 선택을 유지한다.
- 파일 시험은 임의의 150ms 대기 대신 가져오기 진행 표시가 끝날 때까지 기다린다. 성공/보존 판정 조건은 유지한다.

두 문제의 선택 재검사 후 최종 코드에서 78개 전체를 다시 실행했다. [항목별 판정·재현 절차](production-negative-78.md)와 JSON/스크린샷으로 확인할 수 있다.

## 실제 API와 모의 검증 구분

| 실행 | 실제로 확인한 범위 | 결과/근거 |
|---|---|---|
| 78개 부정 검사 | 테스트 여행과 항목별 별도 BrowserContext. Google SDK/MapView 모의 응답·지연·오류 주입; 실제 API 요청 차단 | [항목별 결과](production-negative-78.md). 실제 API 거부·쿼터 테스트로 해석하지 않음 |
| AI 하루 수정 브라우저 회귀 | 실제 UI/저장, Google·AI 대역. 잠금·다른 날·메모·열 보존, 실패/취소, 새로고침, 모바일 | [결과](evidence/production-final/day-revision/results.json) |
| 실제 Google Maps·Places·Routes | 8093 허용 주소의 새 브라우저에 테스트 키 설정. 오호리 공원→후쿠오카시 미술관 검색, 도보 경로 및 캐시 재사용 | 검색 2회·경로 HTTP 200, 1,008m·811초·1구간. [실제 응답 기록](evidence/production-final/google-live.json). 이 검색 시점/장소에 한정 |
| 실제 Gemini + 실제 지도 | 직접 작성한 XLSX의 선택 날짜만 수정 → 미술관 13:00–14:00 → 비교/적용 → 새로고침/재열기 | 실제 Gemini HTTP 200, 모의 응답 없음. 잠금·개인 메모·추가 열·다른 날짜 보존. [실제 결과](evidence/production-final/live/results.json), [재열기 화면](evidence/production-final/live/reopened.png) |
| 파일/저장 안정성 | 실제 Worker·브라우저 저장. 멈춘 Worker만 모의 주입 | 용량 초과/취소/시간 초과/재시도 및 기존 여행 보존 통과 |

실제 유료 API 호출은 CI 기본 실행에서 제외한다. 키는 응답 로그·화면·백업·Git에 기록하지 않았다. 사용자 여행·기존 브라우저 프로필을 사용하지 않았다.

## 성능·보안 수치

- Lighthouse 13.5, Chromium, 키 없는 모바일 첫 방문, 최종 빌드 2회: **성능 93/92, 접근성 100/100, Best Practices 96/96, SEO 100/100**. LCP 약 3.0초, TBT 160/170ms, CLS 0. [원본 1](evidence/production-final/lighthouse-mobile.json), [프록시를 명시한 재측정](evidence/production-final/lighthouse-mobile-proxy.json).
- 관리 환경에서 Google Fonts 요청이 ERR_TUNNEL_CONNECTION_FAILED로 실패해 시스템 폰트로 측정했다. 두 결과 모두 이 제한이 있다. 실제 운영 네트워크·지도 로드 후 성능·장기 사용·실사용자 p75/INP 통과로 해석하지 않는다. 앞선 수정 전 점수 73은 다른 브라우저 검사와 동시에 측정돼 단순 성능 향상률 비교에 사용하지 않는다.
- 전체 Git 이력 Gitleaks 8.30.0: 탐지 0. [마스킹된 결과](evidence/production-final/secrets.json). 이력 및 현재 키 검사에서 실제 키를 출력하지 않는다.
- npm audit: 취약점 0. [원본](evidence/production-final/npm-audit.json). 처음 Lighthouse 13.6 의존성에서 중간 위험 5건이 나와 13.5로 고정 후 다시 검사했다. npm audit는 vendored SheetJS/SDK까지 검사한 결과가 아니다.
- [단위 82개](evidence/production-final/unit-tests.txt), [브라우저 시나리오](evidence/production-final/browser-tests.txt), [검증 산출물](evidence/production-final/release.json).

## 재현과 운영에 남은 확인

```sh
npm ci
npm test
npm run build
npm run check:release
PORT=8097 HOST=127.0.0.1 npm run start:production
# 별도 터미널
APP_URL=http://127.0.0.1:8097 NEGATIVE_OUT=/tmp/routeflow-recheck node docs/testing/repro/negative-78.cjs
APP_URL=http://127.0.0.1:8097 node tests/browser/production-stability.cjs
APP_URL=http://127.0.0.1:8097 node tests/browser/day-revision.cjs
```

Playwright는 CHROMIUM_PATH 또는 기본 `/usr/bin/chromium`을 사용한다. 실제 API 검사는 설정된 환경 키, Google 허용 리퍼러 주소, 정상 프록시/CA가 필요하다. 8093 운영 서버에 `LIVE_BYOK=1 node tests/browser/day-revision-live.cjs`, `node tests/browser/google-live.cjs`로 선택 실행한다. 실제 키 문자열을 명령이나 파일에 적지 않는다.

사용자가 제외하기로 한 8개는 여전히 검증 불가다. 물리 모바일 제스처·실기기 Safari/Firefox/Edge, 대규모 장기 힙 프로파일링, 운영 도메인의 TLS/HSTS/실제 캐시, Search Console/GA4, 브랜치 보호와 실제 배포·롤백은 완료로 표시하지 않는다. GA4·로그인·결제·서버 세션은 현재 기능이 아니다. 유료 서비스의 운영 주체·연락처·환불/데이터 정책과 공유 AI 백엔드가 필요한지는 별도 결정 사항이다. [배포/롤백 안내](../DEPLOYMENT.md)를 따른다.

## 위험도별 커밋

- P1 `7832fc5`: 공개 자산과 비공개 런타임 키 격리.
- P2 `09a5700`: 손상 캐시 복구·AI 시간 충돌 차단.
- P2 `0da13b1`: 제한된 Worker 파일 가져오기·변경 시 저장·메모리 상한.
- P2 `5d1e8c1`: 운영 산출물·CI·배포 지침.
- P2 `4029db5`: 빈 파일 복구·사진 재시도 회귀 및 ZIP 로컬 헤더 검사.
- P3 `bee8a32`: 접근성·메타데이터·공개 데이터 처리 안내.
