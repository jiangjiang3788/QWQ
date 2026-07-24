const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const inputPath = path.resolve(process.argv[2] || '/mnt/data/阿沉_memory_package_逻辑收敛修正版.json');
const outputPath = path.resolve(process.argv[3] || path.join(root, 'docs/V2.14-R6_实际记忆包行为等价验证.json'));
const hashFile = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const originalHash = hashFile(inputPath);
const r4Path = path.join(root, 'docs/V2.14-R6_检索行为等价子验证.json');
const r5Path = path.join(root, 'docs/V2.14-R6_策略行为等价子验证.json');

execFileSync(process.execPath, [path.join(root, 'tools/validate_v214_r4_actual_package.js'), inputPath, r4Path], { cwd: root, stdio: 'pipe' });
execFileSync(process.execPath, [path.join(root, 'tools/validate_v214_r5_actual_package.js'), inputPath, r5Path], { cwd: root, stdio: 'pipe' });

const r4 = JSON.parse(fs.readFileSync(r4Path, 'utf8'));
const r5 = JSON.parse(fs.readFileSync(r5Path, 'utf8'));
const contract = JSON.parse(fs.readFileSync(path.join(root, 'architecture/memory_domains.json'), 'utf8'));
const controllerLines = fs.readFileSync(path.join(root, 'js/modules/memory_table.js'), 'utf8').split(/\r?\n/).length;
const pkg = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const result = {
  version: '2.14-R6',
  input: path.basename(inputPath),
  templateCount: (pkg.templates || []).length,
  tableCount: (pkg.templates || []).reduce((sum, template) => sum + (template.tables || []).length, 0),
  fieldCount: (pkg.templates || []).reduce((sum, template) => sum + (template.tables || []).reduce((inner, table) => inner + (table.columns || []).length, 0), 0),
  rowCount: r4.rowCount,
  controller: {
    beforeLines: 3989,
    afterLines: controllerLines,
    reducedLines: 3989 - controllerLines,
    budget: contract.budgets['js/modules/memory_table.js']
  },
  extractedUseCases: {
    retrieval: 'js/features/memory/retrieval_orchestrator.js',
    review: 'js/features/memory/review_orchestrator.js',
    package: 'js/features/memory/package_orchestrator.js'
  },
  retrievalEquivalent: r4.formalDataHashBefore === r4.formalDataHashAfter && r4.keywordRetrieval?.pureRead === true,
  policyEquivalent: r5.formalDataHashBefore === r5.formalDataHashAfter && r5.resetToTemplate === true,
  formalDataHashBefore: r4.formalDataHashBefore,
  formalDataHashAfter: r4.formalDataHashAfter,
  sourcePackageHashBefore: originalHash,
  sourcePackageHashAfter: hashFile(inputPath),
  sourcePackageUnchanged: originalHash === hashFile(inputPath)
};
if (!result.retrievalEquivalent) throw new Error('召回行为等价验证失败');
if (!result.policyEquivalent) throw new Error('策略行为等价验证失败');
if (!result.sourcePackageUnchanged) throw new Error('源记忆包被修改');
if (controllerLines > result.controller.budget) throw new Error('主控制器超过 R6 行预算');
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
