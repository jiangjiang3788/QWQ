const assert = require('assert');
const path = require('path');

function resetBrowserGlobals() {
  const store = {};
  global.window = global;
  global.sessionStorage = {
    setItem(key, value) { store[key] = String(value); },
    getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; }
  };
  global.CustomEvent = function CustomEvent(name, options) { this.type = name; this.detail = options && options.detail; };
  global.dispatchEvent = () => {};
  return store;
}

{
  resetBrowserGlobals();
  require(path.join(__dirname, '../js/core/context_source_registry.js'));
  const body = {
    model: 'gemini-test',
    stream: true,
    temperature: 0.8,
    system_instruction: { parts: [{ text: '核心规则\n角色人设：Alice\n世界设定正文\n<structured_archive_memory>结构化记忆正文</structured_archive_memory>\n回复协议正文' }] },
    contents: [
      { role: 'user', parts: [{ text: '历史用户消息' }] },
      { role: 'model', parts: [{ text: '历史模型消息' }] },
      { role: 'user', parts: [{ text: '本轮用户输入' }] },
      { role: 'user', parts: [{ text: '[incipere]' }] }
    ]
  };
  const manifest = global.OVOContextSourceRegistry.buildCompiledManifest({
    provider: 'gemini',
    model: 'gemini-test',
    requestBody: body,
    promptSources: [
      { type: 'character_profile', registryId: 'character.profile', content: '角色人设：Alice', sent: true },
      { type: 'worldbook', registryId: 'worldbook.active', content: '世界设定正文', sent: true, items: [{ id: 'wb1', title: '世界条目', content: '世界设定正文', chars: 6, sent: true }] },
      { type: 'structured_memory', registryId: 'memory.structured', content: '结构化记忆正文', sent: true },
      { type: 'output_rules', registryId: 'output.chat_protocol', content: '回复协议正文', sent: true }
    ]
  });
  const byId = Object.fromEntries(manifest.sources.map(source => [source.sourceId, source]));
  assert(byId['system.core_rules'].content.includes('核心规则'));
  assert.strictEqual(byId['character.profile'].content, '角色人设：Alice');
  assert.strictEqual(byId['worldbook.active'].items[0].content, '世界设定正文');
  assert.strictEqual(byId['memory.structured'].content, '结构化记忆正文');
  assert(byId['chat.history'].content.includes('历史用户消息'));
  assert(byId['chat.history'].content.includes('历史模型消息'));
  assert(byId['chat.current_input'].content.includes('本轮用户输入'));
  assert(byId['cot.instructions'].content.includes('[incipere]'));
  assert(byId['request.parameters'].content.includes('gemini-test'));
  assert(byId['provider.wrapper'].content.includes('Gemini'));
}

{
  const store = resetBrowserGlobals();
  delete require.cache[require.resolve(path.join(__dirname, '../js/modules/operation_runtime.js'))];
  require(path.join(__dirname, '../js/modules/operation_runtime.js'));
  const operation = global.OVOOperationRuntime.start('chat.reply', { title: '最新操作' });
  const longText = '甲'.repeat(38265);
  global.OVOOperationRuntime.attachRequest(operation.id, {
    body: { model: 'gemini-test', system_instruction: { parts: [{ text: longText }] } },
    contextManifest: { sources: [{ sourceId: 'system.core_rules', included: true, chars: longText.length, content: longText, items: [] }], coverage: { complete: true } }
  });
  const saved = global.OVOOperationRuntime.get(operation.id).requests[0];
  assert.strictEqual(saved.bodyTruncated, false);
  assert(saved.bodyPreview.length > 38265);
  assert.strictEqual(saved.contextManifest.sources[0].content.length, 38265);
  const persisted = JSON.parse(store.ovo_operation_history_v1);
  assert(persisted[0].requests[0].bodyPreview.length > 38265);
  assert.strictEqual(persisted[0].requests[0].contextManifest.sources[0].content.length, 38265);
}

console.log('V5.6.3 request trace regression test passed.');
