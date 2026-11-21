// The one-command check reads the results of other test runs; this is how it reads them.
import assert from 'node:assert/strict';
import test from 'node:test';
import { failedTests, testCounts } from '../scripts/verify.mjs';

test('test counts are read from either reporter of node:test', () => {
  assert.deepEqual(testCounts('✔ a (1ms)\nℹ tests 165\nℹ suites 0\nℹ pass 164\nℹ fail 1\nℹ cancelled 0\n'), { tests: 165, pass: 164, fail: 1 });
  assert.deepEqual(testCounts('ok 1 - a\n# tests 4\n# suites 0\n# pass 4\n# fail 0\n'), { tests: 4, pass: 4, fail: 0 });
  assert.equal(testCounts('Segmentation fault'), null, 'a run without a summary has no counts');
  assert.equal(testCounts('ℹ tests 3\nℹ pass 3\n'), null, 'half a summary is not one');
});

test('each failed test is named once', () => {
  const spec = '✖ the room opens (12.5ms)\n✔ other (1ms)\nℹ tests 2\n✖ failing tests:\n\ntest at a.ts:1:1\n✖ the room opens (12.5ms)\n  AssertionError\n';
  assert.deepEqual(failedTests(spec), ['the room opens']);
  assert.deepEqual(failedTests('not ok 2 - a guest joins\nok 3 - fine\n'), ['a guest joins']);
  assert.deepEqual(failedTests('ℹ tests 1\nℹ pass 1\nℹ fail 0\n'), []);
});
