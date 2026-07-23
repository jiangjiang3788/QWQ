const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const html = read('index.html');
const settings = read('js/settings.js');
const api = read('js/features/settings/api_controller.js');
const magic = read('js/features/settings/magic_room.js');
const presets = read('js/features/settings/presets.js');
const customization = read('js/features/settings/customization.js');
const manager = read('js/features/settings/preset_manager.js');
const facade = read('js/features/settings/facade.js');
const components = read('js/core/ui_components.js');
const css = read('css/components/settings_components.css');

assert(/^(?:V2\.9-R(?:[4-9]|1[01])|V?2\.(?:10-R(?:[01]|2(?:\.1)?|3(?:\.[123])?|4|5|6)|11-R(?:[0124567]|3(?:\.1)?)|12-R(?:[0-4]|5(?:\.[123])?)))$/.test(read('VERSION.txt').trim()), 'release compatibility version mismatch');
for (const file of [
  'js/core/ui_components.js',
  'js/features/settings/magic_room.js',
  'js/features/settings/api_controller.js',
  'js/features/settings/presets.js',
  'js/features/settings/customization.js',
  'js/features/settings/preset_manager.js',
  'js/features/settings/facade.js'
]) assert(html.includes(file), `script not loaded: ${file}`);
assert(html.includes('css/core/ui_tokens.css'), 'UI tokens stylesheet missing');
assert(html.includes('css/components/settings_components.css'), 'settings components stylesheet missing');
assert(settings.split('\n').length < 3000, 'settings.js was not reduced below 3000 lines');
assert(!settings.includes('function setupApiSettingsApp('), 'API controller still lives in settings.js');
assert(!settings.includes('function setupCustomizeApp('), 'customization controller still lives in settings.js');
assert(api.includes('function setupApiSettingsApp('), 'API controller extraction missing');
assert(magic.includes('function setupMagicRoomApp('), 'magic room extraction missing');
assert(presets.includes('function setupPresetFeatures('), 'preset controller extraction missing');
assert(customization.includes('function setupCustomizeApp('), 'customization extraction missing');
assert(manager.includes('function installOverrides()'), 'preset manager override installer missing');
for (const name of ['openApiManageModal','openManagePresetsModal','openManageMyPersonaModal','openFontManageModal','openGlobalCssManageModal','openSoundManageModal','openVoicePresetManageModal','openIconPresetManageModal','openNamePresetManageModal','openTTSManageModal']) {
  assert(manager.includes(`global.${name} =`), `unified preset manager missing ${name}`);
}
assert(!presets.includes('function openManagePresetsModal('), 'legacy bubble preset modal implementation still present');
assert(!api.includes('function openApiManageModal('), 'legacy API preset modal implementation still present');
assert(components.includes('renderActionList'), 'shared action list component missing');
assert(css.includes('.ui-action-row'), 'shared action row style missing');
assert(facade.includes('global.OvoSettings'), 'settings facade missing');
console.log('V2.9-R4 SETTINGS COMPONENTS CHECKS: PASS');
