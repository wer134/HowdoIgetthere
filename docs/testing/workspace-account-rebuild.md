# RouteFlow 일정 보드·계정 재구현 검증 기록

## 작업 기준

- 재구현 시작일: 2026-11-04 KST.
- 시작 코드: GitHub `main`, `d48d89fe772668676c7625d4bf95910e16510576`.
- 작업 브랜치: `rebuild/workspace-accounts`.
- 이전 클라우드 환경의 미푸시 커밋 8개와 `f41e8da`는 회수하지 못했다. 이 작업은 인계된 요구사항을 기준으로 한 새 구현이며 복구본이 아니다.
- 기존 여행 데이터 형식, 게스트 localStorage 저장과 파일 백업을 유지한다. main 병합과 운영 배포는 범위에 포함하지 않는다.
- 이전 보고서의 통과 결과·실제 API 응답·Lighthouse 수치를 이번 코드의 통과 근거로 사용하지 않는다.

## 최종 검증 결과

실제로 검사한 제품 소스는 `da6ab5eac497b278f73d9e728282cbf99d37337c`, production 자산 버전은 `c59f564a0c63efe6`이다. 별도 검토 작업 폴더에서 빌드한 같은 산출물을 사용했다. 이후 `02bd98b08ca941dd113d3299606eb963dc7f2263`은 두 브라우저 검사에서 원래 탭을 다시 활성화하는 테스트 보정만 추가했으며 제품 코드는 바꾸지 않았다. 이 기록은 원래 미푸시 구현의 복구 또는 과거 결과의 재사용을 뜻하지 않는다.

| 최종 검사 | 실제 결과 | 증거 |
|---|---|---|
| `npm test` | 124/124 통과 | [원시 로그](evidence/rebuild/final-da6ab5e/release/npm-test.txt) |
| build / check:release | 각각 exit 0, 공개 allowlist 45개 + manifest | [종료 코드](evidence/rebuild/final-da6ab5e/release/exits.json), [검사 로그](evidence/rebuild/final-da6ab5e/release/check-release.txt) |
| 일정 보드 | 동작 12개, 6개 뷰포트 통과 | [결과](evidence/rebuild/final-da6ab5e/board/results.json) |
| 계정 흐름 | 11개 시나리오 통과 | [결과](evidence/rebuild/final-da6ab5e/account/results.json) |
| 추가 보호 경로 | 기존 11개 + 추가 3개, 총 14개 통과 | [결과](evidence/rebuild/final-da6ab5e/extra/results.json) |
| 개인정보·이용 안내 | 390/768/1440에서 두 문서, 총 6개 검사 통과 | [결과](evidence/rebuild/final-da6ab5e/legal/results.json) |
| 기존 브라우저 회귀 | journey/order/drag/day-revision/stability 통과, safety는 탭 보정 후 5개 통과 | [최초 실행](evidence/rebuild/final-da6ab5e/regressions/run-summary.json), [보정 후 실행](evidence/rebuild/final-da6ab5e/clean-tab-activation/run-summary.json) |
| 전체 78개 부정 검사 | 69 통과 / 0 결함 / 9 검증 불가 | [전체 결과](evidence/rebuild/final-da6ab5e/clean-tab-activation/negative-78/results.json), [결과 검증](evidence/rebuild/final-da6ab5e/closeout-verification.json) |
| 독립 검토 | 요구사항·코드·보안·문맥 검토 및 Visual A/B에서 차단 사항 없음 | [요구사항](evidence/rebuild/final-da6ab5e/goal-review.md), [코드·Visual A](evidence/rebuild/final-da6ab5e/code-review.md), [보안](evidence/rebuild/final-da6ab5e/security-review.md), [문맥·Visual B](evidence/rebuild/final-da6ab5e/context-review.md) |
| 새 `npm audit` | 취약점 0 | [원시 결과](evidence/rebuild/final-da6ab5e/npm-audit-final.json) |
| 최종 Gitleaks 원시 검사 | 소스 3건 / 이력 1건, 모두 파일 SHA256 메타데이터 오탐으로 확인 | [분류 근거](evidence/rebuild/final-da6ab5e/security-scan-final.json) |

검증 불가 번호는 `5, 40, 50, 59, 67, 69, 71, 72, 75`이다. 기존 8개는 통과로 바꾸지 않았다. 추가된 5번은 로그인 세션을 구성하지 않는 게스트·모의 지도 검사 범위의 한계이며, 계정 세션·만료·로그아웃은 별도 실제 HTTP/SQLite 검사에서 다뤘다.

최초 전체 회귀 실행에서는 비활성 탭의 클릭이 타임아웃돼 safety와 부정 검사 한 항목이 실패했다. DOM과 열려 있는 편집창이 유지된 상태를 확인했고 실제 사용자의 탭 복귀에 해당하는 `bringToFront()`만 검사에 추가한 뒤 동일 산출물로 다시 실행했다. 최초 실패 결과와 보정 diff·정상 재실행을 모두 보존했다. 성공 로그만 보고 통과로 판단하지 않고 전체 78개 번호, 하위 검사, 실행 오류, 검증 불가 목록을 결과 검증기로 다시 확인했다.

보드 stale undo는 후속 후보 메모를 덮어쓰는 실패를 재현한 뒤, 이동 직후 fingerprint와 현재 스냅샷이 같을 때만 되돌리도록 수정해 통과했다. 추가 검사에서는 열린 편집창이 있을 때 최신본 열기·BYOK 시작을 막는 동작과 미전송 계정 변경의 JSON 백업 포함 여부를 확인했다. JSON 백업 복원 경로의 보호 조건은 소스에 구현돼 있으나 이 추가 검사에서 복원까지 실행했다고 주장하지 않는다. 독립 시각 검토는 이 제품 소스에서 새로 만든 기본 화면 30개와 추가 보호 상태 3개를 직접 확인했다.

계정 결과 JSON의 최상위 경계 설명 중 Google만 언급한 표현은 축약이 불완전하다. 실제 계정 브라우저 검사는 Google OIDC와 BYOK Gemini를 모의로 사용했으며, 백엔드 문자·AI 통합 검사의 외부 제공업체도 모의다. 로컬 HTTP와 SQLite만 실제로 실행했다. 원시 JSON은 변경하지 않고 이 범위를 명시한다.

Gitleaks 원시 exit code는 오탐 때문에 1이었으므로 이를 “원시 발견 0 / exit 0”으로 보고하지 않는다. 검출된 값은 `backendHashes.api.js`의 파일 SHA256이며 root 또는 검토 작업 폴더의 실제 `backend/api.js` 바이트로 재계산해 일치를 확인했다. root와 검토 폴더의 줄바꿈 차이로 두 digest가 기록돼 있다. 확인된 비밀 노출은 0건이며 전체 원시 결과는 마스킹해 보존했다. 이후 `.gitleaks.toml`은 기본 규칙을 유지하면서 `generic-api-key` 규칙에서 확인된 두 SHA256 메타데이터 행과 세 증거 경로가 동시에 일치할 때만 허용한다. 같은 경로의 다른 digest와 다른 경로의 같은 digest는 실제 합성 검사에서 계속 탐지됐다. 이 설정으로 다시 실행한 소스·전체 이력 검사는 각각 발견 0, exit 0이다. [설정 적용 결과](evidence/rebuild/final-da6ab5e/gitleaks-configured-summary.json), [허용 경계 검사](evidence/rebuild/final-da6ab5e/gitleaks-allowlist-probe-summary.json).

## 최종 Lighthouse 측정과 성능 한계

| 프로필 | Performance | Accessibility | Best Practices | SEO | LCP | TBT | CLS |
|---|---:|---:|---:|---:|---:|---:|---:|
| 모바일, 412×823 / CPU 4배 | 54 | 100 | 96 | 100 | 4.96초 | 1253ms | 0.0675 |
| 데스크톱, 1350×940 / CPU 1배 | 89 | 100 | 96 | 100 | 1.81초 | 140ms | 0.0233 |

[측정 설정·결과](evidence/rebuild/final-da6ab5e/lighthouse/results.json), [실행 보고서](evidence/rebuild/final-da6ab5e/qa-report.md). Lighthouse 13.5.0 Node API를 실제 격리 Chromium에 연결해 Windows 로컬 production 정적 산출물을 측정했다. 운영 필드 데이터나 여러 회차 중앙값이 아니다. 모바일 성능 100은 달성하지 못했고 관측된 성능 한계로 남는다. 이 재구현을 성능 점검까지 모두 완료된 운영 출시 승인으로 해석하면 안 된다. 정적 서버의 `/api/session` 404가 Best Practices 점수에 영향을 줬다. 최초 데스크톱 의도 실행이 실제로는 모바일 설정이었던 결과도 보존했으며, 데스크톱 수치에서는 제외했다.

## 초기·중간 검사 기록

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

이 표는 초기·중간 실행의 시간순 기록이다. 첫 통합 산출물의 `revision=d48d89f`는 커밋 전 HEAD 표시이며 원본 코드와 동일하다는 뜻이 아니다. 최종 판정의 근거는 위 최종 검증 결과와 제품 소스 `da6ab5e`의 새 증거다.

중간 빌드 `a395c9c2f2118a82`에는 이후 추가한 편집창 보호 조건이 포함되지 않았다. 최종 `c59f564a0c63efe6`에는 해당 소스가 반영돼 있으며, 실제 추가 검사 범위는 위 최종 결과에 명시했다.

## 검증 구분

로컬 HTTP와 SQLite를 사용하는 통합 검사는 실제 저장과 요청 경계를 검사한다. 외부 Google OAuth·Twilio·AI를 대체한 경우에는 제공업체 모의 검사로 기록한다. 실제 로그인·문자 수신·AI 청구 검증과 구분한다. 브라우저 자동화는 별도 컨텍스트와 테스트 여행만 사용하며 기존 사용자의 브라우저 데이터는 사용하지 않는다.

기존 78개 부정 테스트의 과거 결과는 재사용하지 않는다. 새로 실행했다면 해당 빌드와 결과 파일을 함께 기록한다. 항목 40, 50, 59, 67, 69, 71, 72, 75의 기존 검증 불가 수용은 통과로 바꾸지 않는다. 실행하지 않은 검사는 미실행으로 남긴다.

재구현에서는 계정이 추가되어 기존 5번의 “계정 기능 없음” 판정은 더 이상 유효하지 않다. 게스트·모의 지도 전용 78개 검사에서는 인증 세션을 구성하지 않으므로 5번을 검증 불가로 표시하고, 계정 동작은 별도 HTTP/SQLite·브라우저 검사로 검증한다. CI는 이 9개 검증 불가와 나머지 항목의 오류 없음을 요구한다. 최종 전체 재실행은 위의 별도 원시 결과에 기록된 69 통과·9 검증 불가다. 모든 항목을 통과했다고 해석하지 않는다.

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
