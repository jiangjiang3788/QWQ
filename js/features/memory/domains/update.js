(function (global) {
    'use strict';
    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    Kernel.register('memoryUpdateDomain', Object.freeze({
        VERSION: '2.14-R3',
        fieldPolicy: Kernel.get('fieldPolicy'),
        tags: Kernel.require('tagService'),
        context: Kernel.require('contextAssembler'),
        update: Kernel.require('updateService')
    }));
})(window);
