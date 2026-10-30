"""78개 실제 재실행 증거를 집계한다. 테스트를 실행하거나 판정을 변경하지 않는다."""
import ast
import json
import re
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
ROOT = HERE.parents[1]
EVIDENCE = HERE / 'evidence/revalidation-78'
requests = dict((int(m[1]), m[2]) for line in (HERE/'repro/negative-tests-78-input.txt').read_text().splitlines() if (m := re.match(r'^(\d+)\. (.*)', line)))
results = {i: json.loads((EVIDENCE/f'{i:02}.json').read_text()) for i in range(1,79)}
baseline = {r['id']:r for r in json.loads((HERE/'evidence/negative-78/results.json').read_text())}
assert set(results) == set(requests) == set(baseline) == set(range(1,79))
assert not any(r.get('harnessError') or r.get('captureError') for r in results.values())
assert all(r['checks'] and r['finished'] for r in results.values())
for r in results.values():
    expected = '결함 확인' if any(c['status']=='결함 확인' for c in r['checks']) else '검증 불가' if any(c['status']=='검증 불가' for c in r['checks']) else '통과'
    assert r['status'] == expected
# 기존 설명 중 실행 층위/제약만 재사용하고, 결함 수정 항목은 현재 관측으로 교체한다.
notes = {}
for node in ast.parse((HERE/'repro/render-report.py').read_text()).body:
    if isinstance(node, ast.Assign) and any(isinstance(t,ast.Name) and t.id=='notes' for t in node.targets):
        notes = ast.literal_eval(node.value)
notes.update({
2:'생성·추가·적용은 연속 requestSubmit으로 재진입을 검증했다. 검색은 Enter와 클릭을 함께 실행했다. 닫힌 폼의 재제출이 새 데이터를 만들지 않았다.',
3:'새로고침·뒤로가기 왕복·탭 종료 뒤 초안을 복원했다. 실제 Chromium dragTo 확정 후 다시 열어 순서를 비교했다.',
5:'모의 gm_authFailure 및 테스트 키 제거/새로고침 후 입력 초안을 복원했다. 계정 로그인은 현재 기능이 없어 해당 없음이다.',
8:'동일 격리 컨텍스트의 두 탭에서 첫 저장본 보존 및 다른 탭이 삭제한 여행의 부활 방지를 검사했다. 실제 Google 호출은 없다.',
9:'이동·삭제·복원 후 여행 전환을 실행했다. 전환 시 이전 undo가 숨겨지는지 확인하고 DOM에서 이전 버튼을 강제로 호출해도 B가 바뀌지 않는지 검사했다. 핀은 지도 대역 기록이다.',
10:'HTML 비실행, 긴 메모 보존, 잘못된 좌표 제외, 손상 ZIP과 XLSX 위장 텍스트 거부를 실행했다.',
11:'공백 및 줄바꿈만 있는 이름으로 여행이 생성되지 않았다. HTML 입력 제약 외에 submit 처리에서도 검증한다.',
13:'0/-1/1.5/1000일 입력을 HTML 유효성 검사와 이를 우회한 submit에서 각각 검사했다. 무제한 메모리 소모 실험은 하지 않았다.',
17:'짧은 날짜를 자동 추정하지 않고 연도 확인 경고를 표시한다. 저장된 날짜 원문과 경고를 비교했다.',
18:'역전 시간과 자정 넘김 모두 종료·시작 및 입력 오류 확인 안내를 표시한다. 날짜를 임의 보정하지 않는다.',
19:'24:00/25:30은 미지원으로, 오전 12시는 00:00으로 처리한다. 실제 timeMatches/legTiming 모듈을 실행했으며 실제 Google 출발 요청은 보내지 않았다.',
22:'요청 시작 시 검색어를 보관해 결과 안내에 표시한다. 응답 전에 입력을 바꿔도 요청 검색어가 남는다.',
30:'오래된 장소를 배치하면 폐업·이전 여부를 방문 전에 확인하라는 안내를 표시한다. 실제 폐업 상태 재조회/자동 갱신을 수행했다는 뜻은 아니다.',
31:'메모 input 시 저장하고 탭별 복구 기록을 남긴다. blur 없는 즉시 새로고침 뒤 저장 내용을 비교했다.',
33:'편집 대상을 바꿀 때 초안을 보관한다는 안내를 확인했다. 새로고침/종료 후 복원은 3번에서 별도 검증했다.',
36:'날짜 이동 후 기존 시간을 유지하고 같은 날 방문 시간의 겹침을 안내했다.',
43:'삭제 → 추가 후 별도 삭제 되돌리기를 실행했다. 삭제된 행과 후속 추가 행이 모두 남는지 비교했다.',
45:'일반 다운로드 안내가 표시되어도 이전 되돌리기 버튼이 유지됐다.',
58:'손상 항목은 안내와 함께 목록에서 제외되고 정상 저장 데이터는 유지됐다. 페이지 오류도 수집했다.',
60:'키와 내부 ID가 다른 여행은 열기 목록에서 제외된다. B의 원본 유지와 updated/records/cells/library/dates/mapping 타입 변조를 각각 검사했다.',
61:'위장 XLSX 및 손상 ZIP 입력을 거부하며 활성 여행이 유지되는지 확인했다.',
66:'실제 XLSX/CSV 생성 모듈과 파일 구조를 검사했다. CSV 수식 형태 문자열에는 작은따옴표를 붙이며 XLSX 문자열은 유지한다. Excel에서 수식을 실행하지 않았다.',
68:'CDP로 다운로드를 거부하여 canceled를 확인했다. 앱은 저장 완료 대신 다운로드 요청 및 브라우저 확인 안내를 표시한다.',
70:'390px 세로 화면과 844×390 가로 화면에서 편집창을 스크롤한 뒤 저장 버튼의 실제 경계를 측정했다.',
77:'javascript:/data: 링크가 렌더링 href에서 제거됐고 클릭 시 실행 마커가 생기지 않았다. HTTPS 링크의 인용부호도 속성을 만들지 않았다. 현재 Chromium 실행과 구조 검사 범위다.',
})
severity = {i:'P2' for i in (2,3,5,10,13,17,18,22,30,31,33,36,43,58,61,66,68,70,77)}
severity.update({8:'P1',9:'P1',60:'P1',11:'P3',19:'P3',45:'P3'})
counts = Counter(r['status'] for r in results.values())
commit = json.loads((EVIDENCE/'run-metadata.json').read_text())['source_commit']
fixed = [i for i in results if baseline[i]['status']=='결함 확인' and results[i]['status']=='통과']
start = min(r['started'] for r in results.values()); end = max(r['finished'] for r in results.values())
summary = {'commit':commit,'baseline_commit':'de2ecb4808a2a422bbe90b59d43d398cc137abad','counts':{k:counts[k] for k in ['통과','결함 확인','검증 불가']},'actual_google_calls':0,'case_count':78,'subcase_count':sum(len(r['checks']) for r in results.values()),'resolved_baseline_defects':fixed,'harness_errors':[],'started':start,'finished':end}
(EVIDENCE/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')

def brief(v,limit=850):
    s = v if isinstance(v,str) else json.dumps(v,ensure_ascii=False,separators=(',',':'))
    s = re.sub(r'\x1b\[[0-9;]*m','',s).replace('\n',' / ').replace('|','\\|').replace('<','&lt;').replace('>','&gt;')
    return s[:limit]+('… (전체 JSON 참조)' if len(s)>limit else '')

out = ['# RouteFlow 부정 테스트 78개 수정 후 재검증','',
f'대상: `wer134/HowdoIgetthere`, main 기준 `de2ecb4`에서 수정한 로컬 `work` 브랜치 `{commit}`. 실행: {start} ~ {end} (UTC).','',
f'**전체 78개: 통과 {counts["통과"]} · 결함 확인 {counts["결함 확인"]} · 검증 불가 {counts["검증 불가"]}. 기존 결함 25개 중 {len(fixed)}개가 수정 후 통과했다.** 항목 일부가 미실행이면 전체를 통과로 올리지 않았다. [수정 전 보고서](negative-tests-78-baseline.md)는 45 통과·25 결함·8 검증 불가였으며 원본 증거도 보존했다.','',
'**실제 Google API 호출 검증은 0건이다.** 사용 가능한 Google 키가 없어 외부 네트워크를 차단한 별도 Chromium 프로세스와 항목별 비영속 BrowserContext를 사용했다. 여행 A/B, 파일, API 키는 전용 테스트 데이터다. 실제 사용자 여행이나 브라우저를 사용하지 않았다. 검색·사진·상세·경로는 모의 SDK 응답이고 지도는 MapView 호출 기록 대역이다. 모의 통과는 실제 권한·쿼터·결제·지도 렌더링·장소 품질의 통과가 아니다. 화면의 지도 연결됨 문구도 대역 상태다.','',
'브라우저 Chromium 154.0.8037.57, Playwright 1.62.1, Node 24.19.0. 기본 1440×900, 모바일 대체 390px 및 가로 844×390. 브라우저 시간대는 Asia/Seoul이며 15번에서 별도 변경한다. 동일 항목 내 두 탭만 저장소를 공유한다.','',
'## 수정과 커밋','',
'커밋의 P1/P2/P3는 변경 영향에 따른 묶음이다. 아래 항목표의 기존 결함 심각도는 수정 전 평가를 그대로 유지했다.','',
'| 커밋 | 변경 | 관련 항목 |','|---|---|---|',
'| `06a8521` P1 | Web Locks 저장 직렬화·충돌 감지, 여행 경계 undo, 손상 snapshot 검증 | 8·9·58·60 |',
'| `7437544` P2 | 짧은 화면에서 편집창 높이 제한·스크롤 | 70 |',
'| `5a7a624` P2 | XLSX 내용 확인, CSV 수식 중화, HTTP(S) URL 허용, 다운로드 안내 | 10·61·66·68·77 |',
'| `a408898` P2 | 초안 및 메모 복원, 중복 제출·일수 검증, 삭제 undo 유지 | 2·3·5·11·13·31·33·43·45 |',
'| `b4633fc` P3 | 날짜/시간 충돌 및 캐시 안내, 검색어 표시, 한국어 시각 해석 | 17·18·19·22·30·36 |',
'| `603ff2f` 검증 도구 | 비동기 대화상자 대기, 차단된 이전 undo/손상 ID 검증, 삭제 전용 undo 및 드래그 지점 지정 | 3·8·9·43·60 등 |','',
'실행 조건 변경: 9번은 사라진 버튼을 기다리는 대신 숨김과 DOM 호출 무효를 검사한다. 60번은 유효하지 않은 항목이 목록에 없어야 하며 정상 B의 원본을 비교한다. 43번은 삭제 전용 버튼을 사용하며 삭제 복원과 후속 추가 보존 조건을 그대로 유지한다. 3번 실제 dragTo는 행 내부의 명시적 지점을 잡는다. 비동기 목록 열기/닫기는 보이는 상태를 기다린다. 항목이나 하위 조건을 삭제하지 않았다.','',
'## 재현 및 추가 회귀','',
'[사용자 원문](repro/negative-tests-78-input.txt) · [실행 스크립트](repro/negative-78.cjs) · [SDK 대역](repro/google-mock.js) · [지도 대역](repro/mapview-mock.js) · [집계 JSON](evidence/revalidation-78/results.json) · [요약](evidence/revalidation-78/summary.json) · [전체 실행 로그](evidence/revalidation-78/run.log)','',
'```bash\nPORT=8093 node server.js --no-open\n# 다른 터미널, 저장소 루트. ONLY 없이 전체 실행한다.\nNEGATIVE_OUT="$PWD/docs/testing/evidence/revalidation-78" APP_URL=http://127.0.0.1:8093 node docs/testing/repro/negative-78.cjs\npython docs/testing/repro/render-revalidation.py\n```','',
'선택 실행에는 `ONLY=번호`를 추가한다. 새 전체 검증에는 새 증거 폴더를 사용한다. 기본 출력 경로는 최초 증거 폴더이므로 `NEGATIVE_OUT`을 반드시 지정한다. Playwright가 제공된 환경의 NODE_PATH와 Chromium을 사용한다.','',
'단위 테스트 `npm test`: **43/43 통과** ([출력](evidence/revalidation-78/unit-tests.txt)). 기존 여행 작업 화면(1440·390px)과 순서·undo·드래그·날짜·복수 여행 브라우저 회귀도 통과했다 ([작업 화면](evidence/revalidation-78/workspace-regression.log), [순서](evidence/revalidation-78/order-regression.log)).','',
'공통 사전 조건: A에 11/1 첫·둘째 장소, 11/2 셋째 장소, B에 독립 장소 1개를 넣고 UI로 A를 연다. 특수 실패 주입과 입력은 각 절차/하위 결과에 명시한다. JSON은 실행 관측값이고 PNG는 최종 화면이다. 중간 상태를 최종 화면만으로 입증하지 않는다. 의도한 외부 요청 차단/사진 404는 콘솔 오류에 포함될 수 있으며 페이지 오류와 구분한다. 소스 검토로 통과 판정을 대신하지 않았다.','',
'## 전체 항목','',
'| 번호 | 수정 전 → 재검증 | 기존 심각도 | 항목 |','|---|---|---|---|']
for i,r in results.items():
    out.append(f'| [{i}](#case-{i}) | {baseline[i]["status"]} → {r["status"]} | {severity.get(i,"—")} | {brief(requests[i].split(". ")[0],70)} |')
out += ['','## 검증 불가 항목','', '아래 하위 조건을 실행할 환경/자료가 없어 전체 항목을 검증 불가로 유지했다. 이미 실행한 하위 결과는 해당 항목에 따로 기록한다.','']
for i,r in results.items():
    if r['status']=='검증 불가':
        out.append(f'- {i}: '+ '; '.join(brief(c.get('actual'),500) for c in r['checks'] if c['status']=='검증 불가'))
for i,r in results.items():
    out += ['',f'<a id="case-{i}"></a>',f'## {i}. {requests[i].split(". ")[0]}','',
      f'**{r["status"]}** · 수정 전 {baseline[i]["status"]} · 기존 심각도 {severity.get(i,"없음/미평가")}','',
      '- 사전 조건: 격리 브라우저 및 공통 테스트 여행. 추가 전제는 아래 절차와 관측값 참조.',
      f'- 재현 절차: {r["steps"]}. 선택 실행 `ONLY={i}`.',
      f'- 기대 결과: {requests[i]}',
      f'- 실행 범위와 해석: {notes[i]}',
      f'- 근거: [관측 JSON](evidence/revalidation-78/{i:02}.json) · [최종 화면](evidence/revalidation-78/{i:02}.png). {r["started"]} ~ {r["finished"]}.','',
      '| 하위 케이스 | 판정 | 실제 관측 |','|---|---|---|']
    out += [f'| {brief(c["name"])} | {c["status"]} | {brief(c.get("actual"))} |' for c in r['checks']]
    if r['errors']: out += ['', '페이지 오류: '+brief(r['errors'])]
    for case,filename in [(65,'65-roundtrip.xlsx'),(66,'66-formula.xlsx'),(66,'66-formula.csv'),(67,'67-malicious.kml'),(70,'70-landscape.png'),(75,'75-aria.yaml')]:
        if i==case: out += ['',f'추가 증거: [{filename}](evidence/revalidation-78/{filename}). 파일 생성/구조 검사이며 외부 소비자에서의 수식·코드 실행은 하지 않았다.']
(HERE/'negative-tests-78.md').write_text('\n'.join(out)+'\n')
print(json.dumps(summary,ensure_ascii=False,indent=2))
