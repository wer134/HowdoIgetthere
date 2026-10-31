# 개발·로컬 실행 안내

사용 방법은 [README](../README.md)를 참고하세요.

## 실행

Node.js가 설치된 환경에서 실행합니다. 현재 서버 실행에는 추가 npm 패키지 설치가 필요하지 않습니다.

```bash
npm start
```

Windows에서는 `start.bat`을 실행할 수도 있습니다. 기본 주소는 `http://localhost:8080`이며, 포트가 사용 중이면 다른 PORT를 명시하세요.

`npm start`는 환경의 비밀 키를 브라우저에 전달하지 않습니다. 필요한 키는 설정 화면에서 입력합니다. 환경의 `googleAPI`/`googlemap` 및 `geminiapi`를 쓰는 **로컬 검증에만** `npm run start:local`을 사용하세요. 이 명령은 키를 로컬 브라우저로 전달하므로 공개 터널에 연결하면 안 됩니다. 브라우저에 직접 저장한 설정이 우선하며, 키를 비우고 저장하면 해당 브라우저의 환경 키 사용도 중지합니다.

개발 서버는 127.0.0.1에만 바인딩하고 지정 포트가 점유되면 실패합니다. `PORT=8093 npm run start:local`처럼 포트를 정할 수 있습니다. 공개 운영은 `dist/`만 배포하며 [배포 안내](DEPLOYMENT.md)를 따릅니다.

## 검증

```bash
npm test
```

`npm ci`와 `npx playwright install chromium`으로 검증 의존성을 설치합니다. Playwright와 Chromium이 설치된 환경에서는 서버를 실행한 뒤 다음 브라우저 검증도 사용할 수 있습니다.

```bash
node tests/browser/travel-workspace.cjs
node tests/browser/travel-order.cjs
```

`APP_URL` 기본값은 `http://127.0.0.1:8080`, `CHROMIUM_PATH` 기본값은 `/usr/bin/chromium`입니다.

## 주요 파일

| 파일 | 역할 |
|---|---|
| `index.html`, `css/style.css` | 화면 구성과 반응형 스타일 |
| `js/app.js` | 일정 편집·장소 보관함·브라우저 저장 |
| `js/excel.js`, `js/xlsxedit.js` | 엑셀 처리 |
| `js/places.js`, `js/nearby.js` | 장소 검색·사진·상세 정보 |
| `js/mapview.js`, `js/routes.js` | 지도와 경로 |
| `js/planner.js`, `js/plan.js` | AI 일정 추천과 일정 점검 |
| `server.js` | 로컬 정적 서버와 실행 시 설정 |

## 공개 운영 전에 확인할 사항

- 프로젝트 자체의 코드 이용·배포 라이선스를 정합니다. 현재는 미지정입니다.
- 번들에 포함된 전이 의존성의 고지까지 원본 배포본과 대조합니다.
- Google 지도·사진·리뷰의 출처가 실제 화면에서 누락되지 않는지 확인합니다. 특히 목록 썸네일의 사진 출처 노출 방식을 점검해야 합니다.
- Google 검색·경로 응답에 적용된 현재 30일 캐시를 일괄적으로 허용된 정책으로 간주하지 말고, API·필드별 정책과 대조합니다.
- 운영 주체·문의처·실제 데이터 처리에 맞는 공개 이용약관 및 개인정보처리 안내를 준비합니다. README의 간단한 설명만으로 이를 대체하지 않습니다.
- 새 계정·클라우드 저장·결제·분석 도구를 추가하면 데이터 전송·보관·삭제 설명도 갱신합니다.

[외부 고지](../THIRD_PARTY_NOTICES.md)와 [저작권 안내](../COPYRIGHT.md)도 함께 확인하세요.
