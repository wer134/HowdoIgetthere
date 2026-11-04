# 일정 화면 상태와 반복 방문 수정

## 원인과 변경

저장한 여행을 열 때 보드의 기본 선택은 `일정 정리`였지만, 전체 페이지 배치를 바꾸는 콜백이 실행되지 않았다. 그 결과 지도용 왼쪽 패널에 여러 날짜가 들어갔다. 새 5일·40개 장소 여행으로 재현한 수정 전 측정값은 1920px 화면에서 날짜 열 66px, 카드 40px이었다. 사용자의 실제 여행 데이터는 사용하지 않았다.

`js/workspace.js`에서 유효한 여행을 처음 그릴 때 선택 모드를 화면 전체에 적용한다. 콜백이 다시 렌더링하더라도 재귀하지 않도록 적용 상태를 먼저 기록한다. 여행을 비우면 적용 상태를 초기화한다. 엑셀 가져오기는 파싱과 기존 여행 저장에 성공한 뒤, 새 시트를 그리기 전에 `지도·목록`을 선택한다. `일정 정리` 전환 시 기존 전체 너비 보드를 사용한다. 보드 CSS 폭을 임시로 늘리거나 저장 형식을 변경하지 않는다. 수정 전 재현은 저장 여행 계속하기에서 확인했으며, 모든 새 XLSX 가져오기가 항상 잘못된 모드로 끝났다고 단정하지 않는다.

일정 편집기의 장소 검색은 다른 방문에 쓰인 장소를 비활성화하고 있었다. 동일 장소를 다시 선택할 수 있게 바꾸며, 장소 ID가 모두 있을 때는 서로 다른 ID를 근접 좌표만으로 같은 장소라고 판단하지 않는다. 각 방문은 기존의 별도 행, 시간, 메모, 날짜 및 장소 매핑을 사용한다.

작은 화면의 반복 방문 안내는 설명 아래 줄로 배치한다. 한국어 설명과 알림 메시지는 단어 단위로 줄바꿈하고, `되돌리기` 버튼은 한 줄을 유지한다. 이는 독립 화면 검토에서 발견된 좁은 결과 카드와 기존 알림의 글자 분리를 보완한 것이다.

## 새 검증

이번 수정에서 실행한 결과만 아래에 기록한다. 과거 검증 결과를 재사용하지 않는다. 상세 결과는 [증거 폴더](evidence/repeated-places-layout/)와 각 브라우저 스크립트에 저장한다.

최종 검증한 제품 코드: `c4a2f2540fdea0b6fc76a999c3b699d1f33007b6`, 공개 자산 버전 `6f8479cb352129e4`. 이후 문서·증거 커밋은 제품 코드를 변경하지 않는다. [소스 해시 기록](evidence/repeated-places-layout/verification/provenance.json)으로 검사 대상을 확인할 수 있다. `board/source/` 및 `repeated/` 루트의 RED/GREEN 증거는 앞선 단계 기록이며, 최종 결과는 각 `production/` 폴더를 기준으로 한다.

| 검사 | 새 결과 | 근거 |
|---|---|---|
| 단위·API·동시성 | 124/124 통과 | [실행 로그](evidence/repeated-places-layout/verification/unit-tests.txt) |
| 빌드·출시 검사 | 통과, 공개 산출물 46개 | [빌드](evidence/repeated-places-layout/verification/build.txt), [출시 검사](evidence/repeated-places-layout/verification/release.txt) |
| 화면 모드 | 18개 검사 통과, 1920/1440/1280/768/390px | [production 결과](evidence/repeated-places-layout/board/production/results.json) |
| 반복 방문 | 8개 시나리오 각각 1440/390px 통과 | [production 결과](evidence/repeated-places-layout/repeated/production/production-results.json) |
| 기존 보드 | 12개 검사 및 6개 화면 크기 통과 | [결과](evidence/repeated-places-layout/regression-board/results.json) |
| 계정 흐름 | 11개 흐름 통과, 실제 로컬 HTTP/SQLite와 제공업체 모의 | [결과](evidence/repeated-places-layout/regression-account/results.json) |
| 독립 화면 검토 | A/B 모두 PASS, 동일 최종 코드의 새 캡처 18개 전체 직접 검토 | [구현·동작](evidence/repeated-places-layout/verification/visual-integrity.md), [시각·한국어](evidence/repeated-places-layout/verification/visual-cjk.md) |

화면 모드 검사는 저장한 여행 계속하기·목록에서 열기, 실제 XLSX 가져오기와 전체 40행 유지, 가져오기 실패 시 원래 여행 보존, 지도/보드 전환, 실제 다운로드 JSON을 같은 탭에 복원, 새 여행, 모의 계정 열기와 로그아웃 후 재진입을 포함한다. 수정 전 날짜 열 66px·카드 40px는 수정 후 1920px에서 약 483px·457px가 됐다.

반복 방문 검사는 A→B→A, 다른 날짜에 A 추가, 15m 이내의 서로 다른 장소 ID, 방문별 시간·메모 수정과 날짜 이동·삭제, 새로고침, 별도 브라우저 컨텍스트에서 백업 복원을 포함한다. 지도 모의 모듈에서 마커 키 `0/1/2`, 경로 키 `0>1/1>2`도 확인했다. 실제 Google 지도에서 겹치는 핀의 가시성을 검사한 결과는 아니다.

재실행 명령은 아래와 같다. Windows Git Bash에서 실행한다.

```sh
npm test
npm run build
npm run check:release
WORKSPACE_OUT=docs/testing/evidence/repeated-places-layout/board/production node tests/browser/workspace-layout.cjs
BOARD_ASSET_ROOT=dist REPEATED_PHASE=production REPEATED_OUT=docs/testing/evidence/repeated-places-layout/repeated/production node tests/browser/repeated-places.cjs
WORKSPACE_OUT=docs/testing/evidence/repeated-places-layout/regression-board node tests/browser/workspace-board.cjs
ACCOUNT_OUT=docs/testing/evidence/repeated-places-layout/regression-account node tests/browser/account-workspace.cjs
```

JavaScript 문법 검사는 변경 소스와 새 브라우저 스크립트에서 통과했다. TypeScript/Biome LSP는 설치되지 않았고 이전 사용자의 설치 거절 설정이 있어 실행하지 않았다.

기존 보드 검사를 병렬 실행할 때 새 여행 생성 완료 전에 이전 카드 수를 읽는 실패가 한 번 발생했다. [실패 로그](evidence/repeated-places-layout/verification/board-readiness-failure.txt)를 보존하고, 생성 dialog가 닫히고 새 여행 제목이 표시될 때까지 기다린 뒤 원래의 빈 카드·기존 여행 보존 검사를 수행하도록 수정했다. 최종 빌드에서 재실행해 통과했다. 되돌리기 문구는 실제 텍스트 사각형이 2줄인 [RED](evidence/repeated-places-layout/verification/undo-label-red.txt)를 확인한 뒤, 한 줄인지 검사하도록 회귀를 추가했다.

## 검증 경계

브라우저 검증은 새 컨텍스트와 테스트 여행을 사용한다. 지도/장소 제공업체를 모의한 검사는 실제 Google API 검증이 아니다. 실제 사용자의 엑셀 원본, 실기기, Safari/Firefox는 이 수정에서 검사하지 않는다. 동일 좌표의 지도 핀은 겹쳐 보일 수 있지만 일정 항목은 방문마다 구분한다.
