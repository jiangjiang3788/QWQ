(function (global) {
    'use strict';
    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    Kernel.register('memoryFoundationDomain', Object.freeze({
        VERSION: '2.15-R0B',
        memoryDefaults: Kernel.require('memoryDefaults'),
        fieldSemantics: Kernel.require('fieldSemantics'),
        api: Kernel.require('api'),
        domain: Kernel.require('domain'),
        recordIdentity: Kernel.require('recordIdentity'),
        packageAdapter: Kernel.require('packageAdapter'),
        schemaMigrator: Kernel.require('schemaMigrator'),
        packageOrchestrator: Kernel.require('packageOrchestrator'),
        writeCoordinator: Kernel.require('writeCoordinator'),
        writeGateway: Kernel.require('writeGateway'),
        fieldWidth: Kernel.require('fieldWidth'),
        workspace: Kernel.require('workspace')
    }));
})(window);
