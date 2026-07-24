(function (global) {
    'use strict';
    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');

    const api = Object.freeze({
        VERSION: '2.14-R6',
        policy: Kernel.get('policy'),
        policyResolver: Kernel.require('policyResolver'),
        review: Kernel.get('review'),
        retrieval: Kernel.get('retrieval'),
        effects: Kernel.get('effects'),
        lifecycle: Kernel.get('lifecycle'),
        tasks: Kernel.get('tasks'),
        feedback: Kernel.get('feedback'),
        quality: Kernel.get('quality'),
        sidecar: Kernel.get('sidecar'),
        sidecarCandidates: Kernel.require('sidecarCandidateService'),
        sidecarCandidateController: Kernel.require('sidecarCandidateController'),
        schedule: Kernel.require('schedule')
    });
    Kernel.register('memoryPlatformDomain', api);
})(window);
