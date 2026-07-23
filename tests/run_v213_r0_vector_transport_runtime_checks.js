const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/core/api_service_registry.js'), 'utf8');
const calls = [];
const windowMock = {
  db: {
    vectorApiSettings: {
      provider: 'newapi', protocol: 'openai-compatible', url: 'https://gateway.example/v1', key: 'secret',
      model: 'text-embedding-test', batchSize: 2, enabled: true, health: 'ready', verifiedDimension: 3
    }
  },
  OVOAIRequestRuntime: {
    async request(options) {
      calls.push(options);
      const inputs = Array.isArray(options.body.input) ? options.body.input : [options.body.input];
      return new Response(JSON.stringify({
        data: inputs.map((text, index) => ({ index, embedding: [text.length, index + 1, 0.5] }))
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  }
};
windowMock.window = windowMock;
const context = vm.createContext({ window: windowMock, console, Response, fetch, URL, Date, Math, JSON, Number, String, Array, Object, Set, Map, Promise });
vm.runInContext(source, context);
const registry = windowMock.OVOApiServiceRegistry;

(async () => {
  const vectors = await registry.embed(['a', 'bb', 'ccc']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(vectors)), [[1, 1, 0.5], [2, 2, 0.5], [3, 1, 0.5]]);
  assert.strictEqual(calls.length, 2, 'batch size must be applied centrally');
  assert(calls.every(call => call.endpoint === 'https://gateway.example/v1/embeddings'), 'endpoint must not contain /v1/v1');
  assert(calls.every(call => call.headers.Authorization === 'Bearer secret'));
  assert.strictEqual(calls[0].operationType, 'memory.vector.embedding');

  const draft = { provider: 'newapi', url: 'https://gateway.example/v1', key: 'secret', model: 'text-embedding-test' };
  const result = await registry.testEmbedding(draft);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.dimension, 3);
  assert.strictEqual(result.endpoint, 'https://gateway.example/v1/embeddings');
  assert.strictEqual(calls.at(-1).task, 'vector-embedding-test');
  console.log('V2.13-R0 VECTOR TRANSPORT RUNTIME CHECKS: PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
