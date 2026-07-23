(function (global) {
    'use strict';
    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    Kernel.register('memoryTablesDomain', Object.freeze({
        VERSION: '2.12-R5.2',
        viewport: Kernel.require('tableViewport'),
        session: Kernel.require('tableSession'),
        grouping: Kernel.require('tableGrouping'),
        sort: Kernel.require('tableSort'),
        gesture: Kernel.require('tableGesture'),
        cache: Kernel.require('tableCache'),
        persistence: Kernel.require('tablePersistence'),
        commandMenu: Kernel.require('rowCommandMenu'),
        interaction: Kernel.require('tableInteraction'),
        view: Kernel.require('tableView'),
        presenter: Kernel.require('tablePresenter'),
        reconciler: Kernel.require('tableReconciler'),
        grid: Kernel.require('tableGrid'),
        editor: Kernel.require('tableEditor'),
        editController: Kernel.require('tableEditController'),
        updateActivity: Kernel.require('updateActivity'),
        workspace: Kernel.require('tableWorkspace')
    }));
})(window);
