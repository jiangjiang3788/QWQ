const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
assert(['2.14-R2', '2.14-R3', '2.14-R4', '2.14-R5', '2.14-R6', '2.14-R7', '2.14-R8', '2.14-R8.1', '2.14-R9', '2.15-R0A', '2.15-R0B'].includes(read('VERSION.txt').trim()));

function sandbox() {
  const box = {
    console, Date, Math, JSON, Map, Set, Array, String, Number, Boolean, Object, Error, Promise,
    setTimeout, clearTimeout, queueMicrotask,
    window: null,
    document: { addEventListener() {}, querySelectorAll: () => [] },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; }
  };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(read('js/features/memory/kernel.js'), box, { filename: 'kernel.js' });
  vm.runInContext(read('js/features/memory/write_coordinator.js'), box, { filename: 'write_coordinator.js' });
  vm.runInContext(read('js/features/memory/write_gateway.js'), box, { filename: 'write_gateway.js' });
  return box;
}

(async () => {
  const box = sandbox();
  const Gateway = box.OvoMemoryKernel.require('writeGateway');
  assert.strictEqual(Gateway.VERSION, '2.14-R2');
  const recorded = [];
  box.OVOOperationRuntime = {
    recordMutations(id, items) { recorded.push({ id, items }); return items; }
  };

  const chat = { id: 'gate-chat', memoryTables: { data: { tpl: { table: { field: 'old' } } }, history: [] } };
  let writes = 0;
  const result = await Gateway.run(chat, {
    reason: 'gate-test', source: 'manual-test', operationId: 'op-1', writer: async () => { writes += 1; }
  }, () => {
    chat.memoryTables.data.tpl.table.field = 'new';
    return {
      changed: true,
      changes: [{ templateId: 'tpl', tableId: 'table', fieldId: 'field', label: '测试字段', oldValue: 'old', newValue: 'new' }]
    };
  });
  assert.strictEqual(writes, 1);
  assert.strictEqual(result.receipt.schemaVersion, 'memory-write-receipt.v1');
  assert.strictEqual(result.receipt.producerVersion, '2.14-R2');
  assert.strictEqual(result.receipt.recordCount, 1);
  assert.strictEqual(result.receipt.fieldCount, 1);
  assert.strictEqual(result.receipt.persisted, true);
  assert.strictEqual(result.receipt.operationId, 'op-1');
  assert.strictEqual(recorded.length, 1);
  assert.strictEqual(recorded[0].items[0].entityType, 'structured_memory');

  const noop = await Gateway.run(chat, { reason: 'noop', writer: async () => { writes += 1; } }, () => ({ changed: false, status: 'noop' }));
  assert.strictEqual(noop.receipt.status, 'noop');
  assert.strictEqual(noop.receipt.recordCount, 0);
  assert.strictEqual(writes, 1);

  const before = JSON.stringify(chat.memoryTables);
  await assert.rejects(() => Gateway.run(chat, {
    reason: 'rollback', writer: async () => { throw new Error('save failed'); }, persistRollback: false
  }, () => {
    chat.memoryTables.data = { broken: true };
    return { changed: true };
  }), error => error.memoryRollbackApplied === true);
  assert.strictEqual(JSON.stringify(chat.memoryTables), before);

  // Domain is the formal data mutation layer used beneath the gateway.
  const domainBox = sandbox();
  domainBox.db = { memoryTableTemplates: [], characters: [] };
  domainBox.window.db = domainBox.db;
  vm.runInContext(read('js/features/memory/domain.js'), domainBox, { filename: 'domain.js' });
  const Domain = domainBox.OvoMemoryKernel.require('domain');
  const table = { id: 't', name: '记忆', mode: 'rows', columns: [{ id: 'content', key: '内容', type: 'longtext', default: '' }] };
  const template = { id: 'tpl', name: '模板', tables: [table] };
  domainBox.db.memoryTableTemplates = [template];
  const domainChat = { id: 'domain-chat', memoryTables: { boundTemplateIds: ['tpl'] } };
  Domain.ensureMemoryTableState(domainChat);
  Domain.ensureTemplateDataForChat(domainChat, template);
  const row = Domain.addRow(domainChat, 'tpl', table, { content: 'A' }, { source: 'manual' });
  const tagResult = Domain.setRowTagBundle(domainChat, 'tpl', table, row.id, { topic: ['边界'], scene: [], entity: [], effect: 'boundary' }, { skipHistory: true });
  assert.strictEqual(tagResult.changed, true);
  assert.deepStrictEqual(Array.from(tagResult.row.meta.tagBundle.topic), ['边界']);
  assert.strictEqual(Domain.replaceFormalData(domainChat, { replacement: true }, { skipHistory: true }), true);
  assert.strictEqual(domainChat.memoryTables.data.replacement, true);

  const html = read('index.html');
  const contract = JSON.parse(read('architecture/memory_domains.json'));
  assert(html.indexOf('write_coordinator.js') < html.indexOf('write_gateway.js'));
  assert(html.indexOf('write_gateway.js') < html.indexOf('candidate_service.js'));
  assert(contract.publicFacades.memoryFoundationDomain.owns.includes('writeGateway'));
  assert.strictEqual(contract.formalWriteGate.gateway, 'writeGateway');
  ['js/modules/memory_table.js', 'js/features/memory/table_editor.js', 'js/features/memory/candidate_service.js', 'js/features/memory/sidecar_candidate_controller.js'].forEach(rel => {
    const source = read(rel);
    assert(source.includes('writeGateway') || source.includes('MemoryWriteGateway'), `${rel} missing write gateway`);
    assert(!/(?:MemoryWriteCoordinator|WriteCoordinator)\.run\(/.test(source), `${rel} bypasses gateway`);
  });
  const controller = (read('js/modules/memory_table.js') + '\n' + read('js/features/memory/review_orchestrator.js') + '\n' + read('js/features/memory/package_orchestrator.js'));
  assert(!/chat\.memoryTables\.data(?:\[[^\]]+\])*\s*=/.test(controller), 'controller directly replaces formal memory data');
  assert(controller.includes('replaceFormalData(chat, batch.beforeSnapshot'));
  assert(controller.includes('replaceTemplateData(chat, template.id, remapped.data'));

  execFileSync('python', ['tools/check_memory_architecture.py'], { cwd: root, stdio: 'pipe' });
  console.log('V2.14-R2 MEMORY WRITE GATE CHECKS: PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
