(function (global) {
    'use strict';
    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');

    const api = Object.freeze({
        VERSION: '2.12-R4',
        policy: Kernel.get('policy'),
        review: Kernel.get('review'),
        retrieval: Kernel.get('retrieval'),
        effects: Kernel.get('effects'),
        lifecycle: Kernel.get('lifecycle'),
        tasks: Kernel.get('tasks'),
        feedback: Kernel.get('feedback'),
        quality: Kernel.get('quality'),
        sidecar: Kernel.get('sidecar'),
        schedule: Kernel.require('schedule')
    });
    Kernel.register('memoryPlatformDomain', api);
})(window);
