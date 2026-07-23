(function (global) {
    'use strict';
    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    Kernel.register('memoryFoundationDomain', Object.freeze({
        VERSION: '2.12-R4',
        api: Kernel.require('api'),
        domain: Kernel.require('domain'),
        workspace: Kernel.require('workspace')
    }));
})(window);
