const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {patchSource,applyPatch} = require('../scripts/fix-task-manager-context.cjs');

test('SDK 55 native source receives only the application-context lifetime fix', () => {
  const root = path.dirname(require.resolve('expo-task-manager/package.json'));
  const file = path.join(root, 'android/src/main/java/expo/modules/taskManager/TaskService.java');
  const installed = fs.readFileSync(file,'utf8');
  const original = installed.replace('mContextRef = new WeakReference<>(context.getApplicationContext());','mContextRef = new WeakReference<>(context);');
  const patched = patchSource(original);
  assert.notEqual(patched, original);
  assert.equal(patched.replace('context.getApplicationContext()', 'context'), original);
  assert.equal(patchSource(patched), patched);
  applyPatch();
  assert.equal(fs.readFileSync(file,'utf8'), patched);
});
test('unknown dependency source fails instead of silently dropping the fix', () => {
  assert.throws(() => patchSource('different native implementation'), /Unexpected/);
});
