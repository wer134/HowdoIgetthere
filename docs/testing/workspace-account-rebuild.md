# RouteFlow 일정 보드·계정 재구현 검증 기록

## 작업 기준

- 재구현 시작일: 2026-11-04 KST.
- 시작 코드: GitHub `main`, `d48d89fe772668676c7625d4bf95910e16510576`.
- 작업 브랜치: `rebuild/workspace-accounts`.
- 이전 클라우드 환경의 미푸시 커밋 8개와 `f41e8da`는 회수하지 못했다. 이 작업은 인계된 요구사항을 기준으로 한 새 구현이며 복구본이 아니다.
- 기존 여행 데이터 형식, 게스트 localStorage 저장과 파일 백업을 유지한다. main 병합과 운영 배포는 범위에 포함하지 않는다.
- 이전 보고서의 통과 결과·실제 API 응답·Lighthouse 수치를 이번 코드의 통과 근거로 사용하지 않는다.

## 새로 실행한 검사

| 검사 | 결과 | 범위와 증거 |
|---|---|---|
| 시작 시 `npm test` | 82 통과 / 1 실패 | 병렬 구현 중 추가된 `account-sync.test.js`의 모듈이 아직 없어 실패했다. 깨끗한 기준 코드 전체 검사라고 해석하지 않는다. [로그](evidence/rebuild/release/baseline-unit-tests.txt) |
| 기준 코드의 추적된 테스트만 `node --test`로 실행 | 82/82 통과 | `git ls-files 'tests/*.test.js'`로 기존 테스트 목록만 선택. 기존 추적 소스 수정 전에 실행했다. [로그](evidence/rebuild/release/baseline-tracked-unit-tests.txt), [HEAD](evidence/rebuild/release/baseline-revision.txt) |
| 첫 통합 `npm run build` | 통과, exit 0 | 새 구현을 포함한 미커밋 작업 트리. 공개 파일 46개, version `607a0efaf89c79c7`. [로그](evidence/rebuild/release/build-integration.txt) |
| 첫 통합 `npm run check:release` | 통과, exit 0 | allowlist 45개 + manifest. Windows 경로 구분자를 정규화해 실제 검사 실행. [로그](evidence/rebuild/release/check-release-integration.txt), [수정 근거](evidence/rebuild/release/check-release-paths.md) |
| 통합 안정화 `npm test` | 119/119 통과 | 새 계정·동기화·보드 검사와 기존 테스트. [로그](evidence/rebuild/release/unit-tests-integrated.txt) |
| 통합 안정화 build/check:release | 통과, 각 exit 0 | version `8079647436c5b72e`, HEAD `b5cc77b` + 미커밋 UI 수정. [build](evidence/rebuild/release/build-stable.txt), [release](evidence/rebuild/release/check-release-stable.txt), [메타데이터](evidence/rebuild/release/stable-build-metadata.json) |
| 브라우저 검사 전 빠른 검사 | 119/119, build/check 각각 exit 0 | version `a395c9c2f2118a82`. [단위](evidence/rebuild/release/unit-tests-final-fast.txt), [build](evidence/rebuild/release/build-final-fast.txt), [release](evidence/rebuild/release/check-release-final-fast.txt) |
| 일정 보드 브라우저 검사 | 동작 11개 및 뷰포트 6개 통과 | `a395c9c2f2118a82`, 1440×1000·1280×900·768×1024·390×844·844×390·640×450. 외부 API 호출 없음. [결과](evidence/rebuild/board/results.json) |
| 계정 브라우저 검사 | 11개 시나리오 통과 | `a395c9c2f2118a82`, 실제 로컬 HTTP/SQLite와 모의 OAuth/AI. 게스트 비업로드·명시적 복사·오프라인·충돌·공유 제안·로그아웃·기기 저장 회귀. [결과](evidence/rebuild/account/results.json) |
| 백엔드 독립 검토 및 HTTP/SQLite 검사 | 24/24 통과 | 외부 제공업체는 모의. 두 보안 수정의 재현 검토이며 전체 출시 감사가 아니다. [독립 검토](evidence/rebuild/release/backend-independent-review.md) |
| `npm audit --json` | 취약점 0, exit 0 | 새 계정 의존성을 포함한 npm 패키지 범위. [결과](evidence/rebuild/release/npm-audit.json) |
| Gitleaks v8.30.0 소스 검사 | 발견 0, exit 0 | 추적 파일과 Git ignore 대상이 아닌 새 파일 1,338개를 격리 복사해 검사. [요약](evidence/rebuild/release/gitleaks-source-summary.json) |
| Gitleaks v8.30.0 전체 Git 이력 | 발견 0, exit 0 | `--all`, 실행 시 HEAD `b5cc77b`. [요약](evidence/rebuild/release/gitleaks-history-summary.json). 공식 Windows 패키지와 게시 체크섬 [검증 기록](evidence/rebuild/release/gitleaks-tool.json) |

최종 구현 검사 결과는 각 기능의 새 증거가 생성된 뒤 이 문서에 추가한다. 위 시작 검사는 새 계정·보드 기능의 통과를 뜻하지 않는다. 첫 통합 산출물의 `revision`은 아직 커밋 전 HEAD인 `d48d89f`를 표시하므로 해당 SHA의 원본 코드와 동일한 산출물이라고 해석하지 않는다. 최종 커밋 후 다시 빌드한 결과로 출시 여부를 판단한다.

`a395c9c2f2118a82` 이후 추가한 편집창 보호 세 경로(계정 최신본 열기, JSON 백업 복원, BYOK 준비)는 해당 빌드에 포함되지 않았다. 마지막 빌드와 추가 회귀 확인 결과를 별도로 기록해야 한다.

## 검증 구분

로컬 HTTP와 SQLite를 사용하는 통합 검사는 실제 저장과 요청 경계를 검사한다. 외부 Google OAuth·Twilio·AI를 대체한 경우에는 제공업체 모의 검사로 기록한다. 실제 로그인·문자 수신·AI 청구 검증과 구분한다. 브라우저 자동화는 별도 컨텍스트와 테스트 여행만 사용하며 기존 사용자의 브라우저 데이터는 사용하지 않는다.

기존 78개 부정 테스트의 과거 결과는 재사용하지 않는다. 새로 실행했다면 해당 빌드와 결과 파일을 함께 기록한다. 항목 40, 50, 59, 67, 69, 71, 72, 75의 기존 검증 불가 수용은 통과로 바꾸지 않는다. 실행하지 않은 검사는 미실행으로 남긴다.

재구현에서는 계정이 추가되어 기존 5번의 “계정 기능 없음” 판정은 더 이상 유효하지 않다. 게스트·모의 지도 전용 78개 검사에서는 인증 세션을 구성하지 않으므로 5번을 검증 불가로 표시하고, 계정 동작은 별도 HTTP/SQLite·브라우저 검사로 검증한다. CI는 이 9개 검증 불가와 나머지 항목의 오류 없음을 요구한다. 이는 전체 78개를 이미 실행해 통과했다는 기록이 아니며 최종 실행 결과는 별도 증거로 확정한다.

## 실제 운영 전에 남은 검증

- 실제 Google OAuth 프로젝트·클라이언트 연결과 로그인·거절·만료·로그아웃.
- 실제 Twilio Verify 설정, 문자 수신 및 운영자 무료 AI의 인증·문자·청구 전체 흐름.
- 운영 주체, 비공개 연락처, 개인정보 보관 기간과 삭제 요청 절차 확정.
- Node 단일 인스턴스·영구 SQLite 볼륨 배포, 재시작, 백업 복원 훈련.
- Docker 이미지 빌드 및 실행 검증(이미지를 제공하거나 검사한 것으로 간주하지 않음).
- 실제 Safari·Firefox·Edge 제품, iPhone·Galaxy·iPad, 소프트 키보드·스크린리더 검사.
- 실제 사용자의 일정 정리·제안 수락 관찰 테스트.
- 실제 Google Maps·Places·Routes와 개인 키 AI 재검증. 과거 HTTP 200 기록은 이번 실행 결과가 아니다.

운영자 무료 AI는 기본 OFF이며 SMS/AI 예산은 기본 0이다. 비용 제어는 외부 호출 전 최대 예상 비용을 예약하는 방식이고 실제 제공업체 청구서를 실시간 대조하는 원장이 아니다. 전화 인증 역시 법적 실명 인증이나 다수 실제 번호 공격의 완전 차단을 보장하지 않는다.
