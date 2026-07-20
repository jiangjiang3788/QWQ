const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function assert(condition, message) { if (!condition) throw new Error(message); }

(async () => {
    let lexicalCalls = 0;
    const context = {
        window: null,
        __OCTOPUS_STARTUP_TASKS__: {
            loadData: async () => { lexicalCalls += 1; return 'loaded'; }
        },
        console: { log() {}, info() {}, warn() {}, error() {} },
        Date,
        Error,
        TypeError,
        ReferenceError,
        Promise,
        Object,
        Map,
        setInterval: () => 101,
        setTimeout: () => 202,
        performance: { now: () => Date.now() }
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(read('js/core/startup_runtime.js'), context);

    const runtime = context.OvoStartupRuntime;
    assert(runtime && runtime.VERSION === '2.9-R8', 'R8 startup runtime missing');
    assert(runtime.has('loadData'), 'pending lexical startup task not imported');
    assert(typeof context.loadData === 'undefined', 'test contract invalid: loadData must not be a window property');
    runtime.validate(['loadData'], { critical: true });
    const result = await runtime.call('loadData', [], { critical: true, optional: false });
    assert(result === 'loaded' && lexicalCalls === 1, 'registered lexical task was not called');

    runtime.register('lateTask', () => 'late');
    assert(runtime.resolve('lateTask')(), 'late task registration failed');

    let missingThrown = false;
    try { runtime.validate(['missingCore'], { critical: true }); } catch (_) { missingThrown = true; }
    assert(missingThrown, 'missing critical startup contract should fail preflight');

    const db = read('js/db.js');
    const main = read('js/main.js');
    assert(db.includes('window.__OCTOPUS_STARTUP_TASKS__'), 'data layer startup contract export missing');
    assert(db.includes('coreDataStartupTasks') && db.includes('initDatabase, loadData'), 'critical data tasks are not explicitly registered');
    assert(main.includes("StartupRuntime.validate(['initDatabase', 'loadData']"), 'critical startup preflight missing');
    assert(!main.includes("const fn = window[name];"), 'fallback runtime still only resolves window properties');

    console.log('V2.9-R8 STARTUP CONTRACT CHECKS: PASS');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
