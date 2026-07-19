// --- 界面交互逻辑 (js/ui.js) ---

// DOM 元素缓存 (将在脚本加载时初始化)
const screens = document.querySelectorAll('.screen');
const homeScreen = document.getElementById('home-screen');
const chatRoomScreen = document.getElementById('chat-room-screen');
const chatExpansionPanel = document.getElementById('chat-expansion-panel');
const panelFunctionArea = document.getElementById('panel-function-area');
const panelStickerArea = document.getElementById('panel-sticker-area');
const messageArea = document.getElementById('message-area');
const chatRoomHeaderDefault = document.getElementById('chat-room-header-default');
const chatRoomHeaderSelect = document.getElementById('chat-room-header-select');
const multiSelectBar = document.getElementById('multi-select-bar');
const multiSelectTitle = document.getElementById('multi-select-title');
const selectCount = document.getElementById('select-count');
const deleteSelectedBtn = document.getElementById('delete-selected-btn');
const chatRoomTitle = document.getElementById('chat-room-title');
const chatRoomStatusText = document.getElementById('chat-room-status-text');
const typingIndicator = document.getElementById('typing-indicator');
const messageInput = document.getElementById('message-input');
const getReplyBtn = document.getElementById('get-reply-btn');
const regenerateBtn = document.getElementById('regenerate-btn');

// 屏幕切换与返回栈
const navigationState = {
    stack: [],
    current: null,
    maxDepth: 40
};

function getActiveScreenId() {
    return document.querySelector('.screen.active')?.id || navigationState.current || null;
}

function normalizeScreenTarget(targetId) {
    if (targetId === 'live-room-screen' || targetId === 'pomodoro-screen' || targetId === 'pomodoro-focus-screen') return 'home-screen';
    if (targetId === 'group-settings-screen') return 'chat-list-screen';
    if (typeof targetId === 'string' && targetId.startsWith('forum-')) return 'home-screen';
    if (typeof targetId === 'string' && targetId.startsWith('node-')) return 'chat-room-screen';
    if (typeof targetId === 'string' && targetId.startsWith('peek-')) return 'chat-room-screen';
    if (targetId === 'shop-screen' || (typeof targetId === 'string' && targetId.startsWith('shop-'))) return 'chat-room-screen';
    if (targetId === 'piggy-bank-screen' || targetId === 'family-card-list-screen' || targetId === 'family-card-detail-screen') return 'settings-hub-screen';
    if (targetId === 'more-screen') {
        if (window.OvoSettingsHub && typeof window.OvoSettingsHub.render === 'function') window.OvoSettingsHub.render();
        return 'settings-hub-screen';
    }
    if (typeof targetId === 'string' && (targetId.startsWith('video-call') || targetId.startsWith('voice-call') || targetId.startsWith('vc-') || targetId === 'call-screen')) return 'chat-room-screen';
    return targetId;
}

function rememberPreviousScreen(previousId) {
    if (!previousId || navigationState.stack[navigationState.stack.length - 1] === previousId) return;
    navigationState.stack.push(previousId);
    if (navigationState.stack.length > navigationState.maxDepth) navigationState.stack.splice(0, navigationState.stack.length - navigationState.maxDepth);
}

const switchScreen = (requestedTargetId, options = {}) => {
    const targetId = normalizeScreenTarget(requestedTargetId);
    const targetScreen = typeof targetId === 'string' ? document.getElementById(targetId) : null;
    if (!targetScreen) {
        console.warn('[Navigation] target screen not found:', requestedTargetId);
        return false;
    }

    const previousId = getActiveScreenId();
    if (options.resetHistory) navigationState.stack.length = 0;
    if (options.record !== false && previousId && previousId !== targetId) rememberPreviousScreen(previousId);

    if (targetId !== 'chat-room-screen' && typeof MinimaxTTSService !== 'undefined' && MinimaxTTSService.stop) {
        MinimaxTTSService.stop();
    }
    if (targetId !== 'chat-room-screen') {
        document.querySelectorAll('style[id^="custom-bubble-style-for-"]').forEach(style => style.remove());
        // 角色选择是跨 App 的上下文。进入设置和角色库时保留，只在真正返回公共大厅时清空聊天会话。
        const clearConversationScreens = ['chat-list-screen', 'contacts-screen', 'home-screen'];
        if (clearConversationScreens.includes(targetId)) {
            if (typeof currentChatId !== 'undefined') currentChatId = null;
            if (typeof currentChatType !== 'undefined') currentChatType = null;
        }
    } else if (typeof currentChatId !== 'undefined' && currentChatId) {
        const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
        if (chat) updateCustomBubbleStyle(currentChatId, chat.customBubbleCss, chat.useCustomBubbleCss);
    }

    document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
    targetScreen.classList.add('active');
    navigationState.current = targetId;

    document.querySelectorAll('.modal-overlay, .action-sheet-overlay, .settings-sidebar').forEach(overlay => overlay.classList.remove('visible', 'open'));

    if (targetId !== 'chat-settings-screen' && targetId !== 'group-settings-screen') {
        document.querySelectorAll('.bubble-css-preview').forEach(element => { element.innerHTML = ''; });
    }

    const globalNav = document.getElementById('global-bottom-nav');
    if (globalNav) {
        const showGlobalNav = targetId === 'chat-list-screen' || targetId === 'contacts-screen';
        globalNav.style.display = showGlobalNav ? 'flex' : 'none';
        if (showGlobalNav) {
            globalNav.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.getAttribute('data-target') === targetId));
        }
    }

    if (targetId === 'contacts-screen') {
        if (typeof renderContactList === 'function') renderContactList();
        if (typeof renderMyProfile === 'function') renderMyProfile();
    }
    if (targetId === 'appearance-settings-screen' && typeof renderAppearanceSettingsScreen === 'function') renderAppearanceSettingsScreen();

    try {
        window.dispatchEvent(new CustomEvent('ovo:navigation', { detail: { from: previousId, to: targetId, depth: navigationState.stack.length } }));
    } catch (_) {}
    return true;
};

function navigateBack(fallbackTarget = 'home-screen') {
    const currentId = getActiveScreenId();
    let targetId = null;
    while (navigationState.stack.length && !targetId) {
        const candidate = normalizeScreenTarget(navigationState.stack.pop());
        if (candidate && candidate !== currentId && document.getElementById(candidate)) targetId = candidate;
    }
    return switchScreen(targetId || normalizeScreenTarget(fallbackTarget) || 'home-screen', { record: false });
}

window.OvoNavigation = Object.freeze({
    go(targetId, options) { return switchScreen(targetId, options || {}); },
    back(fallbackTarget) { return navigateBack(fallbackTarget); },
    reset(targetId = 'home-screen') {
        navigationState.stack.length = 0;
        return switchScreen(targetId, { record: false, resetHistory: true });
    },
    snapshot() {
        return { current: getActiveScreenId(), stack: [...navigationState.stack], depth: navigationState.stack.length };
    }
});

function renderMoreScreen() {
    let myName = 'User Name';
    let myAvatar = 'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg';

    let activePersona = null;
    if (db.activePersonaId) {
        activePersona = db.myPersonaPresets.find(p => p.id === db.activePersonaId);
    }
    
    if (!activePersona && db.myPersonaPresets && db.myPersonaPresets.length > 0) {
        activePersona = db.myPersonaPresets[0];
    }

    if (activePersona) {
        myName = activePersona.name || 'User';
        myAvatar = activePersona.avatar || myAvatar;
    } else if (db.characters && db.characters.length > 0) {
        const firstChar = db.characters[0];
        myName = firstChar.myName || 'User Name';
        myAvatar = firstChar.myAvatar || 'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg';
    }
    
    const avatarEl = document.getElementById('more-my-avatar');
    const nameEl = document.getElementById('more-my-name');
    const dateEl = document.getElementById('more-date-display');

    if (avatarEl) avatarEl.src = myAvatar;
    if (nameEl) nameEl.textContent = myName;
    
    // 更新日期显示 (格式: YYYY#MMDD)
    if (dateEl) {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        dateEl.textContent = `${year}#${month}${day}`;
    }

    // 应用自定义背景图
    const bgLayer = document.querySelector('.glass-background-layer');
    if (bgLayer && db.moreProfileCardBg) {
        bgLayer.style.backgroundImage = `url('${db.moreProfileCardBg}')`;
    }

    // 触发搜索引导
    if (window.GuideSystem) {
        window.GuideSystem.check('guide_search_entry');
    }
}

function setupMoreCardBgModal() {
    const modal = document.getElementById('more-card-bg-modal');
    const form = document.getElementById('more-card-bg-form');
    const preview = document.getElementById('more-card-bg-preview');
    const urlInput = document.getElementById('more-card-bg-url-input');
    const fileUpload = document.getElementById('more-card-bg-file-upload');
    
    // 绑定点击事件到背景层
    // 注意：由于 renderMoreScreen 可能会被多次调用，我们需要使用事件委托或者确保只绑定一次
    // 这里我们使用事件委托绑定到 document，在 renderMoreScreen 中不需要重复绑定
    document.body.addEventListener('click', (e) => {
        // 只要点击了更多界面的个人卡片区域（包括背景和内容），都触发更换背景
        // 这样可以避免因为内容层遮挡背景层导致点击无效
        // 2026-01-21 修改：将点击范围限定在背景层 (glass-background-layer)，避免点击头像/名字触发
        if (e.target.classList.contains('glass-background-layer')) {
            // 打开模态框
            modal.classList.add('visible');
            urlInput.value = '';
            fileUpload.value = null;
            preview.style.backgroundImage = `url('${db.moreProfileCardBg || 'https://i.postimg.cc/XvFDdTKY/Smart-Select-20251013-023208.jpg'}')`;
            preview.innerHTML = '';
        }
    });

    // URL 输入预览
    urlInput.addEventListener('input', () => {
        if (urlInput.value) {
            preview.style.backgroundImage = `url('${urlInput.value}')`;
            preview.innerHTML = '';
        }
    });

    // 文件上传预览
    fileUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                preview.style.backgroundImage = `url('${e.target.result}')`;
                preview.innerHTML = '';
                // 临时存储 base64，提交时使用
                fileUpload.dataset.base64 = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    });

    // 保存
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        let newBg = db.moreProfileCardBg;

        if (fileUpload.files.length > 0 && fileUpload.dataset.base64) {
            newBg = fileUpload.dataset.base64;
        } else if (urlInput.value) {
            newBg = urlInput.value;
        }

        if (newBg !== db.moreProfileCardBg) {
            db.moreProfileCardBg = newBg;
            await saveData();
            renderMoreScreen(); // 重新渲染以应用更改
            showToast('背景已更新');
        }
        
        modal.classList.remove('visible');
        // 清理
        fileUpload.dataset.base64 = '';
    });
}

// 右键菜单
function createContextMenu(items, x, y) {
    removeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    if (items.length <= 5) {
        menu.classList.add('few-items');
    }
    
    menu.style.visibility = 'hidden';
    document.body.appendChild(menu);

    items.forEach(item => {
        const menuItem = document.createElement('div');
        menuItem.className = 'context-menu-item';
        if (item.danger || item.label === '删除') menuItem.classList.add('danger');
        
        const labelDiv = document.createElement('span');
        labelDiv.textContent = item.label;

        menuItem.appendChild(labelDiv);

        menuItem.onclick = () => {
            item.action();
            removeContextMenu();
        };
        menu.appendChild(menuItem);
    });

    const rect = menu.getBoundingClientRect();
    const winWidth = window.innerWidth;
    const winHeight = window.innerHeight;
    const padding = 15; // 屏幕边缘间距

    // 水平方向调整
    if (x + rect.width > winWidth - padding) {
        x = winWidth - rect.width - padding;
    }
    if (x < padding) {
        x = padding;
    }
    
    // 垂直方向调整
    if (y + rect.height > winHeight - padding) {
        // 如果下方空间不足，向上弹出
        y = y - rect.height;
    }

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.visibility = 'visible';

    document.addEventListener('click', removeContextMenu, {once: true});
}

function removeContextMenu() {
    const menu = document.querySelector('.context-menu');
    if (menu) menu.remove();
}

// 更新气泡样式
function updateCustomBubbleStyle(chatId, css, enabled) {
    const STYLE_TAG_CLASS = 'dynamic-chat-style-tag';
    const existingStyles = document.querySelectorAll(`.${STYLE_TAG_CLASS}, style[id^="custom-bubble-style-for-"]`);
    existingStyles.forEach(el => el.remove());

    if (!enabled || !css) return;

    // 获取 chat 对象以支持模板变量
    let chat = null;
    if (typeof db !== 'undefined') {
        chat = db.characters.find(c => c.id === chatId) || db.groups.find(g => g.id === chatId);
    }

    // 处理模板变量 ({{char_avatar}}, {{user_avatar}} 等)
    // processTemplate 定义在 js/utils.js 中
    const processedCss = (typeof processTemplate === 'function' && chat) ? processTemplate(css, chat) : css;

    const styleElement = document.createElement('style');
    styleElement.id = `custom-bubble-style-for-${chatId}`;
    styleElement.className = STYLE_TAG_CLASS;

    styleElement.textContent = processedCss;

    document.head.appendChild(styleElement);
}

function updateBubbleCssPreview(previewContainer, css, useDefault, theme) {
    previewContainer.innerHTML = '';

    const sentBubble = document.createElement('div');
    sentBubble.className = 'message-bubble sent';
    sentBubble.textContent = '这是我方气泡。';
    sentBubble.style.alignSelf = 'flex-end';
    sentBubble.style.borderBottomRightRadius = '5px';

    const receivedBubble = document.createElement('div');
    receivedBubble.className = 'message-bubble received';
    receivedBubble.textContent = '这是对方气泡。';
    receivedBubble.style.alignSelf = 'flex-start';
    receivedBubble.style.borderBottomLeftRadius = '5px';

    [sentBubble, receivedBubble].forEach(bubble => {
        bubble.style.maxWidth = '70%';
        bubble.style.padding = '8px 12px';
        bubble.style.wordWrap = 'break-word';
        bubble.style.lineHeight = '1.4';
    });

    if (useDefault || !css) {
        sentBubble.style.backgroundColor = theme.sent.bg;
        sentBubble.style.color = theme.sent.text;
        sentBubble.style.borderRadius = '18px';
        sentBubble.style.borderBottomRightRadius = '5px';
        receivedBubble.style.backgroundColor = theme.received.bg;
        receivedBubble.style.color = theme.received.text;
        receivedBubble.style.borderRadius = '18px';
        receivedBubble.style.borderBottomLeftRadius = '5px';
    } else {
        const styleTag = document.createElement('style');
        styleTag.textContent = `
            #${previewContainer.id} {
                ${css}
            }
        `;
        previewContainer.appendChild(styleTag);
    }
    previewContainer.appendChild(receivedBubble);
    previewContainer.appendChild(sentBubble);
}

// 主屏幕逻辑
// V12.3: desktop is now a single page.

function setupHomeScreen() {
    if (!homeScreen) return;

    if (window.OvoAppRegistry && typeof window.OvoAppRegistry.renderLauncher === 'function') {
        homeScreen.innerHTML = window.OvoAppRegistry.renderLauncher();
        window.OvoAppRegistry.bindLauncher(homeScreen);
    } else {
        homeScreen.innerHTML = '<div class="home-screen-page"><div class="app-grid"><a href="#" class="app-icon" data-target="chat-list-screen"><span class="app-name">聊天</span></a></div></div>';
    }

    applyWallpaper(db.wallpaper);
    applyHomeStatusBar();
    if (typeof setupReminderModule === 'function') setupReminderModule();

    homeScreen.querySelectorAll('.primary-dock .dock-app').forEach(item => {
        item.setAttribute('role', 'button');
        item.addEventListener('pointerdown', () => item.classList.add('dock-app--pressed'));
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => {
            item.addEventListener(type, () => item.classList.remove('dock-app--pressed'));
        });
    });
}

function applyWallpaper(url) {
    if (homeScreen) homeScreen.style.backgroundImage = `url(${url})`;
}

async function applyGlobalFont(fontUrl) {
    const fontName = 'CustomGlobalFont';
    
    document.fonts.forEach(font => {
        if (font.family === fontName) {
            document.fonts.delete(font);
        }
    });

    const styleId = 'global-font-style';
    let styleElement = document.getElementById(styleId);
    if (!styleElement) {
        styleElement = document.createElement('style');
        styleElement.id = styleId;
        document.head.appendChild(styleElement);
    }

    if (fontUrl && fontUrl.startsWith('local')) {
        let bufferToLoad = null;
        if (db.fontBuffer) {
            if (db.fontBuffer.constructor === ArrayBuffer) {
                // 兼容旧版本单一文件
                bufferToLoad = db.fontBuffer;
            } else {
                // 新版本字典形式存储，提取文件名
                const targetName = fontUrl.substring(6) || db.localFontName;
                bufferToLoad = db.fontBuffer[targetName];
            }
        }
        
        if (bufferToLoad) {
            try {
                const fontFace = new FontFace(fontName, bufferToLoad);
                const loadedFont = await fontFace.load();
                document.fonts.add(loadedFont);
                styleElement.innerHTML = `:root { --font-family: '${fontName}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }`;
            } catch (error) {
                console.error('Failed to load local font:', error);
                styleElement.innerHTML = `:root { --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }`;
            }
        } else {
            styleElement.innerHTML = `:root { --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }`;
        }
    } else if (fontUrl && !fontUrl.startsWith('local')) {
        styleElement.innerHTML = `@font-face { font-family: '${fontName}'; src: url('${fontUrl}'); } :root { --font-family: '${fontName}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }`;
    } else {
        styleElement.innerHTML = `:root { --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }`;
    }
}

function applyGlobalCss(css) {
    const styleId = 'global-css-style';
    let styleElement = document.getElementById(styleId);
    
    if (!styleElement) {
        styleElement = document.createElement('style');
        styleElement.id = styleId;
        document.head.appendChild(styleElement);
    }
    
    styleElement.innerHTML = css || '';
}

function applyFontSize(scale) {
    document.documentElement.style.setProperty('--app-font-scale', scale);
}

// 统一面板控制函数
function showPanel(type) {
    triggerHapticFeedback('light');
    const toggleExpansionBtn = document.getElementById('toggle-expansion-btn');
    const panel = document.getElementById('chat-expansion-panel');

    if (type === 'none') {
        chatExpansionPanel.classList.remove('visible');
        if (toggleExpansionBtn) toggleExpansionBtn.classList.remove('rotate-45');
        return;
    }

    chatExpansionPanel.classList.add('visible');

    if (type === 'function') {
        panelFunctionArea.style.display = 'flex';
        panelStickerArea.style.display = 'none';
        
        // 初始化功能面板的分页滑动
        if (!document.querySelector('.function-swiper-wrapper')) {
            setupFunctionPanelSwiper();
        }

        if (toggleExpansionBtn) toggleExpansionBtn.classList.add('rotate-45');

        // 触发功能面板引导
        if (window.GuideSystem) {
            if (currentChatType === 'private') {
                window.GuideSystem.check('guide_char_gallery');
            } else if (currentChatType === 'group') {
                window.GuideSystem.check('guide_group_summary');
            }
        }
    } else if (type === 'sticker') {
        panelFunctionArea.style.display = 'none';
        panelStickerArea.style.display = 'flex';
        if (toggleExpansionBtn) toggleExpansionBtn.classList.remove('rotate-45');
        renderStickerCategories();
        renderStickerGrid();
    }

    setTimeout(() => {
        messageArea.scrollTop = messageArea.scrollHeight;
    }, 50);
}

function initKeyboardDetection() {
    if (!window.visualViewport) return;

    let maxViewportHeight = window.visualViewport.height;
    
    // 初始化应用保存的高度
    if (db.savedKeyboardHeight) {
        document.documentElement.style.setProperty('--panel-height', `${db.savedKeyboardHeight}px`);
    }

    window.visualViewport.addEventListener('resize', () => {
        const currentHeight = window.visualViewport.height;
        const activeElement = document.activeElement;
        const isInputFocused = activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA');
        
        // 如果高度变小了，且输入框聚焦，说明键盘弹出了
        if (currentHeight < maxViewportHeight && isInputFocused) {
            const diff = maxViewportHeight - currentHeight;
            // 简单的阈值判断，防止误判
            if (diff > 150) { 
                const keyboardHeight = diff;
                document.documentElement.style.setProperty('--panel-height', `${keyboardHeight}px`);
                
                // 保存到 DB (防抖)
                if (db.savedKeyboardHeight !== keyboardHeight) {
                    db.savedKeyboardHeight = keyboardHeight;
                    if (typeof saveData === 'function') {
                        saveData();
                    }
                }
            }
        } else if (currentHeight > maxViewportHeight) {
            // 可能是地址栏收起导致的高度增加，更新最大高度
            maxViewportHeight = currentHeight;
        } else if (currentHeight === maxViewportHeight && !isInputFocused) {
            // 键盘收起，高度恢复，不做处理，保持 --panel-height 为最后一次键盘高度
        }
    });
}

// 底部导航栏逻辑
function setupBottomNavigation() {
    document.querySelectorAll('.bottom-nav .nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const targetId = item.getAttribute('data-target');
            if (targetId) {
                // 切换屏幕
                switchScreen(targetId);
                
                // 更新所有底部导航栏的选中状态
                document.querySelectorAll('.bottom-nav .nav-item').forEach(nav => {
                    if (nav.getAttribute('data-target') === targetId) {
                        nav.classList.add('active');
                    } else {
                        nav.classList.remove('active');
                    }
                });
            }
        });
    });
}

function setupFunctionPanelSwiper() {
    const panelArea = document.getElementById('panel-function-area');
    const originalGrid = panelArea.querySelector('.expansion-grid');
    if (!originalGrid) return; 

    // 获取所有 expansion-item
    const items = Array.from(originalGrid.querySelectorAll('.expansion-item'));
    if (items.length === 0) return;

    // 创建新结构
    const swiperContainer = document.createElement('div');
    swiperContainer.className = 'function-swiper-container';
    
    const wrapper = document.createElement('div');
    wrapper.className = 'function-swiper-wrapper';

    const pagination = document.createElement('div');
    pagination.className = 'function-pagination';

    const itemsPerPage = 8;
    const pageCount = Math.ceil(items.length / itemsPerPage);

    for (let i = 0; i < pageCount; i++) {
        const slide = document.createElement('div');
        slide.className = 'function-slide';
        
        const pageItems = items.slice(i * itemsPerPage, (i + 1) * itemsPerPage);
        pageItems.forEach(item => slide.appendChild(item));
        
        wrapper.appendChild(slide);

        const dot = document.createElement('span');
        dot.className = `dot ${i === 0 ? 'active' : ''}`;
        dot.dataset.page = String(i);
        pagination.appendChild(dot);
    }

    // 移除旧 grid
    originalGrid.remove();

    swiperContainer.appendChild(wrapper);
    // 只有多页时才显示 pagination
    if (pageCount > 1) {
        swiperContainer.appendChild(pagination);
    }
    
    panelArea.appendChild(swiperContainer);

    // 绑定滚动事件更新 pagination
    wrapper.addEventListener('scroll', () => {
        const width = wrapper.offsetWidth;
        if (width > 0) {
            const index = Math.round(wrapper.scrollLeft / width);
            const dots = pagination.querySelectorAll('.dot');
            dots.forEach((d, i) => d.classList.toggle('active', i === index));
        }
    });

    // 点击圆点切换页
    pagination.querySelectorAll('.dot').forEach((dot, i) => {
        dot.addEventListener('click', () => {
            const width = wrapper.offsetWidth;
            wrapper.scrollTo({ left: i * width, behavior: 'smooth' });
        });
    });
}
