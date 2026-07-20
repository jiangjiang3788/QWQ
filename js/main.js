// --- 主程序入口 (js/main.js) ---

// 注册 Service Worker。file:// 不支持 Service Worker，本地直接打开时主动跳过。
if ((location.protocol === 'http:' || location.protocol === 'https:') && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(registration => {
                console.log('ServiceWorker registration successful with scope: ', registration.scope);
            })
            .catch(err => {
                console.warn('ServiceWorker registration failed: ', err);
            });
    });
}

const StartupRuntime = window.OvoStartupRuntime || Object.freeze({
    reset() {},
    resolve(name) {
        const pending = window.__OCTOPUS_STARTUP_TASKS__ || {};
        return typeof pending[name] === 'function'
            ? pending[name]
            : (typeof window[name] === 'function' ? window[name] : null);
    },
    async run(name, task, options = {}) {
        try {
            if (typeof task !== 'function') {
                if (options.critical) throw new ReferenceError(`启动任务未注册: ${name}`);
                return undefined;
            }
            return await task();
        } catch (error) {
            console.error(`[Startup:${name}] 初始化失败`, error);
            if (options.critical) throw error;
            return undefined;
        }
    },
    call(name, args, options) {
        const fn = this.resolve(name);
        return this.run(name, typeof fn === 'function' ? () => fn(...(args || [])) : null, options);
    },
    validate(names, options = {}) {
        const missing = (Array.isArray(names) ? names : []).filter(name => typeof this.resolve(name) !== 'function');
        if (missing.length && options.critical) throw new ReferenceError(`启动契约缺少任务: ${missing.join(', ')}`);
        return { ok: missing.length === 0, missing };
    },
    startInterval(name, task, delayMs) {
        if (typeof task !== 'function') return null;
        return setInterval(() => Promise.resolve().then(task).catch(error => {
            console.error(`[Runtime:${name}] 定时任务执行失败`, error);
        }), delayMs);
    },
    defer(name, task, delayMs) {
        if (typeof task !== 'function') return null;
        return setTimeout(() => this.run(name, task), delayMs);
    },
    complete() { return { summary: {} }; }
});

const init = async () => {
    StartupRuntime.validate(['loadData'], { critical: true });
    await StartupRuntime.call('loadData', [], { critical: true, optional: false });

    await StartupRuntime.run('global-click-routing', () => {
        document.body.addEventListener('click', event => {
            const backBtn = event.target.closest('.back-btn[data-target]');
            if (!backBtn) return;
            event.preventDefault();
            event.stopPropagation();
            const fallback = backBtn.getAttribute('data-target') || 'home-screen';
            if (window.OvoNavigation && typeof window.OvoNavigation.back === 'function') {
                window.OvoNavigation.back(fallback);
            } else if (typeof window.switchScreen === 'function') {
                window.switchScreen(fallback);
            }
        }, true);

        document.body.addEventListener('click', event => {
            if (event.target.closest('.context-menu')) {
                event.stopPropagation();
                return;
            }
            if (typeof window.removeContextMenu === 'function') window.removeContextMenu();

            const openOverlay = document.querySelector('.modal-overlay.visible, .action-sheet-overlay.visible');
            if (openOverlay && event.target === openOverlay) openOverlay.classList.remove('visible');

            const navLink = event.target.closest('.app-icon[data-target]');
            if (!navLink) return;
            event.preventDefault();
            if (typeof window.switchScreen === 'function') window.switchScreen(navLink.getAttribute('data-target'));
        });
    });

    // 桌面时钟组件已经退役。旧版遗留的 updateClock 调用会让整个启动流程中断，现已彻底移除。
    StartupRuntime.startInterval('auto-reply-check', () => checkAutoReply(), 60000);

    await StartupRuntime.run('apply-global-appearance', () => {
        if (db.fontUrl === 'local' && db.fontBuffer) {
            if (typeof window.applyGlobalFont === 'function') window.applyGlobalFont('local');
        } else if (typeof window.applyGlobalFont === 'function') {
            window.applyGlobalFont(db.fontUrl);
        }
        if (typeof window.applyGlobalCss === 'function') window.applyGlobalCss(db.globalCss);
        if (typeof window.applyFontSize === 'function') window.applyFontSize(db.fontSizeScale || 1.0);
        if (typeof window.applyThemeSettings === 'function') window.applyThemeSettings();
    });

    const orderedInitializers = [
        'setupGlobalRescueGesture',
        'setupHomeScreen',
        'setupChatListScreen',
        'setupProfilePersonaScreen',
        'setupAddCharModal',
        'setupChatRoom',
        'setupChatSettings',
        'setupArchiveApp',
        'setupApiSettingsApp',
        'setupWallpaperApp',
        'setupStickerSystem',
        'setupPresetFeatures',
        'setupVoiceMessageSystem',
        'setupPhotoVideoSystem',
        'setupImageRecognition',
        'setupTimeSkipSystem',
        'setupWorldBookApp',
        'setupCustomizeApp',
        'setupTutorialApp',
        'setupSearchSystem',
        'setupMemoryJournalScreen',
        'setupMemoryTableScreen',
        'setupVectorMemoryScreen',
        'setupMemoryModeUI',
        'setupDeleteHistoryChunk',
        'setupStorageAnalysisScreen',
        'setupMoreCardBgModal',
        'initMoreMenu',
        'initCotSettings'
    ];
    for (const initializerName of orderedInitializers) {
        await StartupRuntime.call(initializerName, [], { optional: true, critical: false });
    }

    await StartupRuntime.run('memory-sidecar-ui', () => {
        if (window.MemoryTableSidecar && typeof window.MemoryTableSidecar.bindUi === 'function') {
            window.MemoryTableSidecar.bindUi();
        }
    });

    await StartupRuntime.run('battery-interaction', () => {
        if (window.BatteryInteraction && typeof window.BatteryInteraction.init === 'function') {
            window.BatteryInteraction.init();
        }
    });

    await StartupRuntime.run('keep-alive', () => {
        if (window.KeepAliveModule && typeof window.KeepAliveModule.init === 'function') {
            window.KeepAliveModule.init();
        }
    });

    await StartupRuntime.run('floating-ball', () => {
        if (window.FloatingBall && typeof window.FloatingBall.init === 'function') {
            window.FloatingBall.init();
        }
    });

    await StartupRuntime.run('worldbook-actions', () => {
        const delWBBtn = document.getElementById('delete-selected-world-books-btn');
        if (delWBBtn && typeof window.deleteSelectedWorldBooks === 'function') {
            delWBBtn.addEventListener('click', window.deleteSelectedWorldBooks);
        }
        const cancelWBBtn = document.getElementById('cancel-wb-multi-select-btn');
        if (cancelWBBtn && typeof window.exitWorldBookMultiSelectMode === 'function') {
            cancelWBBtn.addEventListener('click', window.exitWorldBookMultiSelectMode);
        }
    });

    await StartupRuntime.run('github-manager', () => {
        if (window.GitHubMgr && typeof window.GitHubMgr.init === 'function') window.GitHubMgr.init();
    });

    if (window.fetchAndPopulateModels && db.apiSettings && db.apiSettings.url && db.apiSettings.key) {
        StartupRuntime.defer('fetch-chat-models', () => window.fetchAndPopulateModels(true), 1000);
    }
    if (window.fetchAndPopulateGptModels && db.gptImageSettings && db.gptImageSettings.url && db.gptImageSettings.key) {
        StartupRuntime.defer('fetch-image-models', () => window.fetchAndPopulateGptModels(false), 1000);
    }
    if (typeof window.checkAndRequestPersistence === 'function') {
        StartupRuntime.defer('request-persistent-storage', window.checkAndRequestPersistence, 2000);
    }

    await StartupRuntime.run('save-in-flight-guard', () => {
        if (typeof window.saveData !== 'function' || window.saveData.__ovoSaveGuard) return;
        let isSaving = false;
        const originalSaveData = window.saveData;
        const guardedSaveData = async (...args) => {
            isSaving = true;
            try {
                return await originalSaveData(...args);
            } finally {
                isSaving = false;
            }
        };
        guardedSaveData.__ovoSaveGuard = true;
        window.saveData = guardedSaveData;
        window.addEventListener('beforeunload', event => {
            if (!isSaving) return;
            event.preventDefault();
            event.returnValue = '数据正在保存中，请稍候再关闭页面...';
        });
    });
};

async function checkAutoReply() {
    const now = Date.now();
    for (const char of db.characters) {
        if (char.autoReply && char.autoReply.enabled) {
            const mode = char.autoReply.mode || 'fixed';
            let intervalMs;
            
            if (mode === 'random') {
                if (!char.autoReply.nextRandomIntervalMs) {
                    const min = char.autoReply.minInterval || 60;
                    const max = char.autoReply.maxInterval || 180;
                    const randomMinutes = Math.floor(Math.random() * (max - min + 1)) + min;
                    char.autoReply.nextRandomIntervalMs = randomMinutes * 60 * 1000;
                }
                intervalMs = char.autoReply.nextRandomIntervalMs;
            } else {
                intervalMs = (char.autoReply.interval || 60) * 60 * 1000;
            }
            
            const lastTriggerTime = char.autoReply.lastTriggerTime || 0;
            
            // 检查上次触发时间
            if (now - lastTriggerTime < intervalMs) continue;

            let lastMsgTime = 0;
            if (char.history && char.history.length > 0) {
                lastMsgTime = char.history[char.history.length - 1].timestamp;
            } else {
                // 如果没有历史记录，暂不触发，或者可以设置为创建时间
                continue;
            }

            // 检查无操作时间 (最后一条消息到现在的时间)
            if (now - lastMsgTime > intervalMs) {
                console.log(`Auto-reply triggered for ${char.remarkName} (mode: ${mode}, interval: ${intervalMs/60000}m)`);
                char.autoReply.lastTriggerTime = now;
                if (mode === 'random') {
                    // 触发后重新生成下一次的随机间隔
                    const min = char.autoReply.minInterval || 60;
                    const max = char.autoReply.maxInterval || 180;
                    const randomMinutes = Math.floor(Math.random() * (max - min + 1)) + min;
                    char.autoReply.nextRandomIntervalMs = randomMinutes * 60 * 1000;
                }
                await saveCharacter(char.id); // 先保存触发时间和下一次间隔，防止重复触发
                await getAiReply(char.id, 'private', true);
            }
        }
    }
}

// === 单用户直接启动（账号验证已删除） ===
async function startApplication() {
    // 清理旧版本遗留的账号验证标记；它不再参与启动流程。
    try { localStorage.removeItem('ephone_auth'); } catch (e) {
        console.warn('[Startup] 无法清理旧账号验证标记:', e);
    }

    StartupRuntime.reset();
    try {
        StartupRuntime.validate(['initDatabase', 'loadData'], { critical: true });
        await StartupRuntime.call('initDatabase', [], { critical: true, optional: false });
        await init();
        const startupReport = StartupRuntime.complete();
        const failedCount = startupReport.summary.failed || 0;
        console.log('[Startup] 单用户模式初始化完成', startupReport);
        if (failedCount > 0 && typeof window.showToast === 'function') {
            window.showToast(`应用已启动，${failedCount} 个非核心模块初始化失败，可在悬浮球控制台查看`);
        }
    } catch (error) {
        const startupReport = StartupRuntime.complete();
        console.error('[Startup] 核心初始化失败:', error, startupReport);
        if (typeof window.showToast === 'function') {
            window.showToast('应用核心初始化失败，请查看启动报告');
        }
    }
}

// === 主入口 ===
document.addEventListener('DOMContentLoaded', startApplication, { once: true });

// === 全局救援手势 (三击清空全局CSS) ===
// 将变量提升到顶层，防止混淆器错误处理闭包作用域
let globalRescueClickCount = 0;
let globalRescueLastClickTime = 0;

function setupGlobalRescueGesture() {
    const CLICK_TIMEOUT = 400; // 400ms 间隔

    document.addEventListener('click', (e) => {
        const now = Date.now();
        const gap = now - globalRescueLastClickTime;
        
        if (gap < CLICK_TIMEOUT) {
            globalRescueClickCount++;
        } else {
            globalRescueClickCount = 1;
        }
        
        
        globalRescueLastClickTime = now;

        if (globalRescueClickCount === 5) {
            console.log('[GlobalGesture] Triggering rescue panel!');
            showGlobalRescuePanel();
            globalRescueClickCount = 0;
        }
    }, true); // 使用捕获阶段，确保尽早触发
}

function showGlobalRescuePanel() {
    // 防止重复创建
    if (document.getElementById('global-rescue-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'global-rescue-panel';
    panel.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.85); z-index: 999999;
        display: flex; flex-direction: column;
        justify-content: center; align-items: center;
        backdrop-filter: blur(5px);
    `;

    panel.innerHTML = `
        <div style="background: #fff; width: 85%; max-width: 320px; border-radius: 16px; padding: 25px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
            <div style="width: 60px; height: 60px; background: #ffebee; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 15px;">
                <svg style="width: 32px; height: 32px; color: #d32f2f;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
            </div>
            <h3 style="margin: 0 0 10px; color: #333; font-size: 18px;">全局样式救援</h3>
            <p style="margin: 0 0 20px; color: #666; font-size: 14px; line-height: 1.5;">
                检测到您快速点击了五次屏幕。<br>
                如果因为错误的全局 CSS 导致界面错乱，您可以在这里一键清空。
            </p>
            <div style="display: flex; flex-direction: column; gap: 10px;">
                <button id="rescue-clear-btn" style="background: #d32f2f; color: #fff; border: none; padding: 12px; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer;">清空全局 CSS</button>
                <button id="rescue-cancel-btn" style="background: #f5f5f5; color: #666; border: none; padding: 12px; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer;">取消</button>
            </div>
        </div>
    `;

    document.body.appendChild(panel);

    document.getElementById('rescue-clear-btn').onclick = async () => {
        if (confirm('确定要清空全局 CSS 吗？此操作不可撤销。')) {
            db.globalCss = '';
            await saveData();
            applyGlobalCss('');
            // 更新设置页面的文本框（如果存在）
            const textarea = document.getElementById('global-beautification-css');
            if (textarea) textarea.value = '';
            
            showToast('全局 CSS 已清空，界面应已恢复正常。');
            panel.remove();
        }
    };

    document.getElementById('rescue-cancel-btn').onclick = () => {
        panel.remove();
    };
}
