const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/modules/memory_table.js'), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

let currentChat = {
    id: 'char-1',
    memoryMode: 'table',
    history: [],
    memoryJournals: [],
    memoryTables: {
        workspace: 'memory',
        workspaceView: 'tables',
        viewMode: 'normal',
        activeTableId: null,
        boundTemplateIds: [],
        data: {},
        history: []
    }
};
let controller = null;

const noop = () => {};
const useCaseFactory = exports => ({ create: () => Object.fromEntries(exports.map(name => [name, name.startsWith('prepare') || name.startsWith('rebuild') || name.startsWith('finalize') || name.startsWith('cancel') || name.startsWith('rollback') || name.startsWith('import') ? async () => ({}) : noop])) });
const domainNames = [
    'createStarterTemplate', 'createEmptyFieldDraft', 'createEmptyTableDraft', 'normalizeTemplate',
    'normalizeFieldType', 'parseOptionText', 'parseConditionalRulesText', 'serializeConditionalRules',
    'getDefaultValueByType', 'getFieldDefaultValue', 'getBoundTemplates', 'isRowsTable', 'createEmptyRow',
    'normalizeRowShape', 'ensureTemplateDataForChat', 'getRows', 'findRowById', 'normalizeFieldValue',
    'clampFieldValue', 'getFieldValue', 'pushMemoryHistory', 'setFieldValue', 'isSameMemoryValue',
    'buildFieldPath', 'addRow', 'updateRowFieldValue', 'deleteRow', 'moveRow', 'isFieldLocked',
    'toggleFieldLock', 'getFieldDisplayValue', 'evaluateConditionalColor', 'isEmptyMemoryValue',
    'getRowSearchText'
];
const domain = Object.fromEntries(domainNames.map(name => [name, noop]));
domain.ensureMemoryTemplateStore = noop;
domain.ensureMemoryTableState = chat => { chat.memoryTables ||= {}; };
domain.getCurrentMemoryTableChat = () => currentChat;
domain.getBoundTemplates = () => [];

const policy = {
    ensureRuntimeState(chat) {
        chat.memoryTables ||= {};
        const state = chat.memoryTables;
        state.workspace ||= 'memory';
        state.workspaceView ||= 'tables';
        state.viewMode ||= 'normal';
        if (state.activeTableId === undefined) state.activeTableId = null;
        state.engineSettings ||= { enabled: true };
        state.tableStates ||= {};
        state.rounds ||= [];
        return state;
    },
    isDesktopJsonAvailable: () => true
};
const workspace = {
    normalizeState(workspaceId, view) {
        const id = ['memory', 'inbox', 'manage'].includes(workspaceId) ? workspaceId : 'memory';
        const defaults = { memory: 'tables', inbox: 'inbox_home', manage: 'manage_home' };
        return { workspace: id, view: view || defaults[id] };
    },
    getWorkspaceForView(view) {
        if (['review', 'sidecar', 'reliability', 'tasks'].includes(view)) return 'inbox';
        if (['templates', 'retrieval', 'feedback', 'usage_audit', 'quality', 'history'].includes(view)) return 'manage';
        return 'memory';
    },
    getCounts: () => ({ inbox: 0 }),
    getStatusSummary: () => ({ title: '', detail: '' }),
    renderInboxHome: () => '',
    renderManageHome: () => '',
    renderDetailHeader: () => '',
    viewTitle: () => ''
};
const core = {
    clone: value => JSON.parse(JSON.stringify(value)),
    createId: () => 'id',
    moveArrayItem: noop,
    escapeHtml: value => String(value ?? ''),
    escapeAttribute: value => String(value ?? '')
};
const api = {
    resolveConfig: noop,
    getConfig: noop,
    requestContent: async () => '',
    requestSummary: async () => ''
};
const kernel = {
    core,
    get(name) { return name === 'policy' ? policy : null; },
    require(name) {
        if (name === 'memoryPlatformDomain') return { policy, review: null, retrieval: null, effects: null, lifecycle: null, tasks: null, feedback: null, quality: null, sidecar: null, schedule: {} };
        if (name === 'memoryFoundationDomain') return { api, domain, workspace, packageAdapter: { cloneTemplateWithFreshIds: value => ({ template: value, idMap: {} }), createImportPlan: () => ({ entries: [], summary: {} }), remapTableDataForImport: () => ({ data: {}, lockedFields: {} }), remapSidecarForImport: value => value || {}, remapQualityForImport: value => value || {}, portableImportPreview: () => '', freshRuntimeState: () => ({}) }, packageOrchestrator: useCaseFactory(['exportTemplate','exportTemplatePackage','exportCurrentMemoryPackage','exportAllTemplates','downloadJson','importTemplatesFromFile']) };
        if (name === 'memorySchemaDomain') return {
            model: { prepare: value => value || { tables: [] }, normalize: value => value || { tables: [] }, summarize: () => ({ tableCount: 0, fieldCount: 0, groupCount: 0 }), groupedFields: () => [], listScalarRows: () => [], getPath: () => undefined, setPath: () => false, updatePath: () => false, addTable: () => null, removeTable: () => false, moveTable: () => false, addField: () => null, removeField: () => false, moveField: () => false, applyRawJson: () => ({ tables: [] }) },
            editor: { prepare: value => value || { tables: [] }, normalize: value => value || { tables: [] }, render: () => '', updateRole: () => false, updatePath: () => false, mutate: () => false, applyRawJson: () => ({ tables: [] }) }
        };
        if (name === 'memoryGovernanceDomain') return {
            vocabulary: {}, relation: { findById: () => null, analyze: () => ({ target: null, items: [], counts: {} }) }, mergeReview: {},
            candidate: { approve: () => ({ changed: false }), setStatus: () => ({ changed: false }), isPending: () => false, statusText: () => '' },
            filter: { apply: rows => rows || [], renderToolbar: () => '', normalizeTagQuery: value => String(value || '') },
            queue: { setFilter: noop, setQuery: noop, toggleSelection: noop }, controller: { handle: async () => false },
            inspector: { render: () => '' }, inspectorController: { handles: () => false, handleAction: async () => false, handleSubmit: async () => false }, integrity: { renderView: () => '', scan: () => ({ summary: {}, issues: [] }) }, reviewOrchestrator: useCaseFactory(['buildMemoryReviewBatches','buildMemoryReviewBatch','recordMemoryChangedFields','recordPendingReviewBatch','finalizeMemoryReviewBatch','cancelMemoryReviewBatch','rollbackMemoryReviewBatch','applyMemoryUpdatesFromXml'])
        };
        if (name === 'memoryRetrievalDomain') return { audit: { render: () => '', setSelectedRound: () => true }, maintenance: {}, orchestrator: useCaseFactory(['rowToRetrievalItem','getMemoryContextBlock','collectRelevantRetrievalGroups','prepareMemoryTableContext','clearMemoryTableRetrievalIndex','rebuildMemoryTableRetrievalPreview']) }; 
        if (name === 'memoryUpdateDomain') return {
            tags: { parseRowNode: () => null, equals: () => true, applyToRow: () => ({ changed: false }), buildPromptInstructions: () => '', normalize: () => ({ topic: [], scene: [], entity: [], effect: 'historical_context' }), isLocked: () => false, setLocked: () => false },
            context: { assemble: () => ({ text: '', tables: [], rowCount: 0, chars: 0 }) },
            update: { collectMessages: () => [], buildTemplateDefinition: () => '', buildHistoryText: () => '', buildUpdatePrompt: () => ({ prompt: '', historyText: '', templateText: '', related: { text: '', tables: [], rowCount: 0, chars: 0 } }) }
        };
        if (name === 'memoryTablesDomain') return {
            viewport: {}, session: { ensure: state => state, selectTable: noop, setFilter: noop, setTagFilter: noop, setSearch: noop, setEditingRow: noop }, grouping: {}, gesture: {},
            cache: { touchChat: noop }, persistence: {}, commandMenu: { open: () => null, close: () => {} },
            interaction: { handleAction: () => false, handleFilterClick: () => false, handleFilterChange: () => false },
            view: { renderValue: value => String(value ?? ''), renderMeta: () => '', renderRowCommand: () => '' }, presenter: {}, reconciler: {},
            grid: { render: () => '', bind: () => {}, refresh: () => true, commitInput: () => {} }, editor: {},
            editController: { handleAction: async () => false, handleFieldInput: async () => false }, workspace: { render: () => '', getGridConfig: () => null }
        };
        if (name === 'memoryArchitecture') return { assertHealthy: () => ({ healthy: true }) };
        if (name === 'api') return api;
        if (name === 'domain') return domain;
        if (name === 'workspace') return workspace;
        if (name === 'tagService') return { parseRowNode: () => null, equals: () => true, applyToRow: () => ({ changed: false }), buildPromptInstructions: () => '', normalize: () => ({ topic: [], scene: [], entity: [], effect: 'historical_context' }), isLocked: () => false, setLocked: () => false };
        if (name === 'candidateService') return { approve: () => ({ changed: false }), setStatus: () => ({ changed: false }), isPending: () => false, statusText: () => '' };
        if (name === 'tableFilter') return { apply: rows => rows || [], renderToolbar: () => '', normalizeTagQuery: value => String(value || '') };
        if (name === 'governanceQueue') return { setFilter: noop, setQuery: noop, toggleSelection: noop };
        if (name === 'governanceController') return { handle: async () => false };
        if (name === 'relationService') return { findById: () => null, analyze: () => ({ target: null, items: [], counts: {} }) };
        if (name === 'rowInspector') return { render: () => '' };
        if (name === 'rowInspectorController') return { handles: () => false, handleAction: async () => false, handleSubmit: async () => false };
        if (name === 'contextAssembler') return { assemble: () => ({ text: '', tables: [], rowCount: 0, chars: 0 }) };
        if (name === 'updateService') return { collectMessages: () => [], buildTemplateDefinition: () => '', buildHistoryText: () => '', buildUpdatePrompt: () => ({ prompt: '', historyText: '', templateText: '', related: { text: '', tables: [], rowCount: 0, chars: 0 } }) };
        if (name === 'retrievalAudit') return { render: () => '', setSelectedRound: () => true };
        if (name === 'tableView') return { renderValue: value => String(value ?? ''), renderMeta: () => '', renderRowCommand: () => '' };
        if (name === 'tableGrid') return { render: () => '', bind: () => {}, refresh: () => true, commitInput: () => {} };
        if (name === 'tableCache') return { touchChat: noop };
        if (name === 'tableEditController') return { handleAction: async () => false, handleFieldInput: async () => false };
        if (name === 'tableSession') return { ensure: state => state, selectTable: noop, setFilter: noop, setTagFilter: noop, setSearch: noop, setEditingRow: noop };
        if (name === 'tableWorkspace') return { render: () => '', getGridConfig: () => null };
        if (name === 'rowCommandMenu') return { open: () => null, close: () => {} };
        if (name === 'tableInteraction') return { handleAction: () => false, handleFilterClick: () => false, handleFilterChange: () => false };
        if (name === 'schemaModel') return { prepare: value => value || { tables: [] }, normalize: value => value || { tables: [] }, summarize: () => ({ tableCount: 0, fieldCount: 0, groupCount: 0 }), groupedFields: () => [], listScalarRows: () => [], getPath: () => undefined, setPath: () => false, updatePath: () => false, addTable: () => null, removeTable: () => false, moveTable: () => false, addField: () => null, removeField: () => false, moveField: () => false, applyRawJson: () => ({ tables: [] }) };
        if (name === 'schemaEditor') return { prepare: value => value || { tables: [] }, normalize: value => value || { tables: [] }, render: () => '', updateRole: () => false, updatePath: () => false, mutate: () => false, applyRawJson: () => ({ tables: [] }) };
        if (name === 'schedule') return {};
        throw new Error(`unexpected required module: ${name}`);
    },
    register(name, module) { if (name === 'controller') controller = module; }
};

const context = {
    window: null,
    console,
    saveData: async () => true,
    Object, Array, String, Number, Boolean, Math, Date, JSON, Set, Map, Promise,
    Error, TypeError, ReferenceError,
    setTimeout, clearTimeout,
    CustomEvent: function CustomEvent(type) { this.type = type; },
    document: {
        getElementById() { return null; },
        querySelectorAll() { return []; }
    },
    db: { memoryTableTemplates: [] },
    saveCharacter: async () => {},
    showToast: noop,
    switchScreen: noop,
    confirm: () => true
};
context.window = context;
context.OvoMemoryKernel = kernel;
vm.createContext(context);
vm.runInContext(source, context);

assert(controller, 'memory controller was not registered');

controller.openWorkspace('inbox', '');
assert(currentChat.memoryTables.workspace === 'inbox', 'inbox transition was overwritten by the previous runtime workspace');
assert(currentChat.memoryTables.workspaceView === 'inbox_home', 'inbox default view was not committed');

controller.openWorkspace('manage', '');
assert(currentChat.memoryTables.workspace === 'manage', 'manage transition was overwritten by the previous runtime workspace');
assert(currentChat.memoryTables.workspaceView === 'manage_home', 'manage default view was not committed');

controller.openFeedback();
assert(currentChat.memoryTables.workspace === 'manage', 'feedback route did not converge into manage workspace');
assert(currentChat.memoryTables.workspaceView === 'usage_audit', 'feedback route did not converge into usage_audit');

currentChat = {
    id: 'char-2', history: [], memoryJournals: [], memoryMode: 'table',
    memoryTables: { workspace: 'manage', workspaceView: 'quality', viewMode: 'normal', boundTemplateIds: [], data: {}, history: [] }
};
controller.openWorkspace('memory', 'tables');
assert(currentChat.memoryTables.workspace === 'memory' && currentChat.memoryTables.workspaceView === 'tables', 'character switch hydration overrode an explicit target transition');

console.log('V2.9-R11 MEMORY WORKSPACE STATE CHECKS: PASS');
