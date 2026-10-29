// Gera ícones da PWA a partir da marca existente (ponto + traço lima sobre preto).
import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('public', { recursive: true });
const mark = (size, scale, bg = '#10110F', radius = 0) => {
  const s = size * scale / 18.4;                       // largura útil da marca = 18.4 unidades
  const tx = size / 2 - 11.8 * s, ty = size / 2 - 12 * s;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="${bg}"/><g transform="translate(${tx} ${ty}) scale(${s})"><circle cx="6" cy="12" r="3.4" fill="#D5FF40"/><rect x="12" y="10.3" width="9" height="3.4" rx="1.7" fill="#D5FF40"/></g></svg>`);
};
await sharp(mark(192, 0.58)).png().toFile('public/pwa-192.png');
await sharp(mark(512, 0.58)).png().toFile('public/pwa-512.png');
await sharp(mark(512, 0.42)).png().toFile('public/pwa-maskable-512.png');   // área segura de 80% p/ máscara
await sharp(mark(180, 0.58)).png().toFile('public/apple-touch-icon.png');
writeFileSync('public/favicon.svg', mark(64, 0.7, '#10110F', 14).toString());
console.log('ícones gerados');
