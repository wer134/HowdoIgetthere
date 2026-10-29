# 외부 라이브러리·서비스 고지

이 문서는 RouteFlow가 사용하는 주요 외부 소프트웨어와 서비스의 출처를 안내합니다. 프로젝트 자체의 라이선스와는 별개입니다.

## 배포 파일에 포함된 라이브러리

| 구성 요소 | 사용 목적 | 라이선스 및 출처 |
|---|---|---|
| SheetJS Community Edition 0.20.3 (`vendor/xlsx.full.min.js`) | 엑셀 읽기·쓰기 | Apache License 2.0 · [프로젝트](https://sheetjs.com/) · [라이선스 전문](vendor/SheetJS-APACHE-2.0.txt) |
| Anthropic TypeScript SDK 0.131.0 (`vendor/anthropic-sdk-0.131.0.min.js`) | Claude API 호출 | MIT · [프로젝트](https://github.com/anthropics/anthropic-sdk-typescript) · [저작권 및 라이선스 전문](vendor/anthropic-sdk-LICENSE.txt) |

SheetJS 배포 파일의 저작권 표기: `xlsx.js (C) 2013-present SheetJS -- http://sheetjs.com`.

Anthropic SDK의 저작권 표기: `Copyright 2023 Anthropic, PBC.` 기존 배포 파일에 포함된 고지와 라이선스 전문을 유지합니다.

배포 파일을 교체하거나 다시 번들링할 때에는 해당 버전 및 포함된 의존성의 LICENSE·NOTICE도 함께 확인하고 보존해야 합니다. 이 목록은 모든 전이 의존성의 고지를 완전히 감사했다는 의미는 아닙니다.

## 웹에서 불러오는 글꼴

Google Fonts를 통해 Manrope, Noto Sans KR, DM Mono를 불러옵니다. 이 글꼴들은 SIL Open Font License 1.1로 배포됩니다. 현재 저장소에는 글꼴 파일을 복사해 포함하지 않습니다. 향후 자체 호스팅 시에는 해당 글꼴 배포본의 저작권 표기와 OFL 전문도 포함해야 합니다.

- [Manrope](https://fonts.google.com/specimen/Manrope)
- [Noto Sans KR](https://fonts.google.com/noto/specimen/Noto+Sans+KR)
- [DM Mono](https://fonts.google.com/specimen/DM+Mono)

## Google Maps Platform 및 외부 API

Google Maps Platform은 이 프로젝트의 오픈소스 라이브러리 라이선스로 배포되는 자료가 아닙니다. 지도·장소·사진·리뷰는 Google의 이용 조건과 해당 콘텐츠 권리자의 권리를 따릅니다. 지도상의 Google 표기와 제공되는 사진·리뷰 출처 표기를 유지해야 합니다.

- [Google Maps Platform 이용약관](https://cloud.google.com/maps-platform/terms)
- [Places API 정책](https://developers.google.com/maps/documentation/places/web-service/policies)
- [Places 사진 안내](https://developers.google.com/maps/documentation/places/web-service/place-photos)

Place ID, 좌표, 장소 설명, 사진, 리뷰, 경로 결과는 저장 허용 조건이 같지 않습니다. 현재 코드의 보관 기간이 서비스 약관상 허용 기간을 보증하지는 않습니다. 실제 운영 전 사용 API·필드별로 저장 및 재사용 조건을 확인해야 합니다.

OpenAI, Anthropic, Google Gemini API를 이용할 때에는 선택한 제공업체의 API 이용 조건과 결제 정책이 별도로 적용됩니다.
