const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

assert(['2.13-R0', '2.13-R1', '2.13-R4', '2.13-R5', '2.13-R5.1', '2.13-R5.2'].includes(read('VERSION.txt').trim()));
const html = read('index.html');
const registrySource = read('js/core/api_service_registry.js');
const controller = read('js/features/settings/api_controller.js');
const ui = read('js/modules/api_settings_ui.js');
const uiCss = read('css/api_settings_v161.css');
const vectorMemory = read('js/modules/vector_memory.js');
const retrieval = read('js/modules/memory_table_retrieval.js');
const fieldWidth = read('js/features/memory/field_width.js');
const tableGrid = read('js/features/memory/table_grid.js');
const tableCss = read('css/modules/memory_table_flat.css');

assert(html.includes('js/core/api_service_registry.js'));
assert(html.indexOf('js/core/api_service_registry.js') < html.indexOf('js/features/settings/api_controller.js'));
assert(html.indexOf('js/core/api_service_registry.js') < html.indexOf('js/modules/memory_table_retrieval.js'));
assert(html.indexOf('js/core/api_service_registry.js') < html.indexOf('js/modules/vector_memory.js'));
assert(html.includes('必须使用支持 Embeddings 的模型，不再回退到聊天或总结模型'));
assert(html.includes('测试并保存向量 API'));
assert(!ui.includes('api-ui-nav'));
assert(!uiCss.includes('.api-ui-nav'));
assert(!ui.includes('主聊天</button>'));
assert(controller.includes('registry.testEmbedding(config)'));
assert(controller.includes("health: 'ready'"));
assert(controller.includes("health: 'error'"));
assert(controller.includes("enabled: false"));
assert(controller.includes("prefix === 'vector' ? '预设已应用，请测试并保存后启用。'"));
assert(vectorMemory.includes("registry.require('vector', { allowFallback: false })"));
assert(vectorMemory.includes('registry.embed(texts'));
assert(retrieval.includes("isReady('vector')"));
assert(retrieval.includes('registry.embed(texts'));
assert(!vectorMemory.includes('/v1/embeddings'));
assert(!retrieval.includes('/v1/embeddings'));
assert(fieldWidth.includes('measureText'));
assert(fieldWidth.includes('desktop: clamp(desktopTextWidth + 34, 116, 260)'));
assert(tableGrid.includes('FieldWidth.keyValueLabels'));
assert(tableGrid.includes('title="${Core.escapeAttribute(field.key)}"'));
assert(tableCss.includes('white-space:nowrap'));
assert(tableCss.includes('text-overflow:ellipsis'));

const context = {
  window: {
    db: {
      apiSettings: { url: 'https://chat.example', key: 'chat-key', model: 'chat-model' },
      summaryApiSettings: {},
      vectorApiSettings: {}
    }
  },
  console,
  URL,
  fetch: async () => { throw new Error('network should not be called in this check'); }
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(registrySource, context);
const registry = context.window.OVOApiServiceRegistry;
assert(registry);
assert.strictEqual(registry.resolve('vector'), null, 'vector role must not fall back to chat');
assert.throws(() => registry.require('vector'), /不能回退到聊天或总结模型/);
assert.strictEqual(registry.endpointFor({ url: 'https://api.example.com', provider: 'newapi' }, 'embedding'), 'https://api.example.com/v1/embeddings');
assert.strictEqual(registry.endpointFor({ url: 'https://api.example.com/v1', provider: 'newapi' }, 'embedding'), 'https://api.example.com/v1/embeddings');
assert.strictEqual(registry.endpointFor({ url: 'https://api.example.com/v1/embeddings', provider: 'newapi' }, 'embedding'), 'https://api.example.com/v1/embeddings');
assert.strictEqual(registry.endpointFor({ url: 'https://api.example.com/v1', provider: 'newapi' }, 'models'), 'https://api.example.com/v1/models');
assert.strictEqual(registry.endpointFor({ url: 'https://generativelanguage.googleapis.com/v1beta', provider: 'gemini', key: 'key', model: 'text-embedding-004' }, 'embedding'), 'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=key');
assert.deepStrictEqual(Array.from(registry.validateVectors([[1, 2], [3, 4]], 2).vectors[0]), [1, 2]);
assert.throws(() => registry.validateVectors([], 1), /返回数量异常/);
assert.throws(() => registry.validateVectors([[1], [1, 2]], 2), /维度不一致/);
context.window.db.vectorApiSettings = { url: 'https://api.example.com/v1', key: 'key', model: 'text-embedding-3-small' };
assert.strictEqual(registry.isReady('vector'), false, 'legacy unverified vector config must remain disabled until a real test succeeds');
context.window.db.vectorApiSettings = { url: 'https://api.example.com/v1', key: 'key', model: 'text-embedding-3-small', health: 'error', enabled: false };
assert.strictEqual(registry.isReady('vector'), false);
context.window.db.vectorApiSettings = { url: 'https://api.example.com/v1', key: 'key', model: 'text-embedding-3-small', health: 'ready', enabled: true, verifiedDimension: 1536 };
assert.strictEqual(registry.isReady('vector'), true);
assert.strictEqual(registry.health('vector').state, 'ready');

console.log('V2.13-R0 API / VECTOR ARCHITECTURE CHECKS: PASS');
