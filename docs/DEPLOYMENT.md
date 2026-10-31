# RouteFlow 운영 산출물과 배포

현재 서비스는 정적 웹앱이며, 로그인·결제·클라우드 저장·운영자 공유 AI 키 API가 없다. AI는 사용자가 설정하는 키(BYOK)로 호출한다. 운영자의 Gemini/OpenAI/Claude 키를 사이트에 넣어 무료 공개하면 안 된다. 공유 AI 서비스를 추가하려면 별도 인증 백엔드, 사용자별 한도·속도 제한·요금 통제 설계가 선행되어야 한다.

## 빌드와 실행

```sh
npm ci
npm test
SITE_URL=https://wer134.github.io/HowdoIgetthere/ npm run build
npm run check:release
PORT=8080 npm run start:production
```

- 배포 대상은 **dist 디렉터리만**이다. 저장소 루트, `.env`, `server.js`, 개발 문서와 검증 증거는 공개 대상에서 제외한다. GitHub Pages도 브랜치 루트 공개 대신 CI의 production-dist 산출물로 배포한다. 이 변경은 실제 배포를 실행하지 않는다.
- `SITE_URL`은 최종 HTTPS URL이고 프로젝트 하위 경로를 포함해야 한다. canonical·OG·사이트맵 URL이 이 값으로 치환된다. 변경 후 다시 빌드한다.
- 선택 항목 `PUBLIC_GOOGLE_MAPS_KEY`만 브라우저 공개 설정에 들어간다. 이 키는 비밀이 아니며 Google Cloud에서 운영 HTTP 리퍼러와 필요한 Maps API만 허용하고 쿼터/예산 알림을 설정해야 한다. 비공개 AI 환경 키는 빌드에서 제외된다.
- 서버는 `.env`를 자동 로드하지 않는다. 플랫폼의 환경변수 설정을 사용한다. `.env.example`에 실제 키를 쓰지 않는다. `.env`가 추적됐는지는 `git ls-files '.env' '.env.*'`로 검사한다(`.env.example` 제외). 노출 이력이 있으면 파일 삭제만으로 해결되지 않으며 키 교체가 필요하다.
- Node 운영 서버는 HOST(기본 0.0.0.0)/PORT를 준수하고 `/healthz`를 제공한다. 포트 점유 시 실패한다. HTTPS는 앞단 호스팅/리버스 프록시가 종료해야 한다.
- Node 서버는 Brotli/gzip, ETag, 버전이 일치하는 자산의 immutable 캐시를 제공한다. HTML/설정은 매번 재검증한다. 정적 호스팅은 자체 헤더 정책을 별도로 확인한다. 파일 교체는 디렉터리 전체를 원자적으로 배포하고 이전 산출물을 보관한다.

## 보안·운영 확인

Node 서버에서 `.git`, `.env`, 개발 소스, 경로 순회 및 외부 symlink는 404다. nosniff, Referrer-Policy, 프레임 삽입 금지 CSP를 적용한다. 나머지 CSP는 Google SDK 호환성 확인을 위한 Report-Only다. 전면 적용됐다고 해석하지 않는다. 플랫폼 배포 후 HTTPS 리다이렉트·인증서 갱신·HSTS·CSP 실제 응답을 검사한다. GitHub Pages는 Node 응답 헤더 설정을 자동으로 사용하지 않는다.

현재 쿠키/서버 세션은 없으므로 Secure/HttpOnly 세션 검사는 해당 없음이다. 이후 인증을 추가할 때 HttpOnly·Secure·SameSite·만료·로그아웃 폐기·CSRF를 검증한다. 사용자 API 키와 여행은 localStorage에 있으므로 신뢰하는 개인 브라우저에서만 사용하고, 백업 파일에 키가 없는지 유지 검증한다.

CI는 읽기 전용 권한으로 전체 Git 이력 Gitleaks(키 마스킹), npm audit, 단위 검사, 공개 산출물 검사, 별도 Chromium 모의 API 회귀와 Lighthouse를 실행한다. 실제 유료 API 검사는 CI에 키를 넣지 않고 선택 실행한다. npm audit는 npm 의존성 범위이며 vendored SheetJS/SDK의 검토를 대신하지 않는다. 브랜치 보호의 필수 검사 지정은 저장소 설정에서 별도로 확인한다.

## 출시 확인과 롤백

1. Production checks의 성공 SHA와 production-dist 산출물의 release.json(version/revision)을 기록한다.
2. 스테이징에서 `/healthz`(Node), 필수 자산·Worker, 지도, 여행 생성/편집/새로고침, 파일 가져오기, AI 미리보기/취소/적용을 확인한다.
3. 승인된 산출물을 운영에 배포하고 같은 URL·기능을 다시 확인한다. 이용자 여행은 브라우저에 저장되므로 새 버전에서 기존 저장본도 열어본다.
4. 장애 시 보관한 이전 **전체 산출물**로 원자적 복구하고 HTML 캐시를 무효화한다. 이전 release.json과 주요 시나리오를 확인한다. 이전 산출물이 없으면 알려진 정상 SHA에서 CI를 다시 실행한다.
5. 운영 오류율·API 거부/쿼터·비용 알림을 모니터링한다. 원본 일정/키가 로그에 남지 않게 한다.

## 검색·안내

공유 PNG는 1200×630이며 OG/canonical/설명/아이콘, privacy.html/terms.html, sitemap.xml을 제공한다. Google Fonts는 display=swap과 기본 시스템 폰트 fallback을 사용한다. 대표 도메인이 결정되면 SITE_URL을 확정하고 실제 크롤링 결과를 확인한다.

검색 로봇은 도메인 루트의 `/robots.txt`를 읽는다. GitHub Pages 프로젝트 하위 경로에 있는 robots.txt만으로 루트 정책이 적용되지는 않는다. 소유한 루트 사이트의 robots.txt에서 프로젝트 사이트맵을 지정하거나 Search Console에 프로젝트 sitemap.xml을 제출한다. GA4는 설치하지 않았으며 분석 측정이 통과했다고 기록하지 않는다.

공개 안내는 현재 실제 데이터 처리와 BYOK 이용 방식을 설명한다. 유료 상품 출시 시 운영 주체·연락처·계약/환불·데이터 보관 정책, 프로젝트 코드 라이선스 및 외부 API 약관을 별도로 확정해야 한다. 문구 추가만으로 해당 결정이 완료된 것은 아니다.
