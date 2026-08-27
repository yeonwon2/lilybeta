import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('src/index.css', 'utf8');
const manifest = JSON.parse(fs.readFileSync('public/manifest.webmanifest', 'utf8'));
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, '/');
assert.equal(manifest.scope, '/');
assert.equal(manifest.id, '/');
assert.match(html, /rel="manifest" href="\/manifest.webmanifest"/);
assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
assert.match(html, /rel="apple-touch-icon"/);
assert.match(html, /width=device-width, initial-scale=1.0/);
assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1/);
for (const icon of manifest.icons) {
  const bytes = fs.readFileSync(`public${icon.src}`);
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes);
}
assert.match(css, /font-size: max\(16px, 1em\)/);
assert.match(css, /touch-action: manipulation/);
assert.match(css, /min-height: 100svh/);
assert.doesNotMatch(css, /touch-action:\s*none/);
console.log('PASS: install metadata, icons, stable mobile sizing, accessible zoom');
