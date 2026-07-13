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

const init = async () => {
    if (window.__OVO_BOOT__) window.__OVO_BOOT__.mark('读取本地数据库');
    await loadData();
    if (window.__OVO_BOOT__) window.__OVO_BOOT__.mark('初始化界面模块');

    // V12.3: desktop widgets were retired; no widget-state migration is required.

    // 全局点击事件委托
    document.body.addEventListener('click', (e) => {
        // 全局点击触感反馈
        // if (e.target.closest('button, .btn, .action-btn, .nav-item, .icon-btn, .list-item, input[type="checkbox"], input[type="radio"], .back-btn')) {
        //     triggerHapticFeedback('light');
        // }

        if (e.target.closest('.context-menu')) {
            e.stopPropagation();
            return;
        }
        removeContextMenu();

        const backBtn = e.target.closest('.back-btn');
        if (backBtn) {
            e.preventDefault();
            switchScreen(backBtn.getAttribute('data-target'));
        }

        const openOverlay = document.querySelector('.modal-overlay.visible, .action-sheet-overlay.visible');
        if (openOverlay && e.target === openOverlay) {
            openOverlay.classList.remove('visible');
        }
    });

    // 导航栏跳转
    document.body.addEventListener('click', e => {
        const navLink = e.target.closest('.app-icon[data-target]');
        if (navLink) {
            e.preventDefault();
            const target = navLink.getAttribute('data-target');
            switchScreen(target);
        }
    });

    // 定时任务
    updateClock();
    setInterval(updateClock, 30000);
    setInterval(checkAutoReply, 60000);

    // 应用全局设置
    if (db.fontUrl === 'local' && db.fontBuffer) {
        applyGlobalFont('local');
    } else {
        applyGlobalFont(db.fontUrl);
    }
    applyGlobalCss(db.globalCss);
    applyFontSize(db.fontSizeScale || 1.0);
    if (typeof applyThemeSettings === 'function') applyThemeSettings();

    // 初始化各个模块
    setupGlobalRescueGesture(); // 全局救援手势
    setupHomeScreen();
    setupChatListScreen();
    setupContactsScreen();
    setupBottomNavigation();
    setupAddCharModal();
    setupChatRoom();
    setupChatSettings();
    setupArchiveApp();
    setupApiSettingsApp();
    setupWallpaperApp();
    await setupStickerSystem();
    setupPresetFeatures();
    setupVoiceMessageSystem();
    setupPhotoVideoSystem();
    setupImageRecognition();
    // V10.4: economy and gift action runtime removed; historical cards remain render-only.
    setupTimeSkipSystem();

    // 错误处理包裹的模块初始化
    try { setupWorldBookApp(); } catch(e) { console.error("setupWorldBookApp failed:", e); }
    // try { setupGroupChatSystem(); } catch(e) { console.error("setupGroupChatSystem failed:", e); }
    try { setupCustomizeApp(); } catch(e) { console.error("setupCustomizeApp failed:", e); }
    try { setupTutorialApp(); } catch(e) { console.error("setupTutorialApp failed:", e); }
    
    // V5: update log display removed for the single-user build.
    // checkForUpdates();
    // setupPeekFeature();
    setupMemoryJournalScreen(); 
    if (typeof setupMemoryTableScreen === 'function') setupMemoryTableScreen();
    if (typeof setupVectorMemoryScreen === 'function') setupVectorMemoryScreen();
    setupDeleteHistoryChunk();
    // setupForumBindingFeature();
    // setupForumFeature();
    setupStorageAnalysisScreen();

    setupMoreCardBgModal();
    // if (typeof setupShopSystem === 'function') setupShopSystem();
    // if (typeof initKeyboardDetection === 'function') initKeyboardDetection();
    if (window.BatteryInteraction) window.BatteryInteraction.init();
    if (typeof initMoreMenu === 'function') initMoreMenu();
    if (typeof setupPhoneScreen === 'function') setupPhoneScreen();
    if (typeof initCotSettings === 'function') initCotSettings();
    // V10.5: video/voice call runtime removed. TTS and voice messages remain independent.
    if (typeof KeepAliveModule !== 'undefined') KeepAliveModule.init();
    if (window.FloatingBall && typeof window.FloatingBall.init === 'function') window.FloatingBall.init();

    // 全局事件绑定
    const delWBBtn = document.getElementById('delete-selected-world-books-btn');
    if(delWBBtn) delWBBtn.addEventListener('click', deleteSelectedWorldBooks);
    
    const cancelWBBtn = document.getElementById('cancel-wb-multi-select-btn');
    if(cancelWBBtn) cancelWBBtn.addEventListener('click', exitWorldBookMultiSelectMode);
    
    if(window.GitHubMgr) {
        window.GitHubMgr.init();
    }

    // 自动尝试拉取模型列表
    if (window.fetchAndPopulateModels && db.apiSettings && db.apiSettings.url && db.apiSettings.key) {
        // 稍微延迟一点，确保 API 设置 DOM 已加载
        setTimeout(() => {
            window.fetchAndPopulateModels(true);
        }, 1000);
    }
    
    if (window.fetchAndPopulateGptModels && db.gptImageSettings && db.gptImageSettings.url && db.gptImageSettings.key) {
        setTimeout(() => {
            window.fetchAndPopulateGptModels(false);
        }, 1000);
    }

    // 检查并请求持久化存储 (抗系统清理)
    if (typeof checkAndRequestPersistence === 'function') {
        setTimeout(checkAndRequestPersistence, 2000); // 延迟一点，避免与初始化逻辑冲突
    }

    // 追踪是否有正在进行的保存操作
    let _isSaving = false;
    const _origSaveData = window.saveData;
    window.saveData = async (...args) => {
        _isSaving = true;
        try {
            await _origSaveData(...args);
        } finally {
            _isSaving = false;
        }
    };

    // 用户关闭或刷新页面时，如有未完成保存则弹出提示
    window.addEventListener('beforeunload', (e) => {
        if (_isSaving) {
            e.preventDefault();
            e.returnValue = '数据正在保存中，请稍候再关闭页面...';
        }
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

    try {
        if (window.__OVO_BOOT__) window.__OVO_BOOT__.mark('初始化 IndexedDB');
        initDatabase();
        await init();
        console.log('[Startup] 单用户模式初始化完成');
        if (window.__OVO_BOOT__) window.__OVO_BOOT__.success();
    } catch (error) {
        console.error('[Startup] 应用初始化失败:', error);
        if (window.__OVO_BOOT__) window.__OVO_BOOT__.fail(error);
        if (typeof showToast === 'function') {
            showToast('应用初始化失败，错误已显示在页面上');
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
