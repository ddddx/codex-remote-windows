import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePort, resolveTargetPort } from '../scripts/free-port.mjs';

test('parsePort accepts positive numeric ports only', () => {
  assert.equal(parsePort('18637'), 18637);
  assert.equal(parsePort(18737), 18737);
  assert.equal(parsePort(''), null);
  assert.equal(parsePort('0'), null);
  assert.equal(parsePort('abc'), null);
});

test('resolveTargetPort prefers explicit argv over environment', () => {
  assert.equal(
    resolveTargetPort(['node', 'scripts/free-port.mjs', '18737'], { PORT: '18637' }),
    18737,
  );
});

test('resolveTargetPort uses PORT environment when argv has no port', () => {
  assert.equal(
    resolveTargetPort(['node', 'scripts/free-port.mjs'], { PORT: '18737' }),
    18737,
  );
});
