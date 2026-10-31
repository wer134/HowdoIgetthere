# 사용자 관점 개선과 최종 검증

2026-10-31 후속 검증: [실제 Google·Gemini 연동 및 재검증](live-api-2026-10-31.md). 아래 기록의 “실제 API 0건”은 당시 실행 범위입니다.

검증 코드: `a6d7bcd8c799db4aeb36379cc29176068891a9ed` · main `de2ecb4`에서 이어진 로컬 work 브랜치. 최종 78개 실행 2026-10-30T14:43:25.591Z ~ 2026-10-30T14:47:23.130Z (UTC).

## 구매 가치에 대한 판단

개인 여행을 정리하고, 다른 브라우저로 옮기고, 여행 중 오프라인으로 펼쳐 보는 **일회성 여행 준비 도구**로는 비용을 지불할 만한 사용 흐름을 갖췄다고 판단한다. 처음 방문한 사람에게 API 설정과 검색부터 요구하던 화면에서 벗어나, 일정 추가와 직접 후보 보관을 먼저 안내한다. 이는 아래 실행에 근거한 개발자의 제품 판단이며 실제 사용자 인터뷰나 구매 전환 검증은 아니다.

**일반 소비자 대상 유료 지도·경로 서비스나 월 구독 제품으로 출시할 판단은 보류한다.** 실제 Google 장소 정확도·길찾기·지도 조작·비용을 검증할 키가 없고, 현재 지도 기능은 사용자 본인의 API 프로젝트 설정이 필요하다. 동기화·공동 편집은 현재 제공하지 않는다. 이 제약을 새로운 기능이나 모의 지도 결과로 숨기지 않았다.

## 사용자가 겪던 문제와 바뀐 동작

| 사용자 관점의 문제 | 바뀐 동작 | 실행 근거 |
|---|---|---|
| 시작부터 API 키와 결제 계정 설정에 막힘 | 지도 없이 이름·지역·메모로 후보 보관. 새 여행은 일정 추가 화면으로 시작하고 오늘 날짜 기본 제공 | 실제 SDK 없이 1440·390px 시나리오 |
| 후보·메모까지 다른 기기로 옮길 방법이 없음 | 여행 전체 백업에 일정·후보·메모·빈 날짜를 담고 새 ID의 복원본 생성. 기존 여행 유지 | 독립 BrowserContext 복원 및 새로고침 |
| 여행 중 편하게 볼 자료가 없음 | 전체 일정·빈 날·보관 후보를 읽는 일정표, 오프라인 HTML, 인쇄/PDF | 실제 다운로드 HTML과 A4 PDF 생성·시각 확인 |
| 다시 방문할 때 여행을 찾아 들어가야 함 | 최근 여행 이어서 준비하기 및 이름 변경 | 이름 저장·재방문·복원본 재열기 |
| 오래된 Google 캐시 정리가 내 메모까지 삭제 | 외부 장소 데이터가 만료되어도 개인 메모 보존 | 31일 지난 후보에 예약 메모 주입 후 열기 |
| 빈 검색 결과에서 검색어를 지우면 드래그가 사라짐 | 재생성되는 행에도 draggable 속성 유지 | 수정 전 false/false 재현, 수정 후 실제 dragstart/drop 및 순서 변경 |
| 매 행의 경고로 목록이 복잡하고 PDF 폭이 좁음 | 장소 최신성 안내를 목록 공통 안내로 모으고, 인쇄는 용지 폭 사용 | 스크린샷 및 최종 A4 1페이지 PDF |

## 반복 검증 결과

- 최종 78개: **통과 70 · 결함 확인 0 · 검증 불가 8**. 하위 검사 190개. 페이지 오류·도구 오류 없음.
- 단위 테스트 **46/46 통과**. 기존 여행 작업 화면(1440/390px), 순서·undo·드래그·복수 여행 회귀 통과.
- 신규 사용 시나리오 **1440px/390px 모두 통과**. 후보 3개(동명 2개 포함) → 날짜 배치 → 시간·여러 줄 메모 수정 → 이름 변경 → 검색 없음 복구 → 전체 백업 → 원본 보존 복원 → 다른 컨텍스트에서 재열기 → 오프라인 일정표 열람.
- 실패 시나리오: 손상 JSON, 미지원 백업 버전, localStorage 쓰기 실패에서 기존 여행·저장본 유지. 백업에 API 키·사진·리뷰 미포함. HTML 주입 문자열은 이스케이프.
- 첫 전체 실행에서는 3번의 화면 밖 대상 드래그 준비 과정이 시간 초과로 끝나 69 통과·9 검증 불가였다. 실패를 통과로 바꾸지 않고 원본 결과를 보존했다. 대상을 미리 스크롤한 뒤 실제 dragTo를 실행하도록 재현 도구를 바꾸고, 최종 78개 전체를 다시 실행했다. 검색어 삭제 후 드래그 소실은 별도의 실제 앱 결함으로 재현·수정했다.

## 검증 환경과 한계

별도 Chromium 154.0.8037.57 프로세스, 비영속 BrowserContext, Node 24.19.0, Playwright 1.62.1. 전용 부산 여행/fixture와 테스트 파일만 사용했다. 외부 요청은 차단했다. 신규 사용자 시나리오는 Google SDK 대역도 사용하지 않고 로컬 편집·저장만 실행했다. 78개 검사는 기존 모의 Google SDK 및 지도 호출 기록 대역을 사용했다. **실제 Google API 검증은 0건**이다. 실제 지도·OS 드래그·소프트 키보드·스크린리더 등의 미실행 조건은 계속 검증 불가로 둔다.

## 커밋

| 위험도 | 커밋 | 내용 |
|---|---|---|
| P1 | `53a9c35` | 장소 캐시 만료 때 개인 메모 보존 |
| P2 | `8eed055` | 지도 없이 후보 보관, 전체 백업·안전한 복원, 일정표·이름 변경·이어서 준비하기 |
| P3 | `78f13a6` | 첫 화면·모바일·일정표 가독성 및 사용 안내 |
| P2 | `dc28a55` | 빈 검색 후 실제 드래그 복구와 회귀 검사 |
| P3 | `a6d7bcd` | 인쇄 폭·여백, 일정표 그룹 생성 개선, 드래그 재현 준비 |

## 증거와 재현

- [신규 사용자 시나리오](../../tests/browser/traveler-journey.cjs) · [결과](evidence/traveler-review/journey/results.json) · [실행 로그](evidence/traveler-review/journey.log)
- [검색 후 드래그 회귀](../../tests/browser/travel-drag.cjs) · [수정 전 실패](evidence/traveler-review/drag-before.log) · [수정 후 성공](evidence/traveler-review/drag-after.log)
- [단위 테스트](evidence/traveler-review/unit-tests.txt) · [기존 모바일/데스크톱 회귀](evidence/traveler-review/workspace.log) · [순서 회귀](evidence/traveler-review/order.log)
- [첫 전체 시도 결과](evidence/traveler-review/negative-78-first-attempt/results.json) · [3번 중단 증거](evidence/traveler-review/negative-78-first-attempt/03.json)
- [최종 78개 집계](evidence/traveler-review/negative-78/results.json) · [전체 로그](evidence/traveler-review/negative-78/run.log) · [최종 요약](evidence/traveler-review/summary.json)
- [첫 화면](evidence/traveler-review/journey/1440-start.png) · [모바일 복원](evidence/traveler-review/journey/390-restored.png) · [모바일 일정표](evidence/traveler-review/journey/390-itinerary.png) · [실제 PDF](evidence/traveler-review/journey/itinerary.pdf) · [PDF 시각 확인](evidence/traveler-review/journey/print-preview.png)

```bash
PORT=8093 node server.js --no-open
# 다른 터미널, 저장소 루트
npm test
APP_URL=http://127.0.0.1:8093 JOURNEY_OUT=/tmp/new-traveler-journey node tests/browser/traveler-journey.cjs
APP_URL=http://127.0.0.1:8093 node tests/browser/travel-drag.cjs
APP_URL=http://127.0.0.1:8093 NEGATIVE_OUT=/tmp/new-negative-78 node docs/testing/repro/negative-78.cjs
```

## 78개 항목별 최종 판정

기대 조건과 세부 재현 절차는 [사용자 원문](repro/negative-tests-78-input.txt) 및 [이전 상세 보고서](negative-tests-78.md)를 따른다. 아래 JSON에는 이번 실행의 시작·종료 시각, 재현 절차, 모든 하위 판정과 관측값이 들어 있다. 미실행 하위 조건이 하나라도 있는 항목은 전체 통과로 처리하지 않았다.

| 번호 | 최종 결과 | 하위 검사 | 항목 및 관측 근거 |
|---|---|---|---|
| 1 | 통과 | 3 | [검색 중 네트워크 끊김: 요청 도중 오프라인으로 전환하고 복구한다](evidence/traveler-review/negative-78/01.json) · [화면](evidence/traveler-review/negative-78/01.png) |
| 2 | 통과 | 4 | [중복 제출: 여행 생성·일정 추가·적용 버튼을 연속 클릭하고 Enter와 클릭을 동시에 실행한다](evidence/traveler-review/negative-78/02.json) · [화면](evidence/traveler-review/negative-78/02.png) |
| 3 | 통과 | 5 | [편집 중 이탈: 저장 전 입력, 드래그 직후 뒤로 가기·새로고침·탭 종료를 실행한다](evidence/traveler-review/negative-78/03.json) · [화면](evidence/traveler-review/negative-78/03.png) |
| 4 | 통과 | 5 | [API 권한 없음: 잘못된 키, 리퍼러 제한, Places API 비활성화 응답을 재현한다](evidence/traveler-review/negative-78/04.json) · [화면](evidence/traveler-review/negative-78/04.png) |
| 5 | 통과 | 3 | [인증 상태 상실: 사용 중 API 키를 제거·무효화한다](evidence/traveler-review/negative-78/05.json) · [화면](evidence/traveler-review/negative-78/05.png) |
| 6 | 통과 | 2 | [검색 응답 역전: A 요청을 지연시키고 B 검색 또는 다른 여행 열기를 실행한다](evidence/traveler-review/negative-78/06.json) · [화면](evidence/traveler-review/negative-78/06.png) |
| 7 | 통과 | 3 | [저장 공간 부족: 저장소 용량 초과·쓰기 실패를 재현한다](evidence/traveler-review/negative-78/07.json) · [화면](evidence/traveler-review/negative-78/07.png) |
| 8 | 통과 | 2 | [다중 탭 충돌: 두 탭에서 같은 여행을 각각 삭제·수정하고 저장한다](evidence/traveler-review/negative-78/08.json) · [화면](evidence/traveler-review/negative-78/08.png) |
| 9 | 통과 | 4 | [이동·삭제·되돌리기 혼합: 이동 직후 삭제·되돌리기를 실행하고 날짜 필터·여행도 전환한다](evidence/traveler-review/negative-78/09.json) · [화면](evidence/traveler-review/negative-78/09.png) |
| 10 | 통과 | 5 | [악성·손상 입력: HTML·스크립트 문자열, 매우 긴 메모, 잘못된 좌표, 손상 파일·저장 데이터를 넣는다](evidence/traveler-review/negative-78/10.json) · [화면](evidence/traveler-review/negative-78/10.png) |
| 11 | 통과 | 2 | [여행 이름에 공백·줄바꿈만 입력한다](evidence/traveler-review/negative-78/11.json) · [화면](evidence/traveler-review/negative-78/11.png) |
| 12 | 통과 | 2 | [같은 이름의 여행을 여러 개 만든다](evidence/traveler-review/negative-78/12.json) · [화면](evidence/traveler-review/negative-78/12.png) |
| 13 | 통과 | 8 | [여행 일수를 0·음수·소수·매우 큰 값으로 조작한다](evidence/traveler-review/negative-78/13.json) · [화면](evidence/traveler-review/negative-78/13.png) |
| 14 | 통과 | 3 | [출발일을 연말·월말·윤년 2월 말로 설정한다](evidence/traveler-review/negative-78/14.json) · [화면](evidence/traveler-review/negative-78/14.png) |
| 15 | 통과 | 3 | [여행 생성 후 기기 시간대를 바꾼다](evidence/traveler-review/negative-78/15.json) · [화면](evidence/traveler-review/negative-78/15.png) |
| 16 | 통과 | 1 | [여행 기간 밖의 날짜에 장소를 배치한다](evidence/traveler-review/negative-78/16.json) · [화면](evidence/traveler-review/negative-78/16.png) |
| 17 | 통과 | 1 | [11/1, 11월 1일, 2026-11-01을 섞어 입력한다](evidence/traveler-review/negative-78/17.json) · [화면](evidence/traveler-review/negative-78/17.png) |
| 18 | 통과 | 2 | [종료 시간이 시작 시간보다 빠르게 입력한다](evidence/traveler-review/negative-78/18.json) · [화면](evidence/traveler-review/negative-78/18.png) |
| 19 | 통과 | 5 | [24:00, 25:30, 오전 12시, 시간 미정을 입력한다](evidence/traveler-review/negative-78/19.json) · [화면](evidence/traveler-review/negative-78/19.png) |
| 20 | 통과 | 1 | [날짜의 마지막 장소를 다른 날로 옮긴다](evidence/traveler-review/negative-78/20.json) · [화면](evidence/traveler-review/negative-78/20.png) |
| 21 | 통과 | 1 | [도시 없이 흔한 상호명을 검색한다](evidence/traveler-review/negative-78/21.json) · [화면](evidence/traveler-review/negative-78/21.png) |
| 22 | 통과 | 1 | [검색 직전·직후 입력값을 바꾼다](evidence/traveler-review/negative-78/22.json) · [화면](evidence/traveler-review/negative-78/22.png) |
| 23 | 통과 | 1 | [결과 0건이 나온 뒤 이전 결과의 선택 버튼을 조작한다](evidence/traveler-review/negative-78/23.json) · [화면](evidence/traveler-review/negative-78/23.png) |
| 24 | 통과 | 1 | [결과 수가 많고 이름·주소가 매우 긴 데이터를 표시한다](evidence/traveler-review/negative-78/24.json) · [화면](evidence/traveler-review/negative-78/24.png) |
| 25 | 통과 | 1 | [동일 Place ID의 장소를 한국어·영어·일본어 이름으로 보관한다](evidence/traveler-review/negative-78/25.json) · [화면](evidence/traveler-review/negative-78/25.png) |
| 26 | 통과 | 1 | [이름은 같지만 Place ID·주소가 다른 지점을 보관한다](evidence/traveler-review/negative-78/26.json) · [화면](evidence/traveler-review/negative-78/26.png) |
| 27 | 통과 | 1 | [개인 메모가 있는 장소를 검색 결과에서 다시 보관한다](evidence/traveler-review/negative-78/27.json) · [화면](evidence/traveler-review/negative-78/27.png) |
| 28 | 통과 | 1 | [사진 없음과 사진 요청 실패를 각각 재현한다](evidence/traveler-review/negative-78/28.json) · [화면](evidence/traveler-review/negative-78/28.png) |
| 29 | 통과 | 2 | [대표 사진과 모든 대체 사진을 실패시킨다](evidence/traveler-review/negative-78/29.json) · [화면](evidence/traveler-review/negative-78/29.png) |
| 30 | 통과 | 1 | [보관 후 폐업·이전·이름 변경된 장소를 일정에 넣는 상황을 재현한다](evidence/traveler-review/negative-78/30.json) · [화면](evidence/traveler-review/negative-78/30.png) |
| 31 | 통과 | 2 | [보관함 메모를 입력하자마자 탭 전환·새로고침한다](evidence/traveler-review/negative-78/31.json) · [화면](evidence/traveler-review/negative-78/31.png) |
| 32 | 통과 | 1 | [여러 날짜에 배치된 장소를 보관함에서 삭제한다](evidence/traveler-review/negative-78/32.json) · [화면](evidence/traveler-review/negative-78/32.png) |
| 33 | 통과 | 1 | [수정 패널에서 저장하지 않은 상태로 다른 일정의 수정 버튼을 누른다](evidence/traveler-review/negative-78/33.json) · [화면](evidence/traveler-review/negative-78/33.png) |
| 34 | 통과 | 1 | [교체 후보를 선택한 뒤 장소명을 직접 바꾼다](evidence/traveler-review/negative-78/34.json) · [화면](evidence/traveler-review/negative-78/34.png) |
| 35 | 통과 | 2 | [시간·메모만 수정한다](evidence/traveler-review/negative-78/35.json) · [화면](evidence/traveler-review/negative-78/35.png) |
| 36 | 통과 | 2 | [시간을 유지한 채 다른 날짜로 이동한다](evidence/traveler-review/negative-78/36.json) · [화면](evidence/traveler-review/negative-78/36.png) |
| 37 | 통과 | 1 | [같은 장소를 하루 두 번 또는 여러 날 배치한 뒤 하나만 수정한다](evidence/traveler-review/negative-78/37.json) · [화면](evidence/traveler-review/negative-78/37.png) |
| 38 | 통과 | 1 | [필터가 적용된 목록에서 순서를 바꾼다](evidence/traveler-review/negative-78/38.json) · [화면](evidence/traveler-review/negative-78/38.png) |
| 39 | 통과 | 3 | [선택한 장소를 삭제한 뒤 수정·이동을 시도한다](evidence/traveler-review/negative-78/39.json) · [화면](evidence/traveler-review/negative-78/39.png) |
| 40 | 검증 불가 | 3 | [드래그 중 Escape 또는 창 밖 드롭으로 취소한다](evidence/traveler-review/negative-78/40.json) · [화면](evidence/traveler-review/negative-78/40.png) |
| 41 | 통과 | 1 | [장소를 자기 자신 위에 드롭한다](evidence/traveler-review/negative-78/41.json) · [화면](evidence/traveler-review/negative-78/41.png) |
| 42 | 통과 | 1 | [드래그 중 날짜 필터나 목록을 바꾼다](evidence/traveler-review/negative-78/42.json) · [화면](evidence/traveler-review/negative-78/42.png) |
| 43 | 통과 | 1 | [삭제 후 새 장소를 추가한 다음 이전 삭제를 되돌린다](evidence/traveler-review/negative-78/43.json) · [화면](evidence/traveler-review/negative-78/43.png) |
| 44 | 통과 | 1 | [되돌리기를 연속 클릭한다](evidence/traveler-review/negative-78/44.json) · [화면](evidence/traveler-review/negative-78/44.png) |
| 45 | 통과 | 1 | [되돌리기 알림이 있는 동안 다른 알림을 발생시킨다](evidence/traveler-review/negative-78/45.json) · [화면](evidence/traveler-review/negative-78/45.png) |
| 46 | 통과 | 2 | [삭제 확인창에서 취소·닫기를 실행한다](evidence/traveler-review/negative-78/46.json) · [화면](evidence/traveler-review/negative-78/46.png) |
| 47 | 통과 | 1 | [지도 초기화를 지연시킨 상태에서 저장한 여행을 연다](evidence/traveler-review/negative-78/47.json) · [화면](evidence/traveler-review/negative-78/47.png) |
| 48 | 통과 | 1 | [지도 초기화 중 다른 여행으로 전환한다](evidence/traveler-review/negative-78/48.json) · [화면](evidence/traveler-review/negative-78/48.png) |
| 49 | 통과 | 3 | [날짜 필터를 빠르게 반복 변경한다](evidence/traveler-review/negative-78/49.json) · [화면](evidence/traveler-review/negative-78/49.png) |
| 50 | 검증 불가 | 3 | [지도 핀 이동 후 취소·되돌리기를 실행한다](evidence/traveler-review/negative-78/50.json) · [화면](evidence/traveler-review/negative-78/50.png) |
| 51 | 통과 | 2 | [경로 계산 중 장소를 이동·삭제한다](evidence/traveler-review/negative-78/51.json) · [화면](evidence/traveler-review/negative-78/51.png) |
| 52 | 통과 | 2 | [동일 좌표 또는 매우 가까운 장소를 연속 배치한다](evidence/traveler-review/negative-78/52.json) · [화면](evidence/traveler-review/negative-78/52.png) |
| 53 | 통과 | 7 | [섬·국경·장거리 구간을 도보·대중교통으로 요청한다](evidence/traveler-review/negative-78/53.json) · [화면](evidence/traveler-review/negative-78/53.png) |
| 54 | 통과 | 1 | [일부 구간만 경로 조회에 성공시킨다](evidence/traveler-review/negative-78/54.json) · [화면](evidence/traveler-review/negative-78/54.png) |
| 55 | 통과 | 4 | [쿼터 초과·결제 중단 응답을 재현한다](evidence/traveler-review/negative-78/55.json) · [화면](evidence/traveler-review/negative-78/55.png) |
| 56 | 통과 | 1 | [장소 선택·날짜 탭 전환을 빠르게 반복한다](evidence/traveler-review/negative-78/56.json) · [화면](evidence/traveler-review/negative-78/56.png) |
| 57 | 통과 | 2 | [현재 열려 있는 여행의 저장본을 삭제한다](evidence/traveler-review/negative-78/57.json) · [화면](evidence/traveler-review/negative-78/57.png) |
| 58 | 통과 | 3 | [일부만 유효한 여행 데이터를 복원한다](evidence/traveler-review/negative-78/58.json) · [화면](evidence/traveler-review/negative-78/58.png) |
| 59 | 검증 불가 | 2 | [이전 저장 형식의 여행을 새 버전에서 연다](evidence/traveler-review/negative-78/59.json) · [화면](evidence/traveler-review/negative-78/59.png) |
| 60 | 통과 | 8 | [저장 데이터의 여행 ID·수정 시각·배열·필드 타입을 변조한다](evidence/traveler-review/negative-78/60.json) · [화면](evidence/traveler-review/negative-78/60.png) |
| 61 | 통과 | 2 | [확장자만 .xlsx인 다른 형식 파일을 가져온다](evidence/traveler-review/negative-78/61.json) · [화면](evidence/traveler-review/negative-78/61.png) |
| 62 | 통과 | 4 | [빈 파일·빈 시트·헤더만 있는 파일을 가져온다](evidence/traveler-review/negative-78/62.json) · [화면](evidence/traveler-review/negative-78/62.png) |
| 63 | 통과 | 3 | [병합 날짜·숨겨진 행·여러 시트가 있는 파일을 가져온다](evidence/traveler-review/negative-78/63.json) · [화면](evidence/traveler-review/negative-78/63.png) |
| 64 | 통과 | 1 | [장소·날짜 열을 동일하거나 잘못된 열로 연결한다](evidence/traveler-review/negative-78/64.json) · [화면](evidence/traveler-review/negative-78/64.png) |
| 65 | 통과 | 3 | [내보낸 파일을 다시 가져온다](evidence/traveler-review/negative-78/65.json) · [화면](evidence/traveler-review/negative-78/65.png) |
| 66 | 통과 | 2 | [=, +, @, - 등으로 시작하는 외부 문자열을 엑셀·CSV로 내보낸다](evidence/traveler-review/negative-78/66.json) · [화면](evidence/traveler-review/negative-78/66.png) |
| 67 | 검증 불가 | 2 | [특수문자·HTML·위험한 URL을 포함한 장소를 KML로 내보낸다](evidence/traveler-review/negative-78/67.json) · [화면](evidence/traveler-review/negative-78/67.png) |
| 68 | 통과 | 2 | [모바일에서 다운로드를 취소하거나 차단한다](evidence/traveler-review/negative-78/68.json) · [화면](evidence/traveler-review/negative-78/68.png) |
| 69 | 검증 불가 | 2 | [모바일 키보드를 연 상태로 장소·메모를 수정한다](evidence/traveler-review/negative-78/69.json) · [화면](evidence/traveler-review/negative-78/69.png) |
| 70 | 통과 | 4 | [입력 중 화면 회전·창 크기 변경을 실행한다](evidence/traveler-review/negative-78/70.json) · [화면](evidence/traveler-review/negative-78/70.png) |
| 71 | 검증 불가 | 1 | [지도 위에서 페이지 스크롤을 시도한다](evidence/traveler-review/negative-78/71.json) · [화면](evidence/traveler-review/negative-78/71.png) |
| 72 | 검증 불가 | 2 | [텍스트를 200% 확대하고 긴 한국어 이름을 표시한다](evidence/traveler-review/negative-78/72.json) · [화면](evidence/traveler-review/negative-78/72.png) |
| 73 | 통과 | 1 | [키보드만으로 장소 배치·날짜 이동·순서 변경을 수행한다](evidence/traveler-review/negative-78/73.json) · [화면](evidence/traveler-review/negative-78/73.png) |
| 74 | 통과 | 2 | [모달에서 Tab·Shift+Tab·Escape를 반복한다](evidence/traveler-review/negative-78/74.json) · [화면](evidence/traveler-review/negative-78/74.png) |
| 75 | 검증 불가 | 4 | [스크린리더로 검색 결과·저장 실패·되돌리기를 확인한다](evidence/traveler-review/negative-78/75.json) · [화면](evidence/traveler-review/negative-78/75.png) |
| 76 | 통과 | 4 | [공용 기기 상황에서 여행·키를 저장한 뒤 다음 사용자가 접속한다](evidence/traveler-review/negative-78/76.json) · [화면](evidence/traveler-review/negative-78/76.png) |
| 77 | 통과 | 8 | [외부 링크에 javascript:, data: 및 조작된 주소를 넣는다](evidence/traveler-review/negative-78/77.json) · [화면](evidence/traveler-review/negative-78/77.png) |
| 78 | 통과 | 4 | [패널을 반복해서 열고 닫은 뒤 뒤쪽 지도·버튼을 조작한다](evidence/traveler-review/negative-78/78.json) · [화면](evidence/traveler-review/negative-78/78.png) |

## 아직 실행하지 못한 조건

- 40: OS 창 밖 네이티브 드롭 — 브라우저 DOM 밖 OS 드롭은 이 headless 환경에서 미실행. 합성 dragstart/dragend와 body 드롭만 실행
- 50: 실제 핀 드래그/복원 — 모의 콜백만 실행. 핀 이동 자체의 취소/undo UI가 없어 복원 하위 케이스는 해당 없음
- 59: 다른 이전 형식 호환 — 과거 버전 fixture/형식 명세가 없어 별도 이전 schema는 검증 불가
- 67: Google Earth 등 소비자의 description/URL 해석 — 외부 KML 소비자 실행은 하지 않음
- 69: 실기기 소프트 키보드/오류 영역 — 실기기 및 OS 소프트 키보드 없음
- 71: 실제 지도 제스처 — 실제 Google API 키와 지도 DOM이 없으므로 지도 대역으로 제스처 통과를 주장하지 않음
- 72: 브라우저 실제 텍스트 확대 200% — CSS 계산 글꼴 2배 대체 검사이며 브라우저 텍스트 확대 설정 자체는 미실행
- 75: 실제 스크린리더 발화 — 스크린리더 없음. 접근성 트리/속성 검사와 실제 발화는 구분
