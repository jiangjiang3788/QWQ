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
        if (['review', 'sidecar', 'reliability', 'feedback', 'tasks'].includes(view)) return 'inbox';
        if (['templates', 'retrieval', 'quality', 'history'].includes(view)) return 'manage';
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
        if (name === 'api') return api;
        if (name === 'domain') return domain;
        if (name === 'workspace') return workspace;
        if (name === 'schedule') return {};
        throw new Error(`unexpected required module: ${name}`);
    },
    register(name, module) { if (name === 'controller') controller = module; }
};

const context = {
    window: null,
    console,
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
assert(currentChat.memoryTables.workspace === 'inbox', 'feedback route did not enter inbox workspace');
assert(currentChat.memoryTables.workspaceView === 'feedback', 'feedback route bypassed the centralized workspace state transition');

currentChat = {
    id: 'char-2', history: [], memoryJournals: [], memoryMode: 'table',
    memoryTables: { workspace: 'manage', workspaceView: 'quality', viewMode: 'normal', boundTemplateIds: [], data: {}, history: [] }
};
controller.openWorkspace('memory', 'tables');
assert(currentChat.memoryTables.workspace === 'memory' && currentChat.memoryTables.workspaceView === 'tables', 'character switch hydration overrode an explicit target transition');

console.log('V2.9-R11 MEMORY WORKSPACE STATE CHECKS: PASS');
