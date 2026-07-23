(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) return;
    const controller = Kernel.get('controller');
    if (!controller) return;

    const facade = Object.freeze({
        VERSION: '2.9-R2',
        state: Object.freeze({ ensure: controller.ensureState, currentChat: controller.getCurrentChat }),
        screen: Object.freeze({ setup: controller.setupScreen, render: controller.renderScreen, openFeedback: controller.openFeedback, openWorkspace: controller.openWorkspace }),
        context: Object.freeze({ get: controller.getContext, prepare: controller.prepareContext, export: controller.exportContext }),
        templates: Object.freeze({ getBoundIds: controller.getBoundTemplateIds }),
        conversion: Object.freeze({ fromText: controller.convertText }),
        autoUpdate: Object.freeze({ check: controller.checkAutoUpdate }),
        module(name) { return Kernel.get(name); },
        health() {
            return Kernel.health(['memoryPlatformDomain', 'memoryFoundationDomain', 'memorySchemaDomain', 'memoryGovernanceDomain', 'memoryRetrievalDomain', 'memoryUpdateDomain', 'memoryTablesDomain', 'memoryArchitecture', 'memoryMaintenance', 'controller']);
        }
    });

    global.OvoMemory = facade;

    const compat = {
        ensureMemoryTableState: facade.state.ensure,
        setupMemoryTableScreen: facade.screen.setup,
        renderMemoryTableScreen: facade.screen.render,
        getMemoryTableContextBlock: facade.context.get,
        prepareMemoryTableContext: facade.context.prepare,
        exportMemoryTableContext: facade.context.export,
        getBoundMemoryTableTemplateIds: facade.templates.getBoundIds,
        convertTextToMemoryTable: facade.conversion.fromText,
        checkAndTriggerAutoTableUpdate: facade.autoUpdate.check,
        openMemoryFeedbackTab: facade.screen.openFeedback,
        openMemoryWorkspace: facade.screen.openWorkspace
    };
    Object.entries(compat).forEach(([name, fn]) => {
        if (typeof fn === 'function') global[name] = fn;
    });
})(window);
