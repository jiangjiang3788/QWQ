(function (global) {
    'use strict';
    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    Kernel.register('memorySchemaDomain', Object.freeze({
        VERSION: '2.12-R4',
        model: Kernel.require('schemaModel'),
        editor: Kernel.require('schemaEditor')
    }));
})(window);
