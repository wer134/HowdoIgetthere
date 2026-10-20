// 앱 설정 (선택). 비워 두면 화면에서 API 키를 입력받습니다.
window.APP_CONFIG = {
  // 키를 여기에 넣으면 키 입력칸이 사라집니다. 인터넷에 공개 배포할 때는
  // Google Cloud 콘솔에서 반드시 "HTTP 리퍼러" 제한을 걸어 내 사이트에서만 쓰이게 하세요.
  googleMapsApiKey: '',

  // 지도 ID. DEMO_MAP_ID는 시험용이므로, 오래 쓸 거라면 콘솔(지도 관리)에서 만든 ID로 바꾸세요.
  mapId: 'DEMO_MAP_ID',

  // 검색 결과 언어와 우선 지역
  language: 'ko',
  region: 'kr',

  // 동시에 보내는 검색 요청 수
  concurrency: 4,
};
