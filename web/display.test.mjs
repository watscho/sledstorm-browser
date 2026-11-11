import test from 'node:test';
import assert from 'node:assert/strict';
import { enableSessionDisplay } from './display.js';

test('a manual filter change still updates Custom when the requested shader falls back', () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const events = new Map();
  const filter = {
    options: ['crisp', 'clean', 'crt'].map(value => ({ value })),
    value: 'clean',
    addEventListener: (name, action) => events.set(name, action),
    closest: () => ({}),
  };
  const screenshot = { addEventListener() {} };
  const remembered = [];
  const notices = [];
  try {
    globalThis.document = { querySelector: selector => selector === '#live-filter' ? filter : screenshot };
    globalThis.window = { addEventListener() {} };
    enableSessionDisplay({ enableShader(value) { if (value === 'crt') throw new Error('Shader unavailable'); } },
      'clean', { clean: {}, crt: {} }, text => notices.push(text), value => remembered.push(value));
    assert.deepEqual(remembered, [], 'initial setup must not count as a manual edit');
    filter.value = 'crt';
    events.get('change')();
    assert.equal(filter.value, 'crisp');
    assert.deepEqual(remembered, ['crisp'], 'the graphics owner must receive the effective manual choice');
    assert.match(notices.at(-1), /Crisp pixels/);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
