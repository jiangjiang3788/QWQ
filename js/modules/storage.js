// --- 存储分析 (js/modules/storage.js) ---


function setupStorageAnalysisScreen() {
    const screen = document.getElementById('storage-analysis-screen');
    const chartContainer = document.getElementById('storage-chart-container');
    const detailsList = document.getElementById('storage-details-list');
    let myChart = null;

    const guideBtn = document.getElementById('data-analysis-guide-btn');
    const gitBtn = document.getElementById('data-analysis-git-btn');
    const summaryGrid = document.getElementById('data-analysis-summary-grid');
    function openDataGuide(section) {
        if (typeof renderTutorialContent === 'function') renderTutorialContent();
        if (typeof switchScreen === 'function') switchScreen('tutorial-screen');
        if (section === 'github') {
            setTimeout(() => {
                const root = document.getElementById('tutorial-content-area');
                const nodes = root ? Array.from(root.querySelectorAll('*')) : [];
                const target = nodes.find(node => /云端备份|GitHub/i.test(node.textContent || ''));
                if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
        }
    }

    if (guideBtn && !guideBtn.dataset.bound) {
        guideBtn.dataset.bound = '1';
        guideBtn.addEventListener('click', () => openDataGuide('backup'));
    }
    if (gitBtn && !gitBtn.dataset.bound) {
        gitBtn.dataset.bound = '1';
        gitBtn.addEventListener('click', () => openDataGuide('github'));
    }

    function countMessages() {
        return Array.isArray(db && db.characters)
            ? db.characters.reduce((sum, item) => sum + (Array.isArray(item.history) ? item.history.length : 0), 0)
            : 0;
    }

    function countVectorEntries() {
        return Array.isArray(db && db.characters)
            ? db.characters.reduce((sum, item) => sum + (item.vectorMemory && Array.isArray(item.vectorMemory.entries) ? item.vectorMemory.entries.length : 0), 0)
            : 0;
    }

    function renderDataSummary() {
        if (!summaryGrid || typeof db === 'undefined') return;
        const cards = [
            ['角色', Array.isArray(db.characters) ? db.characters.length : 0],
            ['私聊消息', countMessages()],
            ['收藏', Array.isArray(db.favorites) ? db.favorites.length : 0],
            ['世界书', Array.isArray(db.worldBooks) ? db.worldBooks.length : 0],
            ['小剧场', (Array.isArray(db.theaterScenarios) ? db.theaterScenarios.length : 0) + (Array.isArray(db.theaterHtmlScenarios) ? db.theaterHtmlScenarios.length : 0)],
            ['向量记忆', countVectorEntries()]
        ];
        summaryGrid.innerHTML = cards.map(([label, value]) => `
            <div class="data-analysis-summary-card">
                <strong>${Number(value).toLocaleString()}</strong>
                <span>${label}</span>
            </div>`).join('');
    }

    const colorPalette = ['#ff80ab', '#90caf9', '#a5d6a7', '#fff59d', '#b39ddb', '#ffcc80'];

    const categoryNames = {
        messages: '聊天记录',
        charactersAndGroups: '角色与群组',
        worldAndForum: '世界书与论坛',
        personalization: '个性化设置',
        apiAndCore: '核心与API',
        other: '其他数据'
    };

    function formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    function renderStorageChart(info, colors) {
        if (!myChart) {
            myChart = echarts.init(chartContainer);
        }

        const chartData = Object.entries(info.categorizedSizes)
            .map(([key, value]) => ({
                name: categoryNames[key] || key,
                value: value
            }))
            .filter(item => item.value > 0);

        const option = {
            color: colors,
            tooltip: {
                trigger: 'item',
                formatter: '{a} <br/>{b}: {c} ({d}%)'
            },
            legend: {
                show: false 
            },
            series: [
                {
                    name: '存储占比',
                    type: 'pie',
                    radius: ['50%', '70%'],
                    avoidLabelOverlap: false,
                    label: {
                        show: false,
                        position: 'center'
                    },
                    emphasis: {
                        label: {
                            show: true,
                            fontSize: '20',
                            fontWeight: 'bold'
                        }
                    },
                    labelLine: {
                        show: false
                    },
                    data: chartData
                }
            ]
        };
        myChart.setOption(option);
    }

    function renderStorageDetails(info, colors) {
        detailsList.innerHTML = '';
        const totalSize = info.totalSize;

        const totalSizeEl = document.getElementById('storage-total-size');
        if (totalSizeEl) {
            totalSizeEl.textContent = formatBytes(totalSize);
        }

        const sortedData = Object.entries(info.categorizedSizes)
            .map(([key, value]) => ({
                key: key,
                name: categoryNames[key] || key,
                value: value
            }))
            .sort((a, b) => b.value - a.value);

        sortedData.forEach((item, index) => {
            if (item.value <= 0) return; 
            const percentage = totalSize > 0 ? ((item.value / totalSize) * 100).toFixed(2) : 0;
            const color = colors[index % colors.length];

            const detailItem = document.createElement('div');
            detailItem.className = 'storage-detail-item';
            detailItem.innerHTML = `
                <div class="storage-color-indicator" style="background-color: ${color};"></div>
                <div class="storage-detail-info">
                    <span class="storage-detail-name">${item.name}</span>
                    <span class="storage-detail-size">${formatBytes(item.value)}</span>
                </div>
                <span class="storage-detail-percentage">${percentage}%</span>
            `;
            detailsList.appendChild(detailItem);
        });
    }

    const observer = new MutationObserver(async (mutations) => {
        if (screen.classList.contains('active')) {
            renderDataSummary();
            showToast('正在分析存储空间...');
            const storageInfo = await dataStorage.getStorageInfo();
            if (storageInfo) {
                renderStorageChart(storageInfo, colorPalette);
                renderStorageDetails(storageInfo, colorPalette);
                updatePersistenceStatus();
            } else {
                showToast('分析失败');
            }
        }
    });

    observer.observe(screen, { attributes: true, attributeFilter: ['class'] });
    renderDataSummary();

    const compressAllBtn = document.getElementById('compress-all-images-btn');
    if (compressAllBtn) {
        compressAllBtn.addEventListener('click', async () => {
            const confirmed = await showAppConfirmDialog({
                title: '压缩所有聊天图片',
                message: '此操作将遍历所有角色和群组的聊天记录，压缩其中包含的图片（包括你发送的图片和AI生成的图片）。压缩可以节省大量空间，但会稍微降低图片画质。这可能需要一些时间，确定要继续吗？',
                confirmText: '开始压缩',
                cancelText: '取消'
            });

            if (confirmed !== 'confirm') return;

            showToast('开始压缩图片，请耐心等待...');
            compressAllBtn.disabled = true;
            compressAllBtn.textContent = '压缩中...';
            
            let compressedCount = 0;
            let totalSavedBytes = 0;

            const compressHistoryImages = async (history) => {
                if (!history || !Array.isArray(history)) return;
                for (const msg of history) {
                    let changed = false;

                    const compressIfBase64 = async (url) => {
                        if (url && url.startsWith('data:image/')) {
                            try {
                                const originalSize = Math.round((url.length * 3) / 4);
                                // 跳过小于 100KB 的图片，避免不必要的性能消耗和画质损失
                                if (originalSize < 100 * 1024) return url;

                                const res = await fetch(url);
                                const blob = await res.blob();
                                // 使用 utils.js 中的 compressImage，默认按 512x512 0.8质量压缩
                                const compressedDataUrl = await compressImage(blob, { quality: 0.8, maxWidth: 512, maxHeight: 512 });
                                
                                const newSize = Math.round((compressedDataUrl.length * 3) / 4);
                                if (newSize < originalSize) {
                                    totalSavedBytes += (originalSize - newSize);
                                    compressedCount++;
                                    return compressedDataUrl;
                                }
                            } catch (e) {
                                console.warn('Failed to compress an image:', e);
                            }
                        }
                        return url;
                    };

                    if (msg.novelAiImageUrl) {
                        const newUrl = await compressIfBase64(msg.novelAiImageUrl);
                        if (newUrl !== msg.novelAiImageUrl) {
                            msg.novelAiImageUrl = newUrl;
                            changed = true;
                        }
                    }

                    if (msg._imageVersions && Array.isArray(msg._imageVersions)) {
                        for (let i = 0; i < msg._imageVersions.length; i++) {
                            if (msg._imageVersions[i].imageUrl) {
                                const newUrl = await compressIfBase64(msg._imageVersions[i].imageUrl);
                                if (newUrl !== msg._imageVersions[i].imageUrl) {
                                    msg._imageVersions[i].imageUrl = newUrl;
                                    changed = true;
                                }
                            }
                        }
                    }

                    if (msg.content && typeof msg.content === 'string' && msg.content.includes('data:image/')) {
                        const regex = /(data:image\/[^;"']+(?:;[^;"']+)*;base64,[A-Za-z0-9+/=]+)/g;
                        let match;
                        let newContent = msg.content;
                        const promises = [];
                        
                        while ((match = regex.exec(msg.content)) !== null) {
                            const originalDataUrl = match[1];
                            promises.push((async () => {
                                const newUrl = await compressIfBase64(originalDataUrl);
                                if (newUrl !== originalDataUrl) {
                                    newContent = newContent.replace(originalDataUrl, newUrl);
                                    changed = true;
                                }
                            })());
                        }
                        
                        if (promises.length > 0) {
                            await Promise.all(promises);
                            if (changed) {
                                msg.content = newContent;
                            }
                        }
                    }
                }
            };

            try {
                if (typeof db !== 'undefined') {
                    if (db.characters) {
                        for (const char of db.characters) {
                            await compressHistoryImages(char.history);
                        }
                    }
                    
                    if (db.groups) {
                        for (const group of db.groups) {
                            await compressHistoryImages(group.history);
                        }
                    }

                    if (typeof saveData === 'function') {
                        saveData();
                    }
                }
                
                if (typeof dataStorage !== 'undefined') {
                    const storageInfo = await dataStorage.getStorageInfo();
                    if (storageInfo) {
                        renderStorageChart(storageInfo, colorPalette);
                        renderStorageDetails(storageInfo, colorPalette);
                        updatePersistenceStatus();
                    }
                }

                showToast(`压缩完成！共压缩 ${compressedCount} 张图片，节省了 ${formatBytes(totalSavedBytes)} 空间。`);
            } catch (err) {
                console.error('批量压缩图片时出错:', err);
                showToast('压缩过程中出现错误。');
            } finally {
                compressAllBtn.disabled = false;
                compressAllBtn.textContent = '一键压缩聊天图片';
            }
        });
    }

    async function updatePersistenceStatus() {
        if (navigator.storage && navigator.storage.persisted) {
            const isPersisted = await navigator.storage.persisted();
            let statusContainer = document.getElementById('storage-persistence-status');
            
            if (!statusContainer) {
                statusContainer = document.createElement('div');
                statusContainer.id = 'storage-persistence-status';
                statusContainer.style.cssText = "padding: 12px; background: #f8f9fa; border-radius: 12px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; border: 1px solid #eee;";
                chartContainer.parentNode.insertBefore(statusContainer, chartContainer);
            }
            
            statusContainer.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <div style="font-weight: 600; font-size: 15px; color: #333;">持久化存储保护</div>
                    <div style="font-size: 12px; color: ${isPersisted ? '#4caf50' : '#ff9800'}; display: flex; align-items: center; gap: 4px;">
                        ${isPersisted ? 
                            '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg> 已开启 (数据受保护)' : 
                            '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg> 未开启 (容易被清理)'}
                    </div>
                </div>
                ${!isPersisted ? '<button id="manual-persist-btn" class="btn btn-small btn-primary" style="padding: 6px 12px; font-size: 13px;">立即开启</button>' : ''}
            `;

            const btn = document.getElementById('manual-persist-btn');
            if (btn) {
                btn.onclick = async () => {
                    const persisted = await navigator.storage.persist();
                    if (persisted) {
                        showToast("已成功开启持久化存储！");
                        updatePersistenceStatus();
                    } else {
                        showToast("开启失败，可能是浏览器策略限制。");
                    }
                };
            }
        }
        
        // 追加配额进度条
        if (navigator.storage && navigator.storage.estimate) {
            try {
                const { usage, quota } = await navigator.storage.estimate();
                const usedMB = (usage / 1024 / 1024).toFixed(1);
                const totalMB = (quota / 1024 / 1024).toFixed(0);
                const pct = Math.min(100, (usage / quota) * 100);
                const color = pct > 90 ? '#f44336' : pct > 70 ? '#ff9800' : '#4caf50';

                // 移除旧的进度条节点，避免重复渲染
                const oldQuotaDiv = document.getElementById('storage-quota-status');
                if (oldQuotaDiv) oldQuotaDiv.remove();

                const quotaDiv = document.createElement('div');
                quotaDiv.id = 'storage-quota-status';
                quotaDiv.style.cssText = "padding: 12px; background: #f8f9fa; border-radius: 12px; margin-bottom: 20px; border: 1px solid #eee;";
                quotaDiv.innerHTML = `
                    <div style="font-weight:600;font-size:15px;color:#333;margin-bottom:8px;">存储空间用量</div>
                    <div style="background:#eee;border-radius:4px;height:8px;overflow:hidden;margin-bottom:6px;">
                        <div style="width:${pct.toFixed(1)}%;background:${color};height:100%;border-radius:4px;transition:width .3s;"></div>
                    </div>
                    <div style="font-size:12px;color:${color};">已使用 ${usedMB} MB / 约 ${totalMB} MB（${pct.toFixed(1)}%）</div>
                    ${pct > 90 ? '<div style="font-size:12px;color:#f44336;margin-top:4px;">⚠️ 空间即将耗尽，请导出备份并清理数据！</div>' : ''}
                `;
                
                const statusContainer = document.getElementById('storage-persistence-status');
                if (statusContainer && statusContainer.parentNode) {
                    statusContainer.parentNode.insertBefore(quotaDiv, statusContainer.nextSibling);
                } else if (chartContainer && chartContainer.parentNode) {
                    chartContainer.parentNode.insertBefore(quotaDiv, chartContainer);
                }
            } catch (e) {
                console.error("Failed to estimate storage:", e);
            }
        }
    }
}

// --- 持久化存储逻辑 ---
async function checkAndRequestPersistence() {
    if (navigator.storage && navigator.storage.persist) {
        const isPersisted = await navigator.storage.persisted();
        if (isPersisted) {
            console.log("Storage is already persisted.");
            return;
        }

        // 检查是否已经提示过
        const hasPrompted = localStorage.getItem('storage_persist_prompted');
        if (hasPrompted) return;

        // 显示弹窗
        showPersistencePrompt();
    }
}

function showPersistencePrompt() {
    // 避免重复弹窗
    if (document.getElementById('persistence-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'persistence-modal';
    modal.className = 'modal-overlay visible';
    modal.style.zIndex = '10000';
    modal.innerHTML = `
        <div class="modal-window" style="max-width: 320px;">
            <h3 style="margin-bottom: 10px;">🛡️ 防止数据丢失</h3>
            <p style="color: #666; line-height: 1.6; margin-bottom: 20px; font-size: 14px;">
                为了避免聊天记录被浏览器自动清理，建议开启<strong>持久化存储</strong>保护。<br>
                <span style="font-size: 12px; color: #999; display: block; margin-top: 8px;">(开启后，浏览器将不会在空间不足时自动删除你的数据)</span>
            </p>
            <div style="display: flex; gap: 10px;">
                <button id="persist-allow-btn" class="btn btn-primary" style="flex: 1;">开启保护</button>
                <button id="persist-later-btn" class="btn btn-neutral" style="flex: 1;">稍后</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('persist-allow-btn').onclick = async () => {
        const persisted = await navigator.storage.persist();
        if (persisted) {
            showToast("已成功开启持久化存储！");
        } else {
            showToast("开启失败，可能是浏览器策略限制。");
        }
        localStorage.setItem('storage_persist_prompted', 'true');
        modal.remove();
    };

    document.getElementById('persist-later-btn').onclick = () => {
        localStorage.setItem('storage_persist_prompted', 'true'); // 标记为已提示，避免每次刷新都弹
        modal.remove();
    };
}

// 导出函数供 main.js 使用
window.checkAndRequestPersistence = checkAndRequestPersistence;
window.setupStorageAnalysisScreen = setupStorageAnalysisScreen; // 确保原函数也被导出（虽然它已经是全局的）
