"""최종 사용자 시나리오와 78개 재실행 결과를 합친다. 실행을 대신하지 않는다."""
from pathlib import Path
import json
import re
from collections import Counter

ROOT = Path(__file__).resolve().parents[3]
HERE = ROOT/'docs/testing'
EVIDENCE = HERE/'evidence/traveler-review'
records = json.loads((EVIDENCE/'negative-78/results.json').read_text())
assert len(records)==78 and {r['id'] for r in records}==set(range(1,79))
assert all(r['checks'] and not r.get('harnessError') and not r.get('captureError') and not r['errors'] for r in records)
journeys = json.loads((EVIDENCE/'journey/results.json').read_text())
assert {r['width'] for r in journeys}=={1440,390} and all(r['status']=='통과' for r in journeys)
counts=Counter(r['status'] for r in records)
requests={int(m[1]):m[2] for line in (HERE/'repro/negative-tests-78-input.txt').read_text().splitlines() if (m:=re.match(r'^(\d+)\. (.*)',line))}
meta=json.loads((EVIDENCE/'run-metadata.json').read_text())
summary={**meta,'counts':{k:counts[k] for k in ['통과','결함 확인','검증 불가']},'cases':78,'subcases':sum(len(r['checks']) for r in records),'unit_tests':46,'browser_widths':[1440,390],'started':min(r['started'] for r in records),'finished':max(r['finished'] for r in records)}
(EVIDENCE/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
lines=['# 사용자 관점 개선과 최종 검증','',
f'검증 코드: `{meta["source_commit"]}` · main `de2ecb4`에서 이어진 로컬 work 브랜치. 최종 78개 실행 {summary["started"]} ~ {summary["finished"]} (UTC).','',
'## 구매 가치에 대한 판단','',
'개인 여행을 정리하고, 다른 브라우저로 옮기고, 여행 중 오프라인으로 펼쳐 보는 **일회성 여행 준비 도구**로는 비용을 지불할 만한 사용 흐름을 갖췄다고 판단한다. 처음 방문한 사람에게 API 설정과 검색부터 요구하던 화면에서 벗어나, 일정 추가와 직접 후보 보관을 먼저 안내한다. 이는 아래 실행에 근거한 개발자의 제품 판단이며 실제 사용자 인터뷰나 구매 전환 검증은 아니다.','',
'**일반 소비자 대상 유료 지도·경로 서비스나 월 구독 제품으로 출시할 판단은 보류한다.** 실제 Google 장소 정확도·길찾기·지도 조작·비용을 검증할 키가 없고, 현재 지도 기능은 사용자 본인의 API 프로젝트 설정이 필요하다. 동기화·공동 편집은 현재 제공하지 않는다. 이 제약을 새로운 기능이나 모의 지도 결과로 숨기지 않았다.','',
'## 사용자가 겪던 문제와 바뀐 동작','',
'| 사용자 관점의 문제 | 바뀐 동작 | 실행 근거 |','|---|---|---|',
'| 시작부터 API 키와 결제 계정 설정에 막힘 | 지도 없이 이름·지역·메모로 후보 보관. 새 여행은 일정 추가 화면으로 시작하고 오늘 날짜 기본 제공 | 실제 SDK 없이 1440·390px 시나리오 |',
'| 후보·메모까지 다른 기기로 옮길 방법이 없음 | 여행 전체 백업에 일정·후보·메모·빈 날짜를 담고 새 ID의 복원본 생성. 기존 여행 유지 | 독립 BrowserContext 복원 및 새로고침 |',
'| 여행 중 편하게 볼 자료가 없음 | 전체 일정·빈 날·보관 후보를 읽는 일정표, 오프라인 HTML, 인쇄/PDF | 실제 다운로드 HTML과 A4 PDF 생성·시각 확인 |',
'| 다시 방문할 때 여행을 찾아 들어가야 함 | 최근 여행 이어서 준비하기 및 이름 변경 | 이름 저장·재방문·복원본 재열기 |',
'| 오래된 Google 캐시 정리가 내 메모까지 삭제 | 외부 장소 데이터가 만료되어도 개인 메모 보존 | 31일 지난 후보에 예약 메모 주입 후 열기 |',
'| 빈 검색 결과에서 검색어를 지우면 드래그가 사라짐 | 재생성되는 행에도 draggable 속성 유지 | 수정 전 false/false 재현, 수정 후 실제 dragstart/drop 및 순서 변경 |',
'| 매 행의 경고로 목록이 복잡하고 PDF 폭이 좁음 | 장소 최신성 안내를 목록 공통 안내로 모으고, 인쇄는 용지 폭 사용 | 스크린샷 및 최종 A4 1페이지 PDF |','',
'## 반복 검증 결과','',
f'- 최종 78개: **통과 {counts["통과"]} · 결함 확인 {counts["결함 확인"]} · 검증 불가 {counts["검증 불가"]}**. 하위 검사 {summary["subcases"]}개. 페이지 오류·도구 오류 없음.',
'- 단위 테스트 **46/46 통과**. 기존 여행 작업 화면(1440/390px), 순서·undo·드래그·복수 여행 회귀 통과.',
'- 신규 사용 시나리오 **1440px/390px 모두 통과**. 후보 3개(동명 2개 포함) → 날짜 배치 → 시간·여러 줄 메모 수정 → 이름 변경 → 검색 없음 복구 → 전체 백업 → 원본 보존 복원 → 다른 컨텍스트에서 재열기 → 오프라인 일정표 열람.',
'- 실패 시나리오: 손상 JSON, 미지원 백업 버전, localStorage 쓰기 실패에서 기존 여행·저장본 유지. 백업에 API 키·사진·리뷰 미포함. HTML 주입 문자열은 이스케이프.',
'- 첫 전체 실행에서는 3번의 화면 밖 대상 드래그 준비 과정이 시간 초과로 끝나 69 통과·9 검증 불가였다. 실패를 통과로 바꾸지 않고 원본 결과를 보존했다. 대상을 미리 스크롤한 뒤 실제 dragTo를 실행하도록 재현 도구를 바꾸고, 최종 78개 전체를 다시 실행했다. 검색어 삭제 후 드래그 소실은 별도의 실제 앱 결함으로 재현·수정했다.','',
'## 검증 환경과 한계','',
'별도 Chromium 154.0.8037.57 프로세스, 비영속 BrowserContext, Node 24.19.0, Playwright 1.62.1. 전용 부산 여행/fixture와 테스트 파일만 사용했다. 외부 요청은 차단했다. 신규 사용자 시나리오는 Google SDK 대역도 사용하지 않고 로컬 편집·저장만 실행했다. 78개 검사는 기존 모의 Google SDK 및 지도 호출 기록 대역을 사용했다. **실제 Google API 검증은 0건**이다. 실제 지도·OS 드래그·소프트 키보드·스크린리더 등의 미실행 조건은 계속 검증 불가로 둔다.','',
'## 커밋','',
'| 위험도 | 커밋 | 내용 |','|---|---|---|',
'| P1 | `53a9c35` | 장소 캐시 만료 때 개인 메모 보존 |',
'| P2 | `8eed055` | 지도 없이 후보 보관, 전체 백업·안전한 복원, 일정표·이름 변경·이어서 준비하기 |',
'| P3 | `78f13a6` | 첫 화면·모바일·일정표 가독성 및 사용 안내 |',
'| P2 | `dc28a55` | 빈 검색 후 실제 드래그 복구와 회귀 검사 |',
'| P3 | `a6d7bcd` | 인쇄 폭·여백, 일정표 그룹 생성 개선, 드래그 재현 준비 |','',
'## 증거와 재현','',
'- [신규 사용자 시나리오](../../tests/browser/traveler-journey.cjs) · [결과](evidence/traveler-review/journey/results.json) · [실행 로그](evidence/traveler-review/journey.log)',
'- [검색 후 드래그 회귀](../../tests/browser/travel-drag.cjs) · [수정 전 실패](evidence/traveler-review/drag-before.log) · [수정 후 성공](evidence/traveler-review/drag-after.log)',
'- [단위 테스트](evidence/traveler-review/unit-tests.txt) · [기존 모바일/데스크톱 회귀](evidence/traveler-review/workspace.log) · [순서 회귀](evidence/traveler-review/order.log)',
'- [첫 전체 시도 결과](evidence/traveler-review/negative-78-first-attempt/results.json) · [3번 중단 증거](evidence/traveler-review/negative-78-first-attempt/03.json)',
'- [최종 78개 집계](evidence/traveler-review/negative-78/results.json) · [전체 로그](evidence/traveler-review/negative-78/run.log) · [최종 요약](evidence/traveler-review/summary.json)',
'- [첫 화면](evidence/traveler-review/journey/1440-start.png) · [모바일 복원](evidence/traveler-review/journey/390-restored.png) · [모바일 일정표](evidence/traveler-review/journey/390-itinerary.png) · [실제 PDF](evidence/traveler-review/journey/itinerary.pdf) · [PDF 시각 확인](evidence/traveler-review/journey/print-preview.png)','',
'```bash\nPORT=8093 node server.js --no-open\n# 다른 터미널, 저장소 루트\nnpm test\nAPP_URL=http://127.0.0.1:8093 JOURNEY_OUT=/tmp/new-traveler-journey node tests/browser/traveler-journey.cjs\nAPP_URL=http://127.0.0.1:8093 node tests/browser/travel-drag.cjs\nAPP_URL=http://127.0.0.1:8093 NEGATIVE_OUT=/tmp/new-negative-78 node docs/testing/repro/negative-78.cjs\n```','',
'## 78개 항목별 최종 판정','',
'기대 조건과 세부 재현 절차는 [사용자 원문](repro/negative-tests-78-input.txt) 및 [이전 상세 보고서](negative-tests-78.md)를 따른다. 아래 JSON에는 이번 실행의 시작·종료 시각, 재현 절차, 모든 하위 판정과 관측값이 들어 있다. 미실행 하위 조건이 하나라도 있는 항목은 전체 통과로 처리하지 않았다.','',
'| 번호 | 최종 결과 | 하위 검사 | 항목 및 관측 근거 |','|---|---|---|---|']
for r in records:
    i=r['id'];title=requests[i].split('. ')[0].replace('|','\\|')
    lines.append(f'| {i} | {r["status"]} | {len(r["checks"])} | [{title}](evidence/traveler-review/negative-78/{i:02}.json) · [화면](evidence/traveler-review/negative-78/{i:02}.png) |')
lines += ['','## 아직 실행하지 못한 조건','']
for r in records:
    for c in r['checks']:
        if c['status']=='검증 불가':lines.append(f'- {r["id"]}: {c["name"]} — {c.get("actual","")}')
(HERE/'traveler-readiness.md').write_text('\n'.join(lines)+'\n')
print(json.dumps(summary,ensure_ascii=False,indent=2))
