# RouteFlow 운영 산출물과 배포

RouteFlow는 정적 게스트 앱과 선택형 Node 계정 서버로 구성된다. GitHub Pages에는 게스트 기능만 배포할 수 있다. 계정 저장·동행자 제안·운영자 비용 무료 AI는 Google OIDC 및 영구 저장소를 설정한 Node 서버에서 제공한다. 기존의 개인 API 키(BYOK) 기능은 유지한다. 운영자 AI 키는 서버 환경변수에만 보관하며 브라우저 산출물에 넣지 않는다.

이번 `rebuild/workspace-accounts`는 회수하지 못한 클라우드 작업을 인계 요구사항으로 새로 구현한 브랜치다. 과거 커밋과 테스트 결과의 복구본이 아니다. 실제 외부 서비스 연결과 운영 배포는 별도이며, 새 검증 결과는 [재구현 보고서](testing/workspace-account-rebuild.md)를 기준으로 확인한다.

## 빌드와 실행

```sh
npm ci
npm test
SITE_URL=https://wer134.github.io/HowdoIgetthere/ npm run build
npm run check:release
PORT=8080 npm run start:production
```

- HTTP로 공개하는 정적 파일은 **dist 디렉터리의 allowlist 자산만**이다. 저장소 루트, `.env`, `backend`, 개발 문서와 검증 증거를 웹 루트로 공개하지 않는다. GitHub Pages도 브랜치 루트 공개 대신 CI의 production-dist 산출물을 사용한다. Node 계정 서버 배포에는 서버 코드·의존성과 dist가 필요하지만 서버 코드 자체를 정적 파일로 제공하지 않는다. 이 변경은 실제 배포를 실행하지 않는다.
- `SITE_URL`은 최종 HTTPS URL이고 프로젝트 하위 경로를 포함해야 한다. canonical·OG·사이트맵 URL이 이 값으로 치환된다. 변경 후 다시 빌드한다.
- 선택 항목 `PUBLIC_GOOGLE_MAPS_KEY`만 브라우저 공개 설정에 들어간다. 이 키는 비밀이 아니며 Google Cloud에서 운영 HTTP 리퍼러와 필요한 Maps API만 허용하고 쿼터/예산 알림을 설정해야 한다. 비공개 AI 환경 키는 빌드에서 제외된다.
- 서버는 `.env`를 자동 로드하지 않는다. 플랫폼의 환경변수 설정을 사용한다. `.env.example`에 실제 키를 쓰지 않는다. `.env`가 추적됐는지는 `git ls-files '.env' '.env.*'`로 검사한다(`.env.example` 제외). 노출 이력이 있으면 파일 삭제만으로 해결되지 않으며 키 교체가 필요하다.
- Node 운영 서버는 HOST(기본 0.0.0.0)/PORT를 준수하고 `/healthz`를 제공한다. 포트 점유 시 실패한다. HTTPS는 앞단 호스팅/리버스 프록시가 종료해야 한다.
- Node 서버는 Brotli/gzip, ETag, 버전이 일치하는 자산의 immutable 캐시를 제공한다. HTML/설정은 매번 재검증한다. 정적 호스팅은 자체 헤더 정책을 별도로 확인한다. 파일 교체는 디렉터리 전체를 원자적으로 배포하고 이전 산출물을 보관한다.

## 보안·운영 확인

Node 서버에서 `.git`, `.env`, 개발 소스, 경로 순회 및 외부 symlink는 404다. nosniff, Referrer-Policy, 프레임 삽입 금지 CSP를 적용한다. 나머지 CSP는 Google SDK 호환성 확인을 위한 Report-Only다. 전면 적용됐다고 해석하지 않는다. 플랫폼 배포 후 HTTPS 리다이렉트·인증서 갱신·HSTS·CSP 실제 응답을 검사한다. GitHub Pages는 Node 응답 헤더 설정을 자동으로 사용하지 않는다.

계정 서버는 HTTPS 운영 환경에서 Secure·HttpOnly·SameSite=Lax 세션 쿠키를 사용한다. 스테이징에서 쿠키 속성, 만료, 로그아웃 폐기, Host/Origin 검사와 소유권 거부를 확인한다. 로컬 HTTP 예외를 운영 도메인에서 사용하지 않는다. 개인 API 키와 게스트 여행은 localStorage에 있으므로 신뢰하는 브라우저에서 사용하고, 여행 백업에 키가 없는지 유지 검증한다.

## 계정 서버와 영구 저장소

- Node.js 24 이상, Google OIDC, Node 내장 SQLite를 사용한다. SQLite는 영구 볼륨을 연결한 **단일 서버 인스턴스**용이다. 여러 복제본이나 임시 파일시스템에 그대로 배포하지 않는다.
- `ACCOUNT_ORIGIN`은 실제 계정 서비스의 origin이고 API 경로는 도메인 루트 `/api`다. Google 콜백과 브라우저가 같은 서비스 origin을 사용해야 한다. `SITE_URL`은 정적 메타데이터용이므로 계정 origin 설정을 대신하지 않는다.
- `ACCOUNT_DB_PATH`의 디렉터리는 공개 자산 디렉터리 밖에 둔다. DB·WAL·SHM을 Git이나 웹에 공개하지 않는다. 파일 권한과 볼륨 접근 권한은 배포 플랫폼에서 확인한다.
- `ACCOUNT_SECRET`은 전화번호 암호화와 식별 해시에 사용한다. DB와 함께 안전하게 복구할 수 있어야 하며 임의 교체하지 않는다. 실제 값·세션·전화번호를 로그나 증거 파일에 남기지 않는다.
- Google 클라이언트 설정, Twilio Verify, 국가별 허용 범위, SMS/AI 예산 변수는 [.env.example](../.env.example)와 [계정 운영 안내](ACCOUNTS.md)를 따른다. 무료 AI는 기본 OFF, SMS/AI 예산은 기본 0이다. 실제 인증·문자·과금이 검증되기 전에 활성화하지 않는다.
- 전화 인증은 운영자 비용 무료 AI의 사용 조건이다. 수동 편집, 게스트·계정 저장, 개인 API 키 사용에는 전화 인증을 요구하지 않는다. 실제 청구서를 대조하는 결제 원장이 아니라 외부 호출 전 설정한 최대 예상 비용을 예약하는 방식이므로 모델·국가 단가를 과소 설정하지 않는다.
- 프록시 전달 IP를 사용할 때는 `TRUSTED_PROXY_ADDRESSES`를 실제 앞단 프록시 주소로 제한한다. 클라이언트가 보낸 전달 헤더를 무조건 신뢰하지 않는다.

### 백업과 복원 점검

쓰기 중인 SQLite 파일만 단순 복사하지 않는다. SQLite의 온라인 백업 기능을 사용하거나 서버를 정상 중지한 뒤 DB 상태를 일관되게 백업한다. `ACCOUNT_SECRET`과 DB의 복구 세대를 맞추고 백업 접근 권한을 제한한다. 별도 복원 디렉터리와 테스트 서비스에서 여행·제안·세션 정책을 확인한 후 운영 복원 여부를 결정한다. 영구 볼륨 재시작과 백업 복원 훈련은 실제 운영 인프라에서 별도로 수행해야 하며, 로컬 단위 검사가 이를 대신하지 않는다.

CI는 읽기 전용 권한으로 전체 Git 이력 Gitleaks(키 마스킹), npm audit, 단위 검사, 공개 산출물 검사, 별도 Chromium 모의 API 회귀와 Lighthouse를 실행한다. 실제 유료 API 검사는 CI에 키를 넣지 않고 선택 실행한다. npm audit는 npm 의존성 범위이며 vendored SheetJS/SDK의 검토를 대신하지 않는다. 브랜치 보호의 필수 검사 지정은 저장소 설정에서 별도로 확인한다.

## 출시 확인과 롤백

1. Production checks의 성공 SHA와 production-dist 산출물의 release.json(version/revision)을 기록한다.
2. 스테이징에서 `/healthz`(Node), 필수 자산·Worker, 지도, 여행 생성/편집/새로고침, 파일 가져오기, AI 미리보기/취소/적용을 확인한다.
3. 승인된 산출물을 운영에 배포하고 같은 URL·기능을 다시 확인한다. 기존 브라우저 저장본과 계정 DB 백업을 별도 테스트 데이터로 확인한다. 이 재구현 작업에서는 운영 배포와 main 병합을 수행하지 않는다.
4. 장애 시 보관한 이전 **전체 산출물**로 원자적 복구하고 HTML 캐시를 무효화한다. 이전 release.json과 주요 시나리오를 확인한다. 이전 산출물이 없으면 알려진 정상 SHA에서 CI를 다시 실행한다.
5. 운영 오류율·API 거부/쿼터·비용 알림을 모니터링한다. 원본 일정/키가 로그에 남지 않게 한다.

## 검색·안내

공유 PNG는 1200×630이며 OG/canonical/설명/아이콘, privacy.html/terms.html, sitemap.xml을 제공한다. Google Fonts는 display=swap과 기본 시스템 폰트 fallback을 사용한다. 대표 도메인이 결정되면 SITE_URL을 확정하고 실제 크롤링 결과를 확인한다.

검색 로봇은 도메인 루트의 `/robots.txt`를 읽는다. GitHub Pages 프로젝트 하위 경로에 있는 robots.txt만으로 루트 정책이 적용되지는 않는다. 소유한 루트 사이트의 robots.txt에서 프로젝트 사이트맵을 지정하거나 Search Console에 프로젝트 sitemap.xml을 제출한다. GA4는 설치하지 않았으며 분석 측정이 통과했다고 기록하지 않는다.

공개 안내는 게스트·선택형 계정·BYOK 처리 범위를 설명한다. 실제 계정 서비스를 운영하기 전에 운영 주체·비공개 연락처·서버 데이터 보관과 삭제 절차를 확정해야 한다. 유료 상품을 출시한다면 계약·환불 정책도 필요하다. 문구 추가만으로 해당 결정이나 법률 검토가 완료된 것은 아니다.
