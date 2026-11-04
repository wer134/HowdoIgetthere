# 최종 검증 증거

제품 소스: da6ab5eac497b278f73d9e728282cbf99d37337c. 자산: c59f564a0c63efe6. 원시 실패와 정상 재실행 모두 보존한다. regressions/의 최초 safety·negative 실패를 clean-tab-activation/의 정상 실행으로 대체해 숨기지 않았다. 전체 결과 검증기는 마지막 negative JSON의 78개 번호·하위 검사·오류·검증 불가 경계를 실제 확인했다. closeout-verification.json 참고.

원시 account/extra 결과의 최상위 Google-only 경계 축약은 불완전하다. BYOK Gemini도 모의이며 외부 OIDC·SMS·AI 실제 운영 검증을 뜻하지 않는다. 원시 결과는 수정하지 않았다.

repro/*.source.txt는 실행 당시 보조 스크립트 원본이다. 재실행하려면 저장소 루트의 .omo/evidence/final-da6ab5e/에 원래 .cjs 이름으로 복사한다(상대 import의 원래 위치). 저장소 루트에서 npm ci와 npm run build를 먼저 실행하고 CHROMIUM_PATH를 Playwright Chromium 실행 파일로 지정한다. 법적 안내는 legal.cjs, 추가 계정 보호는 extra-guards.cjs, Lighthouse Node API는 lighthouse.cjs이다. 재현 실행은 새 테스트 DB와 격리 컨텍스트를 사용하며 현재 결과를 새 실행 결과로 오인하면 안 된다.

Gitleaks 초기 raw 소스3/이력1은 SHA256 메타데이터 오탐으로 확인했다. 마스킹 원시 보고서와 실제 파일 바이트 비교 근거를 보존했다. .gitleaks.toml은 기본 탐지를 유지하는 매우 좁은 규칙별 허용이며, 실제 경계 합성 검사와 설정 적용 후 소스·이력0건 결과를 별도 보존했다.

Lighthouse는 모바일54·데스크톱89 Performance이며100이 아니다. 정적 localhost 검사이고 운영 필드 성능이 아니다. 잘못된 프로필로 실행된 초기 mobile-repeat도 보관하되 canonical results.json의 데스크톱 점수에는 포함하지 않았다.
