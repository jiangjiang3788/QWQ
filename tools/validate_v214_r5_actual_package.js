const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const inputPath = path.resolve(process.argv[2] || '/mnt/data/阿沉_memory_package_逻辑收敛修正版.json');
const outputPath = path.resolve(process.argv[3] || path.join(root, 'docs/V2.14-R5_实际记忆包有效策略验证.json'));
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');

const originalBytes = fs.readFileSync(inputPath);
const originalHash = hash(originalBytes);
const pkg = JSON.parse(originalBytes.toString('utf8'));
const template = clone((pkg.templates || [])[0]);
if (!template) throw new Error('实际记忆包没有模板');

const box = {
  console, Date, Math, JSON, Map, Set, Array, String, Number, Boolean, Object, Error, Promise,
  setTimeout, clearTimeout, queueMicrotask,
  window: null,
  document: { addEventListener() {}, querySelectorAll: () => [] }
};
box.window = box;
vm.createContext(box);
for (const rel of [
  'js/features/memory/kernel.js',
  'js/modules/memory_table_policy.js',
  'js/features/memory/policy_resolver.js'
]) vm.runInContext(read(rel), box, { filename: rel });

const Resolver = box.OvoMemoryKernel.require('policyResolver');
const chat = { id: 'actual-package-policy-validation', memoryTables: clone(pkg.binding || {}) };
chat.memoryTables.engineSettings = {
  ...(chat.memoryTables.engineSettings || {}),
  enabled: true,
  triggerMode: 'messages',
  roundInterval: 3,
  messageInterval: 60,
  maxSourceMessages: 120,
  overlapMessages: 5
};

const templateBefore = JSON.stringify(template);
const formalBefore = JSON.stringify(chat.memoryTables.data || {});
const formalHashBefore = hash(formalBefore);
const tableCount = (template.tables || []).length;
const fieldCount = (template.tables || []).reduce((sum, table) => sum + (table.columns || []).length, 0);
const rowCount = Object.values(chat.memoryTables.data || {}).reduce((total, templateData) => total + Object.values(templateData || {}).reduce((sum, tableData) => sum + (Array.isArray(tableData?.__rows) ? tableData.__rows.length : 0), 0), 0);

const initial = (template.tables || []).map(table => Resolver.resolve(chat, template.id, table));
if (initial.some(item => item.hasRoleOverride)) throw new Error('旧包不应预先含有 R5 角色覆盖');
const medium = (template.tables || []).find(table => Resolver.resolve(chat, template.id, table).effective.systemRole === 'medium_summary');
if (!medium) throw new Error('没有找到中期总结表');

const overrideDraft = Resolver.cloneTemplateOverrides(chat, template.id);
Resolver.updateOverrideDraft(overrideDraft, template, medium.id, 'capturePolicy.mode', 'scheduled');
Resolver.updateOverrideDraft(overrideDraft, template, medium.id, 'capturePolicy.frequencySource', 'global');
Resolver.updateOverrideDraft(overrideDraft, template, medium.id, 'capturePolicy.apiMode', 'summary');
Resolver.updateOverrideDraft(overrideDraft, template, medium.id, 'commitPolicy.mode', 'direct');
Resolver.updateOverrideDraft(overrideDraft, template, medium.id, 'commitPolicy.requireUserConfirmation', false);
Resolver.updateOverrideDraft(overrideDraft, template, medium.id, 'injectionPolicy.mode', 'never');
Resolver.replaceTemplateOverrides(chat, template.id, overrideDraft, template);

const effective = Resolver.resolve(chat, template.id, medium);
if (!effective.hasRoleOverride) throw new Error('当前角色覆盖没有生效');
if (effective.effective.capturePolicy.mode !== 'scheduled') throw new Error('采集方式覆盖失败');
if (effective.effective.capturePolicy.frequencySource !== 'global') throw new Error('全局频率来源覆盖失败');
if (effective.effective.updatePolicy.triggerMode !== 'messages' || effective.effective.updatePolicy.messageInterval !== 60) throw new Error('全局周期默认没有进入最终策略');
if (effective.effective.commitPolicy.mode !== 'direct') throw new Error('写入方式覆盖失败');
if (effective.effective.injectionPolicy.mode !== 'never') throw new Error('召回方式覆盖失败');
if (effective.sourceSummary.schedule !== 'global') throw new Error('周期来源解释错误');
if (effective.sourceSummary.commit !== 'role' || effective.sourceSummary.injection !== 'role') throw new Error('角色覆盖来源解释错误');
if (JSON.stringify(template) !== templateBefore) throw new Error('角色覆盖修改了模板');
if (JSON.stringify(chat.memoryTables.data || {}) !== formalBefore) throw new Error('角色覆盖修改了正式记忆');

const resetDraft = Resolver.cloneTemplateOverrides(chat, template.id);
Resolver.resetTableOverrideDraft(resetDraft, medium.id);
Resolver.replaceTemplateOverrides(chat, template.id, resetDraft, template);
const reset = Resolver.resolve(chat, template.id, medium);
if (reset.hasRoleOverride) throw new Error('恢复模板默认后仍残留角色覆盖');
if (JSON.stringify(template) !== templateBefore) throw new Error('恢复模板默认修改了模板');
if (JSON.stringify(chat.memoryTables.data || {}) !== formalBefore) throw new Error('恢复模板默认修改了正式记忆');

const result = {
  version: '2.14-R5',
  input: path.basename(inputPath),
  templateCount: (pkg.templates || []).length,
  tableCount,
  fieldCount,
  rowCount,
  initialRoleOverrideCount: initial.filter(item => item.hasRoleOverride).length,
  testedTable: medium.name,
  effectiveOverride: {
    captureMode: effective.effective.capturePolicy.mode,
    frequencySource: effective.effective.capturePolicy.frequencySource,
    triggerMode: effective.effective.updatePolicy.triggerMode,
    messageInterval: effective.effective.updatePolicy.messageInterval,
    commitMode: effective.effective.commitPolicy.mode,
    injectionMode: effective.effective.injectionPolicy.mode,
    sources: effective.sourceSummary
  },
  resetToTemplate: !reset.hasRoleOverride,
  templateUnchanged: JSON.stringify(template) === templateBefore,
  formalDataHashBefore: formalHashBefore,
  formalDataHashAfter: hash(JSON.stringify(chat.memoryTables.data || {})),
  formalDataUnchanged: JSON.stringify(chat.memoryTables.data || {}) === formalBefore,
  sourcePackageUnchanged: hash(fs.readFileSync(inputPath)) === originalHash
};
if (result.formalDataHashBefore !== result.formalDataHashAfter) throw new Error('正式记忆哈希发生变化');
if (!result.sourcePackageUnchanged) throw new Error('源记忆包被修改');
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
