/* ============================================================
   Gerador dos ícones PNG do PWA — sem dependências externas.

     node tools/gen-icons.js

   Desenha o mesmo símbolo do icons/icon.svg (garfo + faca) por
   funções de distância, com antialiasing, e codifica o PNG na mão
   (zlib do próprio Node). Rode de novo se mudar a cor da marca.
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const VERDE = [0x16, 0x69, 0x4a];
const BRANCO = [0xff, 0xff, 0xff];
const SAIDA = path.join(__dirname, '..', 'icons');

/* ───────────── Funções de distância (SDF) ───────────── */

function sdRoundedRect(px, py, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(px - cx) - (halfW - r);
  const qy = Math.abs(py - cy) - (halfH - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Cápsula: segmento (ax,ay)–(bx,by) engrossado com raio r. */
function sdCapsule(px, py, ax, ay, bx, by, r) {
  const pax = px - ax, pay = py - ay;
  const bax = bx - ax, bay = by - ay;
  const denom = bax * bax + bay * bay;
  const h = denom === 0 ? 0 : Math.max(0, Math.min(1, (pax * bax + pay * bay) / denom));
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
}

/** Cápsula de raio variável (lâmina afilada), amostrada ao longo do segmento. */
function sdTapered(px, py, ax, ay, ra, bx, by, rb, passos = 96) {
  let d = Infinity;
  for (let i = 0; i <= passos; i++) {
    const t = i / passos;
    const cx = ax + (bx - ax) * t;
    const cy = ay + (by - ay) * t;
    const r = ra + (rb - ra) * t;
    d = Math.min(d, Math.hypot(px - cx, py - cy) - r);
  }
  return d;
}

/* ───────────── Desenho ───────────── */

/**
 * @param {number} tamanho  lado do PNG em pixels
 * @param {boolean} maskable  true → fundo sangrado e símbolo menor,
 *                            para caber na zona segura de 80% do Android
 */
function desenhar(tamanho, maskable) {
  const buf = Buffer.alloc(tamanho * tamanho * 4);
  const S = tamanho / 512;                 // escala do sistema de 512
  const escalaGlifo = maskable ? 0.72 : 1; // encolhe o símbolo no maskable
  const raioFundo = maskable ? 0 : 112 * S;

  // Coordenadas do símbolo no espaço 512, medidas a partir do centro.
  const centro = 256;
  const G = (v) => centro + (v - centro) * escalaGlifo;
  const E = (v) => v * escalaGlifo * S;    // espessuras

  const traco = E(11);                     // meia-espessura do traço (22 no SVG)

  const px = (x) => G(x) * S;

  function glifoDist(x, y) {
    let d = Infinity;

    // ── Garfo ──
    // três dentes
    for (const dx of [151, 186, 221]) {
      d = Math.min(d, sdCapsule(x, y, px(dx), px(116), px(dx), px(194), traco));
    }
    // base dos dentes (barra) + pescoço arredondado
    d = Math.min(d, sdCapsule(x, y, px(151), px(194), px(221), px(194), traco));
    d = Math.min(d, sdTapered(x, y, px(151), px(200), traco, px(186), px(232), traco));
    d = Math.min(d, sdTapered(x, y, px(221), px(200), traco, px(186), px(232), traco));
    // cabo
    d = Math.min(d, sdCapsule(x, y, px(186), px(232), px(186), px(396), traco));

    // ── Faca ──
    // lâmina: afila da ponta até a base
    d = Math.min(d, sdTapered(x, y, px(340), px(120), traco * 0.85, px(372), px(215), traco));
    d = Math.min(d, sdTapered(x, y, px(372), px(215), traco, px(340), px(258), traco));
    // cabo
    d = Math.min(d, sdCapsule(x, y, px(340), px(120), px(340), px(396), traco));

    return d;
  }

  for (let y = 0; y < tamanho; y++) {
    for (let x = 0; x < tamanho; x++) {
      const cx = x + 0.5, cy = y + 0.5;

      const dFundo = sdRoundedRect(cx, cy, tamanho / 2, tamanho / 2, tamanho / 2, tamanho / 2, raioFundo);
      const aFundo = Math.max(0, Math.min(1, 0.5 - dFundo));

      const aGlifo = Math.max(0, Math.min(1, 0.5 - glifoDist(cx, cy)));

      // branco sobre verde, tudo multiplicado pela máscara do fundo
      const r = VERDE[0] + (BRANCO[0] - VERDE[0]) * aGlifo;
      const g = VERDE[1] + (BRANCO[1] - VERDE[1]) * aGlifo;
      const b = VERDE[2] + (BRANCO[2] - VERDE[2]) * aGlifo;

      const i = (y * tamanho + x) * 4;
      buf[i] = Math.round(r);
      buf[i + 1] = Math.round(g);
      buf[i + 2] = Math.round(b);
      buf[i + 3] = Math.round(aFundo * 255);
    }
  }

  return buf;
}

/* ───────────── Codificação PNG ───────────── */

const TABELA_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(tipo, dados) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([len, corpo, crc]);
}

function paraPng(rgba, tamanho) {
  // Cada scanline recebe um byte de filtro (0 = None) na frente.
  const bruto = Buffer.alloc(tamanho * (tamanho * 4 + 1));
  for (let y = 0; y < tamanho; y++) {
    bruto[y * (tamanho * 4 + 1)] = 0;
    rgba.copy(bruto, y * (tamanho * 4 + 1) + 1, y * tamanho * 4, (y + 1) * tamanho * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tamanho, 0);
  ihdr.writeUInt32BE(tamanho, 4);
  ihdr[8] = 8;   // bits por canal
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // filtro adaptativo
  ihdr[12] = 0;  // sem entrelaçamento

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(bruto, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ───────────── Execução ───────────── */

const alvos = [
  { arquivo: 'icon-192.png', tamanho: 192, maskable: false },
  { arquivo: 'icon-512.png', tamanho: 512, maskable: false },
  { arquivo: 'icon-maskable-512.png', tamanho: 512, maskable: true }
];

fs.mkdirSync(SAIDA, { recursive: true });

for (const alvo of alvos) {
  const png = paraPng(desenhar(alvo.tamanho, alvo.maskable), alvo.tamanho);
  fs.writeFileSync(path.join(SAIDA, alvo.arquivo), png);
  console.log(`${alvo.arquivo.padEnd(24)} ${String(png.length).padStart(7)} bytes`);
}
