# Windows 공개 산출물 경로 검사 수정

Node 24.18.0 / Windows 환경에서 확인했다.

- 원래 `path.win32.relative('E:/HowdoIgetthere/dist', 'E:/HowdoIgetthere/dist/js/app.js')` 결과는 `js\app.js`이다.
- release allowlist의 `js/app.js`와 직접 비교하면 assertion이 실패했다.
- `path.relative(root, file).split(path.sep).join('/')`로 파일시스템 경로만 URL 형식으로 정규화했다.
- 같은 입력의 Windows와 POSIX 경로 구현을 각각 검사하여 allowlist 일치를 확인했다.
- `node --check tools/check-release.js` 통과.

검토한 다른 원인: allowlist에 자산 자체가 누락되는 경우와 `.gz`/`.br` 확장 처리 문제. 재현 입력에는 정확한 자산 이름이 있었고 압축 확장이 없었으므로 둘 다 이 실패의 원인이 아니다. 수정은 허용 파일 범위를 확대하지 않는다.

이는 경로 재현 검사이며 전체 production 빌드 검사를 대신하지 않는다. 실제 `npm run build`와 `npm run check:release` 결과는 최종 검증 기록에 별도로 남긴다. 임시 파일이나 프로세스를 만들지 않았다.
