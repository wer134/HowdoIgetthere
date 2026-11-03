# 계정 저장과 동행자 제안 — 재구현

이 문서는 `rebuild/workspace-accounts`에서 새로 구현한 Node 24 계정 서버의 설정입니다. 회수하지 못한 과거 코드나 테스트의 결과를 현재 구현의 근거로 사용하지 않습니다.

## 구성과 기본 상태

기존 HTML/CSS/JavaScript 앱과 게스트 `localStorage`/파일 백업을 유지합니다. 별도 Node 서버에서 Google OIDC 로그인, SQLite 계정 저장, 읽기 공유와 장소 제안을 제공합니다. GitHub Pages는 게스트 기능만 실행할 수 있습니다. 계정 서비스에는 Node 24 이상, HTTPS 도메인 루트 `/api`, 단일 서버 인스턴스와 영구 디스크가 필요합니다. 여러 서버가 같은 SQLite 파일을 공유하는 구성은 지원하지 않습니다.

계정 환경변수가 없으면 `/api/session`은 `available:false`를 반환하고 다른 계정 API는 503입니다. 로그인은 선택 사항이며 로그인 자체로 기기 여행을 업로드하지 않습니다. Twilio Verify와 운영자 AI는 별도 설정이 필요하며 기본 예산은 모두 0, 무료 AI는 OFF입니다. 수동 편집, 게스트 저장, 계정 저장, 개인 API 키에는 전화 인증을 요구하지 않습니다.

## 계정 설정

1. Google Cloud에서 Web application OAuth 클라이언트를 만들고 허용 리디렉션 URI를 `https://실제도메인/api/auth/callback`으로 등록합니다. 테스트 상태에서는 허용된 테스트 사용자부터 검증합니다.
2. `.env.example`을 참고해 `ACCOUNT_ORIGIN`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `ACCOUNT_SECRET`, `ACCOUNT_DB_PATH`를 서버 실행 환경으로 전달합니다. `ACCOUNT_ORIGIN`은 경로와 마지막 `/` 없는 출처입니다.
3. `ACCOUNT_SECRET`은 최소 32바이트 무작위 비밀로 설정하고 DB 백업과 함께 별도 비밀 저장소에 보관합니다. 전화 암호화·식별 해시에 사용하므로 임의 교체하면 기존 데이터가 호환되지 않습니다.
4. TLS 종료 프록시를 사용할 때만 `TRUSTED_PROXY_ADDRESSES`에 실제 소켓 상대 IP를 쉼표로 적습니다. 기본값은 forwarded IP를 신뢰하지 않습니다. 프록시는 외부 Host를 유지하고, 클라이언트가 보내는 X-Forwarded-For를 제거한 뒤 검증된 IP로 덮어써야 합니다.
5. `npm ci`, `npm test`, `npm run build`, `npm run check:release` 후 `npm run start:production`을 실행합니다. 서버는 `.env`를 자동으로 읽지 않습니다. Node의 `node --env-file=.env production-server.js` 또는 호스팅의 비밀 환경변수 기능을 사용합니다.

OAuth는 openid-client의 인증 코드 검증을 사용하며 PKCE/state/nonce와 ID token을 검증합니다. 로그인 흐름은 서버 DB에서 10분 후 만료되며 콜백에서 한 번만 소비됩니다. 세션은 무작위 불투명 토큰이고 DB에는 HMAC만 저장됩니다. 계정당 최신 10개, 7일 만료입니다. HTTPS 쿠키에는 `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`가 적용됩니다.

로그인 시작은 외부 인증 URL 생성 전 네트워크별 10분 10회로 제한합니다. IPv6는 압축·대소문자 표기를 정규화한 /64 단위이며 IPv4-mapped 표기는 직접 IPv4와 같은 버킷을 사용합니다. 미완료 흐름 전체는 1,000개로 제한하고 만료 흐름·시도 기록을 정리합니다. 여러 독립 네트워크를 쓰는 분산 서비스 거부 공격까지 막는 것은 아니므로 운영 프록시의 추가 요청 제한도 권장합니다.

## 저장, 공유, 제안

- 여행당 2MiB, 계정당 20여행·20MiB. 전체 여행 본문 기본 1GiB, 계정 10,000개, 제안 100,000개입니다. SQLite/인덱스/세션/사용 기록 등 파일 오버헤드는 본문 한도에 포함되지 않으므로 디스크 사용량도 별도 감시합니다.
- 모든 계정 여행은 소유권 확인 후 조회·수정합니다. 저장에는 현재 `version`이 필요하고 오래된 버전은 409입니다. 입력은 기존 여행 형식을 검증하고 허용 필드만 저장합니다. 시간 수식의 보호 메타데이터와 개인 열도 보존합니다.
- 공유 링크는 30일이며 토큰은 브라우저 URL fragment에 넣고 API 요청 시 사용합니다. 서버에는 토큰 해시만 저장합니다. 링크 갱신은 기존 링크를 무효화하고 취소는 즉시 적용됩니다. 링크 소지자는 일정·후보·메모를 읽을 수 있으므로 공개 범위를 확인하고 공유해야 합니다.
- 제안에는 로그인 필요. 계정당 하루 20개까지, 주인만 현재 버전을 기반으로 후보에 수락할 수 있습니다. 수락과 버전 증가는 하나의 SQLite 트랜잭션입니다. 실시간 공동 편집이 아닙니다.
- 변경 API는 정확한 Origin 및 `X-RouteFlow-Request: 1` 헤더를 요구합니다. API는 `no-store`, 공개 정적 자산은 기존 allowlist만 제공하고 backend 소스는 공개하지 않습니다.

## 문자 인증과 무료 AI

Twilio Verify 서비스와 Account SID/Auth token을 서버에 설정합니다. 기본 허용 국가는 KR이고 유효한 모바일 번호만 허용합니다. 번호는 AES-256-GCM 암호화, 중복 한도용 식별자는 HMAC입니다. SMS는 60초 재전송 대기, 계정·전화번호별 UTC 하루 3회, 네트워크별 하루 20회, 인증 요청별 최대 5회 검사, 계정별 10분 10회 검사입니다. 인증 요청은 10분 후 만료됩니다. 인증한 번호 변경은 30일 대기합니다.

무료 AI는 `FREE_AI_ENABLED=true`, 서버 Gemini 키와 예산을 설정했을 때만 사용할 수 있습니다. 로그인·최근 180일 내 전화 인증·본인 소유 계정 여행을 요구합니다. 계정·번호·여행별 UTC 하루 1회, 계정 동시 1회·전체 동시 3회입니다. 입력 기본 12,000자, 출력 기본 2,048토큰입니다. 클라이언트 request ID와 입력 지문으로 재호출을 막고 결과는 미리보기 텍스트로 반환합니다. 저장 일정을 자동 변경하지 않습니다.

SMS/AI는 외부 호출 **전** 일·월 호출 수와 최대 예상 비용을 SQLite `BEGIN IMMEDIATE`에서 원자적으로 예약합니다. `*_MAX_COST_MICROUSD`와 일·월 예산/호출 제한 중 하나라도 충족하지 못하면 호출하지 않습니다. 1달러는 1,000,000 micro-USD입니다. 실패·시간초과도 비용 예약을 되돌리지 않습니다. AI pending 작업은 이후 예약 검사에서 3분이 지났으면 failed로 전환하지만 사용량을 유지합니다. 결과가 실패한 같은 request ID도 재실행하지 않습니다.

이 한도는 제공업체의 실제 청구서가 아니라 운영자가 설정한 최대 예상액을 제한합니다. 모델·국가별 가격, 세금과 부가 요금을 과소 설정하면 실제 청구가 예약액보다 클 수 있습니다. 제공업체 자체 결제 한도·국가 제한·이상 사용 알림도 설정해야 합니다. 전화 인증은 번호 소유 확인이며 법적 실명 인증이나 여러 실제 번호를 가진 공격의 완전 차단을 보장하지 않습니다.

## 백업과 운영 점검

SQLite DB는 영구 볼륨에 두고 백업 접근을 제한합니다. 서버를 정상 종료한 뒤 SQLite DB와 WAL/SHM이 남아 있다면 함께 일관된 시점으로 복사합니다. 실행 중 개별 파일만 복사하지 마세요. 라이브 백업은 SQLite backup API 등 일관된 백업 방식을 사용합니다. 복원은 별도 스테이징 볼륨에서 같은 `ACCOUNT_SECRET`으로 시작해 로그인·소유권·저장·공유 취소를 검증한 뒤 운영 절차에 반영합니다. Unix의 DB 파일 권한은 0600을 요청하며 Windows에서는 영구 디렉터리 ACL을 운영자가 제한해야 합니다.

정기적으로 디스크/WAL 크기, 계정 수, 저장 본문 합계, SMS/AI 제공업체 청구액과 예약액을 모니터링합니다. 공유·로그인·세션·번호·외부 응답·인증 헤더는 접근 로그에 기록하지 않습니다. DB에는 계정 이메일/이름, 여행, 전화 암호문, 사용량이 있으므로 운영자의 개인정보 보관·삭제 정책과 연락처를 확정해야 합니다.

## 검증 경계

새 테스트는 실제 로컬 HTTP·SQLite를 사용합니다. 제공업체만 주입한 모의 객체를 쓰며 Google OAuth 실제 서비스, 실제 문자 수신, Gemini 실제 과금 통합을 통과한 것으로 해석하지 않습니다. 실제 계정 연결, 문자 수신, 운영 배포, Docker, 영구 볼륨 재시작/복원 훈련은 별도 검증이 필요합니다. 재구현의 테스트 결과는 `docs/testing/evidence/rebuild/accounts/`의 새 로그를 기준으로 확인합니다.

### 제공업체 호출 규약 확인 (2026-11-04)

설치된 `openid-client@6.8.9`의 `build/index.d.ts` 925행에서 `discovery(server, clientId, metadata|string, clientAuthentication?, options?)`를 확인했습니다. 구현은 세 번째 인수에 client secret, 다섯 번째 인수에 15초 timeout을 전달합니다. 같은 선언의 1822–1849행과 1910행에서 `authorizationCodeGrant(config, currentUrl, checks)` 및 `expectedNonce`, `expectedState`, `idTokenExpected`, `pkceCodeVerifier`를 확인했습니다. nonce/state/verifier는 매 로그인 시 생성하고 서버에 보관한 값으로 검사합니다. 이는 로컬 타입 선언과 공식 문서 대조이며 실제 Google 로그인 성공 증거가 아닙니다. [공식 검사 옵션](https://github.com/panva/openid-client/blob/main/docs/interfaces/AuthorizationCodeGrantChecks.md)

Twilio의 공식 Verify 문서와 대조해 `/v2/Services/{ServiceSid}/Verifications`에 `To`, `Channel=sms`, `/v2/Services/{ServiceSid}/VerificationCheck`에 `To`, `Code`를 form encoding으로 전달하도록 구현했습니다. 인증 성공은 응답 `status=approved`로 판단합니다. [Verification Check](https://www.twilio.com/docs/verify/api/verification-check), [Verification 시작](https://www.twilio.com/docs/verify/api/verification)
