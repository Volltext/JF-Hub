// Erzeugt das App-Symbol (Apple-Stil) in allen benötigten Formen aus einer SVG-Beschreibung:
//  - assets/*.png         Quellen für @capacitor/assets (Android) und Startbild
//  - public/*             Favicon, Apple-Touch-Icon, PWA-Symbole, Manifest (App-Web-Client)
//  - ../jf-hub-server/public/admin/*  dasselbe für die Admin-GUI
// Aufruf: npm run assets   (= dieses Skript + capacitor-assets generate --android)
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const S = 1024;

// Symbol: Hub – drei konzentrische rote Ringe auf Graphit.
const defs = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a3d46"/>
      <stop offset="1" stop-color="#15161b"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0" r="0.9">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.18"/>
      <stop offset="0.7" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="white" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#e9e9ee"/>
    </linearGradient>
    <linearGradient id="red" gradientUnits="userSpaceOnUse" x1="0" y1="165" x2="0" y2="859">
      <stop offset="0" stop-color="#ff5a4a"/>
      <stop offset="1" stop-color="#d1232b"/>
    </linearGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#000000" flood-opacity="0.35"/>
    </filter>
  </defs>`;

// Zwei Fassungen: transparent (Launcher, Favicon, Oberfläche) und auf klarem Schwarz (iOS/PWA-Verknüpfungen, die keine Transparenz erlauben).
const BLACK = '#000000';
const plate = `<rect width="${S}" height="${S}" fill="${BLACK}"/>`;

// scale: Symbol verkleinern (Mitte des Symbols liegt bei 512/512)
const ring = (r, w) => `<circle cx="512" cy="512" r="${r}" fill="none" stroke="url(#red)" stroke-width="${w}"/>`;
const flame = (scale = 1, shadow = true) => `
  <g transform="translate(512 512) scale(${scale}) translate(-512 -512)"${shadow ? ' filter="url(#shadow)"' : ''}>
    ${ring(312, 60)}${ring(198, 56)}${ring(90, 52)}
  </g>`;

const svg = (inner, size = S, vb = S) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${vb} ${vb}">${defs}${inner}</svg>`);

const out = async (buf, file, size) => {
  await sharp(buf).resize(size, size).png().toFile(file);
};

mkdirSync('assets', { recursive: true });
mkdirSync('public', { recursive: true });

// ---- Android-Quellen: kein Hintergrund ----
await out(svg(flame(1.05)), 'assets/icon-only.png', S);
// Adaptiv: Vordergrund muss in die inneren ~66 % passen; Hintergrund bleibt durchsichtig.
await out(svg(flame(0.92)), 'assets/icon-foreground.png', S);
await out(svg(''), 'assets/icon-background.png', S);

// ---- Startbild: Symbol frei auf dem Grund der App ----
const splash = (bg) => {
  const t = 1200;
  const o = (2732 - t) / 2;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="2732" height="2732" viewBox="0 0 2732 2732">${defs}` +
      `<rect width="2732" height="2732" fill="${bg}"/><g transform="translate(${o} ${o}) scale(${t / S})">${flame(1, false)}</g></svg>`,
  );
};
await sharp(splash('#0e0f12')).png().toFile('assets/splash.png');
await sharp(splash('#0e0f12')).png().toFile('assets/splash-dark.png');

// ---- Web ----
const bare = svg(flame(1.05, false)); // Favicon und Oberflächen-Symbol: ohne Grund, ohne Schatten
const onBlack = (scale) => svg(plate + flame(scale, false));

const webFiles = async (dir) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/favicon.svg`, bare.toString());
  await out(bare, `${dir}/favicon-32.png`, 32);
  await out(onBlack(0.92), `${dir}/icon-192.png`, 192);
  await out(onBlack(0.92), `${dir}/icon-512.png`, 512);
  await out(onBlack(0.92), `${dir}/apple-touch-icon.png`, 180); // iOS rundet selbst
  await out(onBlack(0.78), `${dir}/icon-maskable-512.png`, 512); // sicherer Bereich für Masken
};
await webFiles('public');
await webFiles('../jf-hub-server/public/admin');

const manifest = (name, start, scope) =>
  JSON.stringify(
    {
      name,
      short_name: 'JF Hub',
      start_url: start,
      scope,
      display: 'standalone',
      background_color: '#0e0f12',
      theme_color: '#0e0f12',
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    null,
    2,
  );
writeFileSync('public/manifest.webmanifest', manifest('JF Hub', '/', '/'));
writeFileSync('../jf-hub-server/public/admin/manifest.webmanifest', manifest('JF Hub – Server', '/admin/', '/admin/'));

console.log('Symbole erzeugt');
