(function (global) {
    'use strict';
    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    Kernel.register('memoryGovernanceDomain', Object.freeze({
        VERSION: '2.14-R6',
        vocabulary: Kernel.require('tagVocabulary'),
        relation: Kernel.require('relationService'),
        mergeReview: Kernel.require('mergeReviewService'),
        candidate: Kernel.require('candidateService'),
        integrity: Kernel.require('integrityDoctor'),
        reviewOrchestrator: Kernel.require('reviewOrchestrator'),
        filter: Kernel.require('tableFilter'),
        queue: Kernel.require('governanceQueue'),
        controller: Kernel.require('governanceController'),
        inspector: Kernel.require('rowInspector'),
        inspectorController: Kernel.require('rowInspectorController')
    }));
})(window);
