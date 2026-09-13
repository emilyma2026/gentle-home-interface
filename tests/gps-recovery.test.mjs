import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/app/index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('function startGps(){'), html.indexOf('var IC = {'));

test('unavailable GPS does not restart and write on every render', async () => {
  let starts = 0, writes = 0;
  const context = {
    App: { route: 'elder' }, St: { loc: {} }, D: {},
    ensureHomePointFromAddress: () => Promise.resolve(), applyGpsPosition() {},
    queueUpdate(fn) { writes++; fn(context.St); },
    render() { if (starts < 20) context.startGps(); },
    window: { Navigation: {
      isWatching: () => false,
      start(_success, failure) { starts++; failure({ code: 'unsupported' }); },
      stop() {},
    } },
  };
  vm.runInNewContext(source, context);
  context.startGps();
  for (let i = 0; i < 30; i++) await Promise.resolve();
  assert.equal(starts, 1);
  assert.equal(writes, 1);
  context.stopGps();
  context.startGps();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(starts, 2, 'leaving and reentering allows another attempt');
  assert.equal(writes, 1, 'unchanged error status is not saved again');
});
