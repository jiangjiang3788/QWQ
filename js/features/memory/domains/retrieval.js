(function (global) {
    'use strict';
    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    Kernel.register('memoryRetrievalDomain', Object.freeze({
        VERSION: '2.12-R4',
        audit: Kernel.require('retrievalAudit')
    }));
})(window);
