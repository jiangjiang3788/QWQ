const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const version = read('VERSION.txt').trim();
const html = read('index.html');
const settings = read('js/settings.js');
const facade = read('js/features/settings/facade.js');
const files = {
  context: 'js/features/settings/character/context.js',
  profile: 'js/features/settings/character/profile_controller.js',
  media: 'js/features/settings/character/media_controller.js',
  extensions: 'js/features/settings/character/extensions_controller.js',
  behavior: 'js/features/settings/character/behavior_controller.js',
  chat: 'js/features/settings/character/chat_controller.js'
};

assert(/^V2\.9-R[56]$/.test(version), 'release version mismatch');
for (const rel of Object.values(files)) assert(fs.existsSync(path.join(root, rel)), `missing ${rel}`);
const ordered = Object.values(files).map(rel => html.indexOf(rel)).concat(html.indexOf('js/settings.js'));
assert(ordered.every(pos => pos >= 0), 'character controller script missing from index');
assert(ordered.every((pos, index) => index === 0 || ordered[index - 1] < pos), 'character controller script order invalid');
assert(settings.split('\n').length < 500, 'settings.js was not reduced below 500 lines');
assert(settings.includes('OvoCharacterSettings.setupAll()'), 'setup compatibility facade missing');
assert(settings.includes('OvoCharacterSettings.loadAll(character)'), 'load compatibility facade missing');
assert(settings.includes('OvoCharacterSettings.saveAll(character)'), 'save compatibility facade missing');
assert(!settings.includes("setting-char-avatar-upload')?.addEventListener"), 'media setup still lives in settings.js');
assert(!settings.includes("setting-phone-control-enabled"), 'behavior setup still lives in settings.js');

const sources = Object.fromEntries(Object.entries(files).map(([name, rel]) => [name, read(rel)]));
assert(sources.context.includes('function register(name, controller)'), 'controller registry missing');
assert(sources.context.includes('setupComplete'), 'idempotent setup guard missing');
assert(sources.profile.includes("runtime.register('profile'"), 'profile controller registration missing');
assert(sources.profile.includes('setting-char-real-name'), 'profile mapping missing');
assert(sources.chat.includes("runtime.register('chat'"), 'chat controller registration missing');
assert(sources.chat.includes('setting-sync-group-memory'), 'chat memory controls missing');
assert(sources.behavior.includes("runtime.register('behavior'"), 'behavior controller registration missing');
assert(sources.behavior.includes('setting-phone-control-enabled'), 'phone control mapping missing');
assert(sources.media.includes("runtime.register('media'"), 'media controller registration missing');
assert(sources.media.includes('setting-char-avatar-upload'), 'avatar media setup missing');
assert(sources.extensions.includes("runtime.register('extensions'"), 'extensions controller registration missing');
assert(sources.extensions.includes('setting-regex-filter-enabled'), 'extension mapping missing');
assert(facade.includes("const VERSION = '2.9-R5'"), 'settings facade version mismatch');
assert(facade.includes('OvoCharacterSettings?.health'), 'character health integration missing');

// The registry itself is pure enough to execute with a minimal browser-like context.
const sandbox = { window: {}, console };
sandbox.window.window = sandbox.window;
sandbox.window.db = { characters: [{ id: 'c1' }] };
sandbox.window.currentChatId = 'c1';
vm.runInNewContext(sources.context, sandbox);
const runtime = sandbox.window.OvoCharacterSettings;
assert(runtime.VERSION === '2.9-R5', 'character runtime version mismatch');
for (const name of ['profile', 'chat', 'behavior', 'media', 'extensions']) {
  runtime.register(name, { setup() {}, load() {}, async save() {} });
}
assert(runtime.health().ok === true, 'character runtime health check failed');
assert(runtime.getCurrentCharacter().id === 'c1', 'current character resolution failed');

console.log('V2.9-R5 CHARACTER SETTINGS CHECKS: PASS');
