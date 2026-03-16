/**
 * Glot! 아이콘 생성기
 * 의존성 없이 Node.js 내장 모듈만 사용 (zlib, fs)
 * 실행: node gen-icons.js
 */
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// CRC32 테이블
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len  = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const tp   = Buffer.from(type, 'ascii');
  const crc  = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tp, data])));
  return Buffer.concat([len, tp, data, crc]);
}

/**
 * 단순 원형 아이콘 PNG 생성
 * 배경: #1a1a1b (Reddit 다크), 원: #FF4500 (오렌지)
 */
function makePNG(size) {
  const W = size, H = size;

  // IHDR: RGB (colorType=2)
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(W, 0);
  ihdrData.writeUInt32BE(H, 4);
  ihdrData[8] = 8; ihdrData[9] = 2; // 8-bit RGB

  // 픽셀 그리기 — 오렌지 원 + 다크 배경 + "G" 텍스트(큰 사이즈만)
  const cx = W / 2, cy = H / 2, r = W * 0.42;
  const raw = Buffer.alloc(H * (W * 3 + 1));

  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0; // filter: None
    for (let x = 0; x < W; x++) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const off = y * (W * 3 + 1) + 1 + x * 3;

      if (dist < r) {
        // 원 내부: #FF4500
        raw[off]     = 0xFF;
        raw[off + 1] = 0x45;
        raw[off + 2] = 0x00;
      } else {
        // 배경: #1a1a1b
        raw[off]     = 0x1a;
        raw[off + 1] = 0x1a;
        raw[off + 2] = 0x1b;
      }
    }
  }

  // 원 위에 흰색 "G" 픽셀 패턴 (16×16 기준 비트맵, 큰 사이즈는 스케일업)
  // 손으로 그린 G 비트맵 (7×9 grid)
  const G_BITMAP = [
    [0,1,1,1,0,0,0],
    [1,0,0,0,1,0,0],
    [1,0,0,0,0,0,0],
    [1,0,0,1,1,1,0],
    [1,0,0,0,0,1,0],
    [1,0,0,0,0,1,0],
    [1,0,0,0,1,1,0],
    [0,1,1,1,0,0,0],
    [0,0,0,0,0,0,0],
  ];
  const GW = 7, GH = 9;
  const scale = Math.max(1, Math.floor(size / 20));
  const gx0 = Math.round(cx - (GW * scale) / 2);
  const gy0 = Math.round(cy - (GH * scale) / 2);

  for (let row = 0; row < GH; row++) {
    for (let col = 0; col < GW; col++) {
      if (!G_BITMAP[row][col]) continue;
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const px = gx0 + col * scale + sx;
          const py = gy0 + row * scale + sy;
          if (px < 0 || px >= W || py < 0 || py >= H) continue;
          const off = py * (W * 3 + 1) + 1 + px * 3;
          raw[off] = raw[off + 1] = raw[off + 2] = 0xFF; // white
        }
      }
    }
  }

  const idat = zlib.deflateSync(raw);

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    chunk('IHDR', ihdrData),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, 'icons');
for (const size of [16, 48, 128]) {
  const buf  = makePNG(size);
  const dest = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(dest, buf);
  console.log(`✓ icons/icon${size}.png  (${buf.length} bytes)`);
}
console.log('Done.');
