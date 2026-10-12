import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPwaInstall } from '../../public/js/pwa.js';
import { decodePng } from '../../tools/crop-board-atlas.mjs';
function rig(standalone = false) {
  const win = new EventTarget(), display = new EventTarget();
  display.matches = standalone;
  win.matchMedia = () => display;
  const pwa = createPwaInstall(win);
  const offer = (outcome = 'dismissed', fail = false) => {
    let calls = 0;
    const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = async () => { calls++; if (fail) throw Error('unavailable'); return { outcome }; };
    win.dispatchEvent(e);
    return { calls: () => calls, e };
  };
  return { pwa, win, display, offer };
}
test('install offer is consumed even on dismissal, duplicate clicks, or rejected prompt', async () => {
  const { pwa, offer } = rig();
  const states = []; const off = pwa.subscribe((x) => states.push(x));
  assert.equal(pwa.available(), false);
  const first = offer();
  assert.equal(first.e.defaultPrevented, true);
  assert.equal(pwa.available(), true);
  const a = pwa.request(), b = pwa.request();
  assert.equal(await a, false); assert.equal(await b, false); assert.equal(first.calls(), 1);
  const broken = offer('accepted', true);
  assert.equal(await pwa.request(), false); assert.equal(await pwa.request(), false); assert.equal(broken.calls(), 1);
  const next = offer('accepted');
  assert.equal(await pwa.request(), true); assert.equal(next.calls(), 1);
  assert.deepEqual(states, [false, true, false, true, false, true, false]);
  off(); pwa.dispose();
});
test('installed / standalone hides stale offers; disposing removes listeners', async () => {
  const { pwa, win, display, offer } = rig();
  offer(); display.matches = true; display.dispatchEvent(new Event('change'));
  assert.equal(pwa.available(), false); assert.equal(await pwa.request(), false);
  display.matches = false; win.dispatchEvent(new Event('appinstalled')); offer();
  assert.equal(pwa.available(), false);
  pwa.dispose();
  assert.equal(offer().e.defaultPrevented, false);
  const native = rig(true); native.offer(); assert.equal(native.pwa.available(), false); native.pwa.dispose();
});
test('manifest provides opaque community-logo 192/512 icons for both purposes with a safe maskable mark', () => {
  const m = JSON.parse(readFileSync(new URL('../../public/manifest.json', import.meta.url)));
  assert.equal(m.start_url, '/'); assert.equal(m.scope, '/');
  assert.deepEqual(m.icons.map((i) => `${i.purpose}:${i.sizes}`).sort(),
    ['any:192x192', 'any:512x512', 'maskable:192x192', 'maskable:512x512']);
  for (const icon of m.icons) {
    assert.ok(icon.src.startsWith('/icons/'));
    assert.equal(icon.type, 'image/png');
    const bytes = readFileSync(new URL('../../public' + icon.src, import.meta.url));
    const size = Number(icon.sizes.split('x')[0]);
    const { w, h, rgba } = decodePng(bytes);
    assert.equal(w, size); assert.equal(h, size);
    let foreground = 0, mint = 0, white = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      assert.equal(rgba[i + 3], 255, 'opaque edge-to-edge');
      const [r, g, b] = rgba.subarray(i, i + 3);
      if (Math.max(r, g, b) < 64) continue; // Dark square background and export padding.
      if (g > 120 && g > r * 1.4 && b > 70) mint++;
      if (r > 160 && g > 160 && b > 160) white++;
      foreground++;
      if (icon.purpose === 'maskable') {
        // W3C safe zone is a circle, not merely a centred 80% square.
        const dx = x + 0.5 - w / 2, dy = y + 0.5 - h / 2;
        assert.ok(dx * dx + dy * dy <= (size * 0.4) ** 2, `clipped mark at ${x},${y}`);
      }
    }
    assert.ok(foreground > size * size * (icon.purpose === 'maskable' ? 0.02 : 0.08), 'the exported logo is visible');
    assert.ok(mint > size * size * 0.003, 'the green title is retained');
    assert.ok(white > size * size * 0.003, 'the white emblem and title are retained');
  }
});

test('game and login share valid PNG favicon and Apple touch links', () => {
  let expected;
  for (const file of ['index.html', 'auth/index.html']) {
    const html = readFileSync(new URL('../../public/' + file, import.meta.url), 'utf8');
    const links = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]+>/g)].map(([s]) => s);
    assert.equal(links.length, 3);
    const paths = [];
    for (const link of links) {
      const href = link.match(/href="([^"]+)"/)[1]; paths.push(href);
      assert.ok(href.startsWith('/icons/community-logo-'));
      const { w, h } = decodePng(readFileSync(new URL('../../public' + href, import.meta.url)));
      assert.ok(link.includes(`sizes="${w}x${h}"`), href);
    }
    if (expected) assert.deepEqual(paths, expected);
    expected = paths;
  }
});
