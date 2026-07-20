const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function assert(condition, message) { if (!condition) throw new Error(message); }

(async () => {
    let tick = 0;
    const context = {
        window: null,
        console: { log() {}, info() {}, warn() {}, error() {} },
        Date,
        Error,
        ReferenceError,
        Promise,
        setInterval: () => 101,
        setTimeout: () => 202,
        performance: { now: () => ++tick }
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(read('js/core/startup_runtime.js'), context);

    const runtime = context.OvoStartupRuntime;
    assert(runtime && /^2\.9-R[78]$/.test(runtime.VERSION), 'startup runtime missing');
    runtime.reset();
    await runtime.run('success-task', async () => 'ok');
    await runtime.call('missing-optional-task', [], { optional: true });
    await runtime.run('isolated-failure', () => { throw new Error('isolated'); });

    let criticalThrown = false;
    try {
        await runtime.run('critical-failure', () => { throw new Error('critical'); }, { critical: true });
    } catch (_) {
        criticalThrown = true;
    }
    assert(criticalThrown, 'critical startup failure should propagate');

    const report = runtime.complete();
    assert(report.summary.success === 1, 'successful startup task not recorded');
    assert(report.summary.skipped === 1, 'missing optional startup task should be skipped');
    assert(report.summary.failed === 2, 'startup failures not isolated and recorded');

    const html = read('index.html');
    const main = read('js/main.js');
    const memory = read('js/modules/memory_table.js');
    assert(html.includes('js/core/startup_runtime.js'), 'startup runtime script not loaded');
    assert(html.indexOf('js/core/startup_runtime.js') < html.indexOf('js/main.js'), 'startup runtime must load before main');
    assert(!/\bupdateClock\s*\(/.test(main), 'retired clock call still blocks startup');
    assert(main.includes("StartupRuntime.call('initDatabase'"), 'database startup is not routed through runtime');
    assert(main.includes("StartupRuntime.startInterval('auto-reply-check'"), 'runtime interval guard missing');

    const initializerBlock = main.match(/const orderedInitializers = \[(.*?)\];/s);
    assert(initializerBlock, 'ordered startup initializer contract missing');
    const initializerNames = [...initializerBlock[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
    const jsCorpus = fs.readdirSync(path.join(root, 'js'), { recursive: true })
        .filter(name => name.endsWith('.js') && name !== 'main.js')
        .map(name => fs.readFileSync(path.join(root, 'js', name), 'utf8'))
        .join('\n');
    initializerNames.forEach(name => {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const declared = new RegExp(`function\\s+${escaped}\\b`).test(jsCorpus)
            || new RegExp(`(?:window|global)\\.${escaped}\\s*=`).test(jsCorpus)
            || new RegExp(`${escaped}\\s*:`).test(jsCorpus);
        assert(declared || name === 'setupGlobalRescueGesture', `startup initializer has no implementation or export: ${name}`);
    });

    const retiredMemoryRoute = ['manage', 'settings'].join('_');
    assert(!memory.includes(retiredMemoryRoute), 'removed legacy memory route still exists');

    console.log('V2.9-R7 STARTUP RELIABILITY CHECKS: PASS');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
