const fs = require('node:fs');
const path = require('node:path');

// Backport Expo's application-context fix (expo/expo#49498) to SDK 55.
// A ReactContext can be collected after background/headless execution, leaving
// TaskService.getSharedPreferences() null. Android's Application lives for the
// process lifetime and is the appropriate owner of task persistence.
const before = 'mContextRef = new WeakReference<>(context);';
const after = 'mContextRef = new WeakReference<>(context.getApplicationContext());';
function patchSource(source) {
  if (source.includes(after) && !source.includes(before)) return source;
  if (source.split(before).length !== 2) {
    throw Error('Unexpected expo-task-manager source. Review the Android context patch before building.');
  }
  return source.replace(before, after);
}
function applyPatch() {
  const root = path.dirname(require.resolve('expo-task-manager/package.json'));
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  if (version !== '55.0.20') throw Error(`Review the Android context patch for expo-task-manager ${version}`);
  const file = path.join(root, 'android/src/main/java/expo/modules/taskManager/TaskService.java');
  const source = fs.readFileSync(file, 'utf8');
  const patched = patchSource(source);
  if (patched !== source) fs.writeFileSync(file, patched);
  console.log('Android TaskService application-context fix verified.');
}
if (require.main === module) applyPatch();
module.exports = {patchSource, applyPatch};
