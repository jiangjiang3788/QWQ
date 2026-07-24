(function (global) {
    'use strict';
    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    Kernel.register('memoryFoundationDomain', Object.freeze({
        VERSION: '2.14-R6',
        api: Kernel.require('api'),
        domain: Kernel.require('domain'),
        packageAdapter: Kernel.require('packageAdapter'),
        packageOrchestrator: Kernel.require('packageOrchestrator'),
        writeCoordinator: Kernel.require('writeCoordinator'),
        writeGateway: Kernel.require('writeGateway'),
        fieldWidth: Kernel.require('fieldWidth'),
        workspace: Kernel.require('workspace')
    }));
})(window);
