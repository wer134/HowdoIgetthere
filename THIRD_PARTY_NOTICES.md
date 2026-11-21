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

Google Fonts를 통해 Manrope, Noto Sans KR, DM Mono를 불러옵니다. 이 글꼴들은 SIL Open Font License 1.1로 배포됩니다. 예시 코스 화면에는 Noto Sans KR의 한글 서브셋을 함께 배포합니다. 저작권 표기와 OFL 전문은 이 문서 하단에 있습니다.

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

## Noto Sans KR

The locally hosted homepage font is a Korean glyph subset of Noto Sans KR distributed by [Google Fonts](https://fonts.google.com/noto/specimen/Noto+Sans+KR). Its license follows.

Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
