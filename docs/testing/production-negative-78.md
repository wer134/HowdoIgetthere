# 운영 빌드: 78개 부정 테스트 최종 결과

2026-10-31, 코드 `bee8a32`, 산출물 `c56afc3437629eed`. **70 통과·0 결함 확인·8 검증 불가**. 항목별 격리 Chromium BrowserContext·테스트 여행을 사용했다. 아래 78개는 실제 UI/저장 및 **모의 Google SDK/지도** 검사다. 실제 API 검사는 [종합 보고서](production-remediation.md)에 따로 기록했다.

최초 실행에서 발견한 29·62번을 수정한 뒤 모든 항목을 다시 실행했다. 각 JSON은 세부 판정, 실제 관측값, 재현 절차, 오류와 모의 호출 기록을 포함한다. 검증 불가의 부분 검사가 성공했더라도 항목 전체를 통과로 표시하지 않았다.

| 번호 | 판정 | 실행 절차 | 근거 |
|---|---|---|---|
| 1 | 통과 | 기존 검색 결과 확보 → 지연 검색 중 오프라인 전환 → 복구 및 재검색 | [관측 JSON](evidence/production-final/negative-78/01.json) · [화면](evidence/production-final/negative-78/01.png) |
| 2 | 통과 | 여행 생성·일정 추가·적용·검색에 동기 연속 submit 및 Enter+click 실행 | [관측 JSON](evidence/production-final/negative-78/02.json) · [화면](evidence/production-final/negative-78/02.png) |
| 3 | 통과 | 수정 중 새로고침/탭 종료/뒤로가기, 드래그 확정 직후 새로고침 | [관측 JSON](evidence/production-final/negative-78/03.json) · [화면](evidence/production-final/negative-78/03.png) |
| 4 | 통과 | 잘못된 키·리퍼러 제한·API 비활성화 모의 거부와 0결과를 비교; 로컬 편집 | [관측 JSON](evidence/production-final/negative-78/04.json) · [화면](evidence/production-final/negative-78/04.png) |
| 5 | 통과 | 지도 인증 실패 콜백 후 로컬 편집; 키 제거로 reload → 초안 손실 확인 | [관측 JSON](evidence/production-final/negative-78/05.json) · [화면](evidence/production-final/negative-78/05.png) |
| 6 | 통과 | A 지연·B 빠른 검색 응답 역전; 검색 중 여행 전환 | [관측 JSON](evidence/production-final/negative-78/06.json) · [화면](evidence/production-final/negative-78/06.png) |
| 7 | 통과 | 정상 저장본 확보 → Storage.setItem에 QuotaExceededError/일반 쓰기 오류 주입 → 일정 수정 → 저장 상태·원본 비교 | [관측 JSON](evidence/production-final/negative-78/07.json) · [화면](evidence/production-final/negative-78/07.png) |
| 8 | 통과 | 동일 BrowserContext의 두 탭에서 A 열기 → 1탭 수정, 2탭 수정/삭제 → 저장소 비교 | [관측 JSON](evidence/production-final/negative-78/08.json) · [화면](evidence/production-final/negative-78/08.png) |
| 9 | 통과 | 첫 장소 이동 → 삭제 → 되돌리기 → 날짜 필터 → B/A 여행 전환 → 데이터·모의 핀 확인 | [관측 JSON](evidence/production-final/negative-78/09.json) · [화면](evidence/production-final/negative-78/09.png) |
| 10 | 통과 | HTML 이벤트 문자열·100k 메모 저장, 잘못된 좌표, 손상 파일/저장 데이터 별도 검사 | [관측 JSON](evidence/production-final/negative-78/10.json) · [화면](evidence/production-final/negative-78/10.png) |
| 11 | 통과 | 새 여행 이름 공백·줄바꿈만 제출 | [관측 JSON](evidence/production-final/negative-78/11.json) · [화면](evidence/production-final/negative-78/11.png) |
| 12 | 통과 | 같은 이름 여행 두 개 생성 → 저장 목록 구분·별도 ID 확인 | [관측 JSON](evidence/production-final/negative-78/12.json) · [화면](evidence/production-final/negative-78/12.png) |
| 13 | 통과 | 0·-1·1.5·1000일 HTML 제출과 submit 이벤트 직접 호출로 처리 단계 검증 | [관측 JSON](evidence/production-final/negative-78/13.json) · [화면](evidence/production-final/negative-78/13.png) |
| 14 | 통과 | 연말·월말·윤년 출발일로 3일 생성 후 날짜 배열 비교 | [관측 JSON](evidence/production-final/negative-78/14.json) · [화면](evidence/production-final/negative-78/14.png) |
| 15 | 통과 | CDP 시간대를 서울→LA→키리티마티로 변경 후 여행 열기 | [관측 JSON](evidence/production-final/negative-78/15.json) · [화면](evidence/production-final/negative-78/15.png) |
| 16 | 통과 | 첫 장소를 기간 밖 2027-01-01에 배치 후 화면/저장 날짜 확인 | [관측 JSON](evidence/production-final/negative-78/16.json) · [화면](evidence/production-final/negative-78/16.png) |
| 17 | 통과 | 11/1·11월 1일·2026-11-01 일정 입력 → 그룹/모호성 안내 | [관측 JSON](evidence/production-final/negative-78/17.json) · [화면](evidence/production-final/negative-78/17.png) |
| 18 | 통과 | 종료<시작(13:00–12:00), 자정 넘김(23:00–01:00) 입력 → 구분 안내 | [관측 JSON](evidence/production-final/negative-78/18.json) · [화면](evidence/production-final/negative-78/18.png) |
| 19 | 통과 | 24:00·25:30·오전 12시·시간 미정 입력, 실제 시간 파서 결과와 UI 경고 확인 | [관측 JSON](evidence/production-final/negative-78/19.json) · [화면](evidence/production-final/negative-78/19.png) |
| 20 | 통과 | 날짜의 마지막 장소 다른 날 이동 → 원래 빈 날짜에 다시 추가 | [관측 JSON](evidence/production-final/negative-78/20.json) · [화면](evidence/production-final/negative-78/20.png) |
| 21 | 통과 | 도시 없는 동명 상호의 서로 다른 국가·도시 응답 표시 | [관측 JSON](evidence/production-final/negative-78/21.json) · [화면](evidence/production-final/negative-78/21.png) |
| 22 | 통과 | 검색 시작 직전/요청 중 검색어 변경 → 결과 검색어 표기 | [관측 JSON](evidence/production-final/negative-78/22.json) · [화면](evidence/production-final/negative-78/22.png) |
| 23 | 통과 | 이전 검색 버튼의 DOM 참조 보관 → 0결과 검색 → 이전 버튼 클릭 | [관측 JSON](evidence/production-final/negative-78/23.json) · [화면](evidence/production-final/negative-78/23.png) |
| 24 | 통과 | 모바일 390px에서 긴 한글 이름/주소 30개 모의 결과 표시 → 버튼 경계·가로 스크롤 확인 | [관측 JSON](evidence/production-final/negative-78/24.json) · [화면](evidence/production-final/negative-78/24.png) |
| 25 | 통과 | 동일 Place ID의 한·영·일 이름 검색 후 보관 | [관측 JSON](evidence/production-final/negative-78/25.json) · [화면](evidence/production-final/negative-78/25.png) |
| 26 | 통과 | 동명 다른 Place ID/주소 두 지점 검색·보관 | [관측 JSON](evidence/production-final/negative-78/26.json) · [화면](evidence/production-final/negative-78/26.png) |
| 27 | 통과 | 보관함 메모 저장 → 같은 ID의 빈 메모 결과 다시 보관 | [관측 JSON](evidence/production-final/negative-78/27.json) · [화면](evidence/production-final/negative-78/27.png) |
| 28 | 통과 | 사진 없음/요청 실패를 독립 ID로 주입 → 상세 패널 안내 비교 | [관측 JSON](evidence/production-final/negative-78/28.json) · [화면](evidence/production-final/negative-78/28.png) |
| 29 | 통과 | 대표+대체 3개 사진 URL 모두 404 → 실패 상태 및 요청 수 측정 | [관측 JSON](evidence/production-final/negative-78/29.json) · [화면](evidence/production-final/negative-78/29.png) |
| 30 | 통과 | 폐업/이전/이름변경 모의 상세를 가진 오래된 보관 장소를 일정에 배치 | [관측 JSON](evidence/production-final/negative-78/30.json) · [화면](evidence/production-final/negative-78/30.png) |
| 31 | 통과 | 보관함 메모 입력 직후 탭 전환/blur 없는 새로고침 | [관측 JSON](evidence/production-final/negative-78/31.json) · [화면](evidence/production-final/negative-78/31.png) |
| 32 | 통과 | 같은 보관 장소 두 날짜에 배치 → 보관함에서만 삭제 | [관측 JSON](evidence/production-final/negative-78/32.json) · [화면](evidence/production-final/negative-78/32.png) |
| 33 | 통과 | 첫 일정 수정 초안 입력 후 둘째 일정 수정 버튼 선택 | [관측 JSON](evidence/production-final/negative-78/33.json) · [화면](evidence/production-final/negative-78/33.png) |
| 34 | 통과 | 교체 후보 선택 → 직접 다른 이름 입력 → 저장 후 이전 후보 좌표 혼합 여부 | [관측 JSON](evidence/production-final/negative-78/34.json) · [화면](evidence/production-final/negative-78/34.png) |
| 35 | 통과 | 시간·메모만 편집 → 검색 호출수/좌표 비교 | [관측 JSON](evidence/production-final/negative-78/35.json) · [화면](evidence/production-final/negative-78/35.png) |
| 36 | 통과 | 같은 시간의 두 일정 중 하나 다른 날짜로 이동 → 충돌 안내 | [관측 JSON](evidence/production-final/negative-78/36.json) · [화면](evidence/production-final/negative-78/36.png) |
| 37 | 통과 | 같은 장소 하루 2회+다른 날 배치 → 한 방문 메모만 수정 | [관측 JSON](evidence/production-final/negative-78/37.json) · [화면](evidence/production-final/negative-78/37.png) |
| 38 | 통과 | 이름 검색 필터 적용 → 이동 모달의 숨은 항목 기준 앞 위치 선택 | [관측 JSON](evidence/production-final/negative-78/38.json) · [화면](evidence/production-final/negative-78/38.png) |
| 39 | 통과 | 선택 일정 삭제 → 패널/이웃 대상 확인 | [관측 JSON](evidence/production-final/negative-78/39.json) · [화면](evidence/production-final/negative-78/39.png) |
| 40 | 검증 불가 | 드래그 시작 → Escape/목록 밖 드롭 → 원본 비교 | [관측 JSON](evidence/production-final/negative-78/40.json) · [화면](evidence/production-final/negative-78/40.png) |
| 41 | 통과 | 행 자기 자신 위 합성 드래그/드롭 → records·updated·요청수 비교 | [관측 JSON](evidence/production-final/negative-78/41.json) · [화면](evidence/production-final/negative-78/41.png) |
| 42 | 통과 | 드래그 시작 → 다른 날짜 필터 → 현재 대상 위 드롭 → 적용 | [관측 JSON](evidence/production-final/negative-78/42.json) · [화면](evidence/production-final/negative-78/42.png) |
| 43 | 통과 | 삭제 → 새 장소 추가 → 이전 삭제 취소 기회와 후속 데이터 확인 | [관측 JSON](evidence/production-final/negative-78/43.json) · [화면](evidence/production-final/negative-78/43.png) |
| 44 | 통과 | 삭제 후 되돌리기 연속 클릭 | [관측 JSON](evidence/production-final/negative-78/44.json) · [화면](evidence/production-final/negative-78/44.png) |
| 45 | 통과 | 삭제 undo 알림 중 일반 엑셀 내보내기 알림 발생 | [관측 JSON](evidence/production-final/negative-78/45.json) · [화면](evidence/production-final/negative-78/45.png) |
| 46 | 통과 | 삭제 확인 취소·Escape 닫기 → records/updated 비교 | [관측 JSON](evidence/production-final/negative-78/46.json) · [화면](evidence/production-final/negative-78/46.png) |
| 47 | 통과 | 지도 로더 지연 중 저장 여행 열기 → 준비 후 현재 핀 기록 | [관측 JSON](evidence/production-final/negative-78/47.json) · [화면](evidence/production-final/negative-78/47.png) |
| 48 | 통과 | 초기 지도 로딩 600ms 지연 → A 열기 → B 전환 → 지도 준비 | [관측 JSON](evidence/production-final/negative-78/48.json) · [화면](evidence/production-final/negative-78/48.png) |
| 49 | 통과 | 날짜 필터 10회 반복·보관함 전환 → 모의 핀 가시성 기록 | [관측 JSON](evidence/production-final/negative-78/49.json) · [화면](evidence/production-final/negative-78/49.png) |
| 50 | 검증 불가 | 모의 지도 onMove 콜백 → 좌표 변경 후 undo 및 취소 제공 확인 | [관측 JSON](evidence/production-final/negative-78/50.json) · [화면](evidence/production-final/negative-78/50.png) |
| 51 | 통과 | 경로 응답 지연 → 일정 삭제 → 응답 도착 후 모의 선의 대상 비교 | [관측 JSON](evidence/production-final/negative-78/51.json) · [화면](evidence/production-final/negative-78/51.png) |
| 52 | 통과 | 동일 좌표/1m 근접 좌표 두 방문을 각각 복원 → 경로/요청/NaN 확인 | [관측 JSON](evidence/production-final/negative-78/52.json) · [화면](evidence/production-final/negative-78/52.png) |
| 53 | 통과 | 섬·국경·장거리 모의 무경로 응답 → 시간 표시 | [관측 JSON](evidence/production-final/negative-78/53.json) · [화면](evidence/production-final/negative-78/53.png) |
| 54 | 통과 | 같은 날짜 3지점의 경로 중 하나 성공·하나 실패 모의 응답 | [관측 JSON](evidence/production-final/negative-78/54.json) · [화면](evidence/production-final/negative-78/54.png) |
| 55 | 통과 | 쿼터 초과·결제 중단 모의 응답 → 실제 retry 횟수/안내 확인 | [관측 JSON](evidence/production-final/negative-78/55.json) · [화면](evidence/production-final/negative-78/55.png) |
| 56 | 통과 | 동일 장소 선택 10회·날짜 왕복 → SDK 사진/상세 호출 집계 | [관측 JSON](evidence/production-final/negative-78/56.json) · [화면](evidence/production-final/negative-78/56.png) |
| 57 | 통과 | 현재 여행 저장본 삭제 확인 → 열린 여행 수정 → 자동 저장 → 새로고침 | [관측 JSON](evidence/production-final/negative-78/57.json) · [화면](evidence/production-final/negative-78/57.png) |
| 58 | 통과 | 정상 여행 옆에 records가 null인 손상 여행 주입 → 손상 여행 열기 → 정상 저장본/오류 안내 확인 | [관측 JSON](evidence/production-final/negative-78/58.json) · [화면](evidence/production-final/negative-78/58.png) |
| 59 | 검증 불가 | 버전 필드 없는 현재 v1 snapshot을 열고 원본 보존 확인; 별도 과거 schema는 제공되지 않음 | [관측 JSON](evidence/production-final/negative-78/59.json) · [화면](evidence/production-final/negative-78/59.png) |
| 60 | 통과 | 저장 여행 id를 다른 여행 ID로 변조 → 열어 편집; updated/records/library 타입 변조는 별도 페이지로 검사 | [관측 JSON](evidence/production-final/negative-78/60.json) · [화면](evidence/production-final/negative-78/60.png) |
| 61 | 통과 | ZIP 헤더 손상 파일·일반 텍스트의 확장자만 .xlsx로 업로드 → 현재 여행 보존 | [관측 JSON](evidence/production-final/negative-78/61.json) · [화면](evidence/production-final/negative-78/61.png) |
| 62 | 통과 | 빈 파일/빈 시트/헤더만 파일 업로드 → 안내 및 이후 정상 파일 선택 | [관측 JSON](evidence/production-final/negative-78/62.json) · [화면](evidence/production-final/negative-78/62.png) |
| 63 | 통과 | 병합 날짜·숨김행·2개 시트 XLSX 생성 → 날짜 상속/숨김행/시트 전환 확인 | [관측 JSON](evidence/production-final/negative-78/63.json) · [화면](evidence/production-final/negative-78/63.png) |
| 64 | 통과 | 장소/날짜 동일 열 및 잘못된 열 매핑 → 미리보기 확인 후 수정 | [관측 JSON](evidence/production-final/negative-78/64.json) · [화면](evidence/production-final/negative-78/64.png) |
| 65 | 통과 | 여행 엑셀 내보내기 파일 재업로드 → 이름·시간·메모·순서·좌표 비교 | [관측 JSON](evidence/production-final/negative-78/65.json) · [화면](evidence/production-final/negative-78/65.png) |
| 66 | 통과 | =,+,@,- 외부 문자열을 실제 엑셀/CSV 생성 함수에 전달 → 셀 타입·수식/CSV 구조 검사(수식 실행 없음) | [관측 JSON](evidence/production-final/negative-78/66.json) · [화면](evidence/production-final/negative-78/66.png) |
| 67 | 검증 불가 | 특수문자·HTML·위험 URL 포함 KML 생성 → DOMParser/위험 XML 요소 확인 | [관측 JSON](evidence/production-final/negative-78/67.json) · [화면](evidence/production-final/negative-78/67.png) |
| 68 | 통과 | 모바일 레이아웃에서 Chromium 다운로드 deny → 실제 취소 상태와 저장 완료 문구 비교 | [관측 JSON](evidence/production-final/negative-78/68.json) · [화면](evidence/production-final/negative-78/68.png) |
| 69 | 검증 불가 | 390px 터치 환경에서 편집 입력/저장 버튼 경계 검사(물리 키보드 열기 불가) | [관측 JSON](evidence/production-final/negative-78/69.json) · [화면](evidence/production-final/negative-78/69.png) |
| 70 | 통과 | 미저장 메모 중 세로390×844→가로844×390→데스크톱 크기 변경 | [관측 JSON](evidence/production-final/negative-78/70.json) · [화면](evidence/production-final/negative-78/70.png) |
| 71 | 검증 불가 | 실제 Google 지도 제스처/페이지 스크롤 | [관측 JSON](evidence/production-final/negative-78/71.json) · [화면](evidence/production-final/negative-78/71.png) |
| 72 | 검증 불가 | 긴 한국어 이름+계산된 글꼴 크기 2배 모의 확대 → 버튼 가로 경계 | [관측 JSON](evidence/production-final/negative-78/72.json) · [화면](evidence/production-final/negative-78/72.png) |
| 73 | 통과 | 키보드 Enter로 이동 버튼·날짜·순서 select·적용 조작 | [관측 JSON](evidence/production-final/negative-78/73.json) · [화면](evidence/production-final/negative-78/73.png) |
| 74 | 통과 | 새 여행 모달 Tab/Shift+Tab 반복·Escape·포커스 복귀 | [관측 JSON](evidence/production-final/negative-78/74.json) · [화면](evidence/production-final/negative-78/74.png) |
| 75 | 검증 불가 | 검색 상태·저장 실패·undo의 ARIA 속성과 접근성 트리 수집 | [관측 JSON](evidence/production-final/negative-78/75.json) · [화면](evidence/production-final/negative-78/75.png) |
| 76 | 통과 | 테스트 키·여행을 저장한 브라우저의 다음 탭 → 저장 안내·키/여행/캐시 삭제 경로 | [관측 JSON](evidence/production-final/negative-78/76.json) · [화면](evidence/production-final/negative-78/76.png) |
| 77 | 통과 | 장소 URL에 javascript:/data:/인용부호 조작 URL → 실제 렌더링 링크 프로토콜 검사 | [관측 JSON](evidence/production-final/negative-78/77.json) · [화면](evidence/production-final/negative-78/77.png) |
| 78 | 통과 | 상세/편집 패널 15회 열고 닫기 → 뒤 버튼 hit test·포커스 | [관측 JSON](evidence/production-final/negative-78/78.json) · [화면](evidence/production-final/negative-78/78.png) |

## 검증 불가 상세

- 40번 · OS 창 밖 네이티브 드롭: 브라우저 DOM 밖 OS 드롭은 이 headless 환경에서 미실행. 합성 dragstart/dragend와 body 드롭만 실행
- 50번 · 실제 핀 드래그/복원: 모의 콜백만 실행. 핀 이동 자체의 취소/undo UI가 없어 복원 하위 케이스는 해당 없음
- 59번 · 다른 이전 형식 호환: 과거 버전 fixture/형식 명세가 없어 별도 이전 schema는 검증 불가
- 67번 · Google Earth 등 소비자의 description/URL 해석: 외부 KML 소비자 실행은 하지 않음
- 69번 · 실기기 소프트 키보드/오류 영역: 실기기 및 OS 소프트 키보드 없음
- 71번 · 실제 지도 제스처: 실제 Google API 키와 지도 DOM이 없으므로 지도 대역으로 제스처 통과를 주장하지 않음
- 72번 · 브라우저 실제 텍스트 확대 200%: CSS 계산 글꼴 2배 대체 검사이며 브라우저 텍스트 확대 설정 자체는 미실행
- 75번 · 실제 스크린리더 발화: 스크린리더 없음. 접근성 트리/속성 검사와 실제 발화는 구분
