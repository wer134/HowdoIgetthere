// KML 내보내기 — 구글 내 지도(My Maps)·구글 어스에서 불러와 공유할 수 있다

function xml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]
  ));
}

// KML 색은 #RRGGBB가 아니라 aabbggrr 순서
function kmlColor(hex) {
  const h = hex.replace('#', '');
  return `ff${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`;
}

/**
 * @param {object} o
 * @param {string} o.title 문서 이름
 * @param {Array} o.items 위치가 정해진 행들
 * @param {(category: string) => string} o.colorOf 분류 → #RRGGBB
 * @param {(item: object) => Array<[string, string]>} o.fieldsOf 행 → [열 이름, 값] 목록
 * @param {Array<{category: string, name: string, description: string, path: Array<[number, number]>}>} [o.lines] 이동 경로
 */
export function buildKml({ title, items, colorOf, fieldsOf, lines = [] }) {
  const categories = [...new Set([...items.map((it) => it.category), ...lines.map((l) => l.category)])];
  const styles = categories.map((cat, i) => `
    <Style id="s${i}">
      <IconStyle>
        <color>${kmlColor(colorOf(cat))}</color>
        <Icon><href>https://maps.google.com/mapfiles/kml/paddle/wht-blank.png</href></Icon>
      </IconStyle>
      <LineStyle>
        <color>${kmlColor(colorOf(cat))}</color>
        <width>4</width>
      </LineStyle>
    </Style>`).join('');

  const lineString = (line, styleIndex) => `
      <Placemark>
        <name>${xml(line.name)}</name>
        ${line.description ? `<description>${xml(line.description)}</description>` : ''}
        <styleUrl>#s${styleIndex}</styleUrl>
        <LineString>
          <tessellate>1</tessellate>
          <coordinates>${line.path.map(([lat, lng]) => `${lng},${lat},0`).join(' ')}</coordinates>
        </LineString>
      </Placemark>`;

  const placemark = (it, styleIndex) => {
    const fields = fieldsOf(it);
    const description = [it.memo, it.place.address].filter(Boolean).join('\n');
    return `
      <Placemark>
        <name>${xml(it.name)}</name>
        ${description ? `<description>${xml(description)}</description>` : ''}
        <styleUrl>#s${styleIndex}</styleUrl>
        <ExtendedData>${fields.map(([k, v]) => `
          <Data name="${xml(k)}"><value>${xml(v)}</value></Data>`).join('')}
        </ExtendedData>
        <Point><coordinates>${it.place.lng},${it.place.lat},0</coordinates></Point>
      </Placemark>`;
  };

  const folders = categories.map((cat, i) => `
    <Folder>
      <name>${xml(cat || '분류 없음')}</name>${items.filter((it) => it.category === cat).map((it) => placemark(it, i)).join('')}${lines.filter((l) => l.category === cat).map((l) => lineString(l, i)).join('')}
    </Folder>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${xml(title)}</name>${styles}${folders}
  </Document>
</kml>
`;
}
