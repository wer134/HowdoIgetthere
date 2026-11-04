# 비활성 탭 회귀 검사 진단

제품 artifact는 `da6ab5e` / `c59f564a0c63efe6`로 그대로 유지했다. 원본 파일은 수정하지 않고 임시 Node preload로 다음 사용자 동작만 테스트 코드 메모리에 삽입했다.

- travel-safety의 `open(p,id)`, `memo(p,text)` 시작에서 `await p.bringToFront()`.
- q에서 편집한 뒤 p의 저장한 여행 버튼으로 돌아갈 때 `await p.bringToFront()`.
- negative78의 공통 `close(p)` 시작에서 `await p.bringToFront()`.

원래 전체 회귀에서는 비활성 p의 편집 버튼이 DOM에 존재하고 안정적인 위치로 확인됐는데도 클릭이 시간 초과됐다. 실제 사용자가 탭으로 돌아오는 동작을 명시하자 safety 5개 시나리오와 negative 8번의 원래 단언이 전부 통과했고 실행기 exit code는 0이었다. 상태값 주입, 강제 클릭, 단언 제거, 앱 수정은 하지 않았다.

이 결과는 진단 실행이다. 최종 테스트 어댑터 변경 후 preload 없는 검사를 별도 수행해야 한다. 임시 preload는 제거했으며 서버 종료는 `cleanup.json`으로 확인했다.
