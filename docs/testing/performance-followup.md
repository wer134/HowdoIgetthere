# RouteFlow 초기 화면 성능 후속 검사

## 변경과 확인된 원인

기준 커밋은 `4219994cdb65f5f611c92cced91f4f573261ddc4`다. 제품 변경은 `index.html` 두 줄이며 기존 앱·계정·엑셀 데이터 처리 코드는 변경하지 않았다.

- 초기 빈 `workspaceBoard`에 `hidden`을 지정했다. 앱이 시작되면 원래 이 빈 영역을 숨기지만 시작 전 CSS의 `:has(#workspaceBoard:not([hidden]))`가 먼저 적용돼 모바일의 일정 영역을 184px에서 124px로, 데스크톱을 144px에서 78px로 이동시켰다. 앱 모듈 요청을 실제 브라우저에서 잠시 보류해 이를 재현했다. 안정적인 배치를 요구하는 검사는 수정 전 실패했고 수정 후 두 화면 모두 이동 0px로 통과했다. 새 여행 생성 뒤에는 보드가 정상적으로 나타나는 것도 확인했다.
- Google Fonts의 Manrope와 Noto Sans KR 요청을 개별 굵기 `400;500;600;700;800`에서 가변 범위 `400..800`으로 바꿨다. 글꼴 종류와 사용하는 굵기는 유지한다. DM Mono 400/500도 유지한다. [Google Fonts 공식 CSS2 안내](https://developers.google.com/fonts/docs/css2#axis_ranges)에 따른 요청이다.

같은 Chrome User-Agent로 실제 받은 CSS는 484,425바이트·654개 `@font-face`에서 98,749바이트·134개로 줄었다. 이는 디코딩된 CSS 기준 약 79.6% 감소다. 별도의 Brotli 재압축 비교는 14,654→13,982바이트여서 디코딩 크기 감소를 동일한 전송량 감소로 해석하면 안 된다. [폰트 응답 비교](evidence/performance-followup/font-comparison.json)

## 동일 환경의 새 측정

실제 `production-server.js`, 계정 미설정 상태의 `/api/session` HTTP 200, Windows의 설치된 Chrome stable, Playwright로 연 실제 Chrome의 CDP에 연결한 Lighthouse Node API를 사용했다. 모바일과 데스크톱을 각각 3회씩 순차 측정했다. 이전 보고서의 54/89는 이번 비교의 기준으로 재사용하지 않았다. 이번 baseline도 새로 측정했다.

| 항목 | 수정 전 | 수정 후 |
|---|---:|---:|
| 모바일 Performance 중앙값 | 64 (78/64/63) | 69 (77/58/69) |
| 데스크톱 Performance 중앙값 | 91 (86/92/91) | 97 (97/97/97) |
| Accessibility / Best Practices / SEO | 모든 실행 100/100/100 | 모든 실행 100/100/100 |
| 모바일 LCP 중앙값 | 4.54초 | 4.18초 |
| 모바일 TBT 중앙값 | 812ms | 706ms |
| 모바일 CLS 중앙값 | 0.00336 | 0.00169 |
| 데스크톱 LCP 중앙값 | 1.13초 | 1.01초 |
| 데스크톱 TBT 중앙값 | 214ms | 117ms |
| 데스크톱 CLS 중앙값 | 0.02240 | 0.00454 |

[중앙값·설정·산출물 비교](evidence/performance-followup/comparison.json), [수정 전 원시 결과](evidence/performance-followup/baseline/summary.json), [수정 후 원시 결과](evidence/performance-followup/after/summary.json).

모바일 범위가 수정 전 63–78, 수정 후 58–77로 겹친다. 공유 Windows 호스트와 외부 폰트 네트워크의 변동이 있으므로 5점 차이를 확정적인 모바일 속도 향상으로 주장하지 않는다. 데스크톱의 3회 결과와 CSS 크기·초기 배치의 직접 검사는 개선 근거가 더 명확하다. 모든 Lighthouse 성능 100은 달성하지 못했고, 모바일 성능은 계속 남은 한계다. 실제 운영 CDN·실기기·필드 성능 결과가 아니다.

두 빌드의 release revision은 커밋 전 HEAD `4219994`를 표시한다. baseline asset version은 `c2636c87b9ed6416`, 수정 후는 `286694c310f337c8`이다. 수정 후 버전에는 위 두 줄의 미커밋 제품 변경이 포함돼 있으며, 원본 `4219994`와 같다는 뜻이 아니다.

## 기능과 화면 확인

- 새 단위 검사 124/124 통과, build와 check:release 통과.
- 일정 보드 동작 12개와 6개 뷰포트 검사 통과.
- 실제 로컬 HTTP/SQLite를 사용한 계정 흐름 11개 통과. Google OIDC·BYOK Gemini는 모의였으며 실제 문자·AI 과금 검사는 하지 않았다.
- traveler-journey와 production-stability 통과. 여행 생성·기기 저장·백업·복원·2,000행 엑셀 Worker 처리·취소와 재시도를 포함한다.
- 앱 모듈을 보류한 첫 화면에서 모바일·데스크톱 모두 초기 위치 이동 0px, 새 여행 생성 뒤 보드 표시 통과. [수정 전](evidence/performance-followup/startup-before.json), [수정 후](evidence/performance-followup/startup-after.json), [실패 재현](evidence/performance-followup/startup-red.txt).
- 웹 폰트가 실제 로드된 경우와 폰트 요청을 차단한 경우를 각각 390/768/1440에서 확인했다. 모든 화면에 가로 넘침·페이지 오류가 없었고, 정상 환경에서는 실제 Noto Sans KR FontFace가 로드됐다. 차단 환경에서는 0개 웹 폰트로 시스템 폰트와 기존 기능을 유지했다. [폰트·fallback 상태와 캡처](evidence/performance-followup/fonts/results.json).

[기능 검사 요약](evidence/performance-followup/functional-summary.json). 계정 테스트의 원시 backend 파일 해시와 임시 SQLite는 추가 공개 증거에 넣지 않았다. 해당 원시 실행 결과는 작업 중 격리 증거에 보존했고 공개 요약에는 실제 결과와 모의 경계를 기록했다. 모든 검사에서 새 컨텍스트와 테스트 여행만 사용했다.

폰트·초기 배치 외의 코드, 시각적 요소, 애니메이션, 저장 계약은 변경하지 않았다. SheetJS를 처음 화면에서 불러오는 작업과 대형 앱의 초기 실행은 후속 성능 후보로 남는다. 이를 이번에 검증 없이 비동기 구조로 바꾸지 않았다. main 병합과 운영 배포는 하지 않았다.

## 재실행

루트에서 빌드한 뒤 설치된 Chrome을 사용한다.

```sh
npm run build
node tools/performance-startup.js .omo/evidence/performance-followup/startup.json
node tools/performance-audit.js .omo/evidence/performance-followup/audit
```

측정 도구는 실제 production 서버와 Chrome을 시작하고 종료한다. 서로 다른 Chrome 검사나 빌드를 동시에 실행하지 않는다. 원시 Lighthouse JSON은 각 실행별로 저장되며, 실패 시 부분 실행을 전체 통과로 해석하면 안 된다. 폰트 공급자가 응답 내용을 바꾸면 CSS 바이트 수는 달라질 수 있다.
