import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// What a screen reader hears of the Game files tab (D87, D90).
const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');

test('each source is read once, and the memory notice of a ZIP is announced', () => {
  const radios = html.match(/<input type="radio" name="disc-source"[^>]*>/g) ?? [];
  assert.equal(radios.length, 3);
  // The help sits inside each radio's label, so it is already part of its name.
  for (const radio of radios) assert.doesNotMatch(radio, /aria-describedby/);
  assert.match(html, /<p [^>]*id="disc-held"[^>]*aria-live="polite"/);
  assert.match(html, /<p [^>]*id="disc-selection"[^>]*role="status"/);
});
