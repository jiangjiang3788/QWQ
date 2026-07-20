(function (global) {
    'use strict';

    const report = {
        startedAt: 0,
        finishedAt: 0,
        tasks: []
    };

    // 显式启动任务注册表。用于兼容顶层 const/let 不会挂到 window 的经典脚本。
    const taskRegistry = new Map();
    const pendingTasks = global.__OCTOPUS_STARTUP_TASKS__;
    if (pendingTasks && typeof pendingTasks === 'object') {
        Object.entries(pendingTasks).forEach(([name, task]) => {
            if (typeof task === 'function') taskRegistry.set(name, task);
        });
    }

    function now() {
        return global.performance && typeof global.performance.now === 'function'
            ? global.performance.now()
            : Date.now();
    }

    function normalizeError(error) {
        if (!error) return { name: 'Error', message: '未知错误', stack: '' };
        return {
            name: error.name || 'Error',
            message: error.message || String(error),
            stack: error.stack || ''
        };
    }

    function addRecord(name, status, details) {
        const item = Object.assign({
            name: String(name || 'unnamed-task'),
            status,
            startedAt: Date.now(),
            durationMs: 0,
            critical: false
        }, details || {});
        report.tasks.push(item);
        return item;
    }

    function reset() {
        report.startedAt = Date.now();
        report.finishedAt = 0;
        report.tasks.length = 0;
    }

    function register(name, task) {
        const taskName = String(name || '').trim();
        if (!taskName) throw new TypeError('启动任务名称不能为空');
        if (typeof task !== 'function') throw new TypeError(`启动任务必须是函数: ${taskName}`);
        taskRegistry.set(taskName, task);
        return task;
    }

    function registerMany(tasks) {
        if (!tasks || typeof tasks !== 'object') return 0;
        let count = 0;
        Object.entries(tasks).forEach(([name, task]) => {
            if (typeof task !== 'function') return;
            register(name, task);
            count += 1;
        });
        return count;
    }

    function resolve(name) {
        if (taskRegistry.has(name)) return taskRegistry.get(name);
        return typeof global[name] === 'function' ? global[name] : null;
    }

    function has(name) {
        return typeof resolve(name) === 'function';
    }

    function validate(names, options) {
        const config = Object.assign({ critical: true }, options || {});
        const required = Array.isArray(names) ? names : [];
        const missing = required.filter(name => !has(name));
        if (!missing.length) return { ok: true, missing: [] };

        const error = new ReferenceError(`启动契约缺少任务: ${missing.join(', ')}`);
        addRecord('startup-contract', 'failed', {
            critical: !!config.critical,
            durationMs: 0,
            missing: missing.slice(),
            error: normalizeError(error)
        });
        if (config.critical) throw error;
        return { ok: false, missing };
    }

    async function run(name, task, options) {
        const config = Object.assign({ critical: false, optional: true }, options || {});
        const started = now();

        if (typeof task !== 'function') {
            const error = new ReferenceError(`启动任务未注册: ${name}`);
            addRecord(name, config.optional && !config.critical ? 'skipped' : 'failed', {
                critical: !!config.critical,
                durationMs: Math.max(0, now() - started),
                error: normalizeError(error)
            });
            if (config.critical || !config.optional) throw error;
            console.warn(`[Startup:${name}] 已跳过：对应功能未加载`);
            return undefined;
        }

        try {
            const result = await task();
            addRecord(name, 'success', {
                critical: !!config.critical,
                durationMs: Math.max(0, now() - started)
            });
            return result;
        } catch (error) {
            addRecord(name, 'failed', {
                critical: !!config.critical,
                durationMs: Math.max(0, now() - started),
                error: normalizeError(error)
            });
            console.error(`[Startup:${name}] 初始化失败`, error);
            if (config.critical) throw error;
            return undefined;
        }
    }

    function call(name, args, options) {
        const fn = resolve(name);
        return run(name, typeof fn === 'function' ? () => fn(...(args || [])) : null, options);
    }

    function startInterval(name, task, delayMs, options) {
        const config = Object.assign({ immediate: false }, options || {});
        if (typeof task !== 'function') {
            addRecord(name, 'skipped', {
                durationMs: 0,
                error: normalizeError(new ReferenceError(`定时任务未注册: ${name}`))
            });
            return null;
        }

        const invoke = () => {
            Promise.resolve()
                .then(task)
                .catch(error => console.error(`[Runtime:${name}] 定时任务执行失败`, error));
        };
        if (config.immediate) invoke();
        const intervalId = global.setInterval(invoke, delayMs);
        addRecord(name, 'scheduled', { durationMs: 0, delayMs });
        return intervalId;
    }

    function defer(name, task, delayMs) {
        if (typeof task !== 'function') {
            addRecord(name, 'skipped', {
                durationMs: 0,
                error: normalizeError(new ReferenceError(`延迟任务未注册: ${name}`))
            });
            return null;
        }
        const timeoutId = global.setTimeout(() => {
            run(name, task, { optional: true, critical: false });
        }, delayMs);
        addRecord(name, 'scheduled', { durationMs: 0, delayMs });
        return timeoutId;
    }

    function complete() {
        report.finishedAt = Date.now();
        const summary = report.tasks.reduce((acc, task) => {
            acc[task.status] = (acc[task.status] || 0) + 1;
            return acc;
        }, {});
        const snapshot = {
            startedAt: report.startedAt,
            finishedAt: report.finishedAt,
            durationMs: Math.max(0, report.finishedAt - report.startedAt),
            summary,
            tasks: report.tasks.map(item => Object.assign({}, item))
        };
        global.__OCTOPUS_STARTUP_REPORT__ = snapshot;
        return snapshot;
    }

    function getReport() {
        return global.__OCTOPUS_STARTUP_REPORT__ || complete();
    }

    reset();
    global.OvoStartupRuntime = Object.freeze({
        VERSION: '2.9-R8',
        reset,
        register,
        registerMany,
        resolve,
        has,
        validate,
        run,
        call,
        startInterval,
        defer,
        complete,
        getReport
    });
})(window);
