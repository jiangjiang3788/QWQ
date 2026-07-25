(function (global) {
    'use strict';

    const M = global.MemoryV5;
    if (!M?.model || !M?.rounds || !M?.engine || !M?.ui) throw new Error('MemoryV5 modules must load before compatibility facade');

    const sidecarApi = Object.freeze({
        VERSION: M.VERSION,
        buildSystemPrompt: M.engine.buildSystemPrompt,
        extractSidecar: M.engine.extractSidecar,
        applySidecar: M.engine.applySidecar,
        completeRound: M.engine.completeRound,
        ensureState: M.engine.ensureSidecarState,
        migratePolicies: M.model.ensureStore,
        refreshStateBar: M.engine.refreshStateBar,
        bindUi() { M.engine.refreshStateBar(M.model.getCurrentChat()); }
    });

    const policyApi = Object.freeze({
        VERSION: M.VERSION,
        beginRound: M.rounds.beginRound,
        finishRound: M.rounds.finishRound,
        cancelRound(chat, token) {
            if (chat && token) M.rounds.finishRound(chat, token);
        }
    });

    const facade = Object.freeze({
        VERSION: M.VERSION,
        state: Object.freeze({ ensure: M.model.ensureStore, currentChat: M.model.getCurrentChat }),
        screen: Object.freeze({ setup: M.ui.setup, render: M.ui.render, openWorkspace: M.ui.render }),
        context: Object.freeze({ get: M.engine.getContextBlock, prepare: async chat => M.engine.getContextBlock(chat), export: M.engine.getContextBlock }),
        writer: Object.freeze({ apply: M.engine.applyOperations }),
        aggregation: Object.freeze({ run: M.engine.runAggregation, check: M.engine.runEligibleAggregations }),
        rounds: M.rounds,
        health() { return { ok: true, version: M.VERSION, mode: 'memory-v5-short-term-auto-write' }; }
    });

    global.MemoryTableSidecar = sidecarApi;
    global.MemoryTablePolicy = policyApi;
    global.OvoMemory = facade;
    global.ensureMemoryTableState = M.model.ensureStore;
    global.setupMemoryTableScreen = M.ui.setup;
    global.renderMemoryTableScreen = M.ui.render;
    global.getMemoryTableContextBlock = M.engine.getContextBlock;
    global.prepareMemoryTableContext = async chat => M.engine.getContextBlock(chat);
    global.exportMemoryTableContext = M.engine.getContextBlock;
    global.getBoundMemoryTableTemplateIds = chat => M.model.ensureStore(chat).tables.map(table => table.id);
    global.checkAndTriggerAutoTableUpdate = async () => [];
    global.openMemoryTableForCharacter = M.ui.openForCharacter;
    global.MemorySimpleV1 = Object.freeze({
        VERSION: M.VERSION,
        ensureStore: M.model.ensureStore,
        applyOperations: M.engine.applyOperations,
        runAggregation: M.engine.runAggregation,
        getContextBlock: M.engine.getContextBlock,
        render: M.ui.render
    });
})(window);
