(function (global) {
    'use strict';
    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    Kernel.register('memoryFoundationDomain', Object.freeze({
        VERSION: '2.12-R5.3',
        api: Kernel.require('api'),
        domain: Kernel.require('domain'),
        fieldWidth: Kernel.require('fieldWidth'),
        workspace: Kernel.require('workspace')
    }));
})(window);
