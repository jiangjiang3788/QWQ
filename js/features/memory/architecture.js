(function (global) {
    'use strict';
    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');

    const DOMAIN_MODULES = Object.freeze({
        platform: Object.freeze(['memoryPlatformDomain']),
        foundation: Object.freeze(['memoryFoundationDomain']),
        tables: Object.freeze(['memoryTablesDomain']),
        governance: Object.freeze(['memoryGovernanceDomain']),
        retrieval: Object.freeze(['memoryRetrievalDomain']),
        schema: Object.freeze(['memorySchemaDomain']),
        update: Object.freeze(['memoryUpdateDomain'])
    });
    const REQUIRED = Object.freeze(Object.values(DOMAIN_MODULES).flat());

    function snapshot() {
        const health = Kernel.health(REQUIRED);
        return Object.freeze({
            version: '2.12-R4',
            healthy: health.ok,
            missing: health.missing.slice(),
            domains: Object.fromEntries(Object.entries(DOMAIN_MODULES).map(([name, modules]) => [name, {
                modules: modules.slice(),
                loaded: modules.every(moduleName => Kernel.has(moduleName))
            }])),
            loadedModuleCount: health.loaded.length
        });
    }

    function assertHealthy() {
        const state = snapshot();
        if (!state.healthy) throw new Error(`记忆领域未完整加载：${state.missing.join(', ')}`);
        return state;
    }

    Kernel.register('memoryArchitecture', Object.freeze({
        VERSION: '2.12-R4',
        domains: DOMAIN_MODULES,
        required: REQUIRED,
        snapshot,
        assertHealthy
    }));
})(window);
