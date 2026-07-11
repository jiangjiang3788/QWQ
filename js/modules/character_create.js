// --- 角色手动创建模块（角色导入已移除） ---
function openManualCharacterCreation() {
    const modal = document.getElementById('add-char-modal');
    if (modal) modal.classList.add('visible');
}

function setupAddCharModal() {
    const form = document.getElementById('add-char-form');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newChar = {
            id: `char_${Date.now()}`,
            realName: document.getElementById('char-real-name').value,
            remarkName: document.getElementById('char-remark-name').value,
            persona: document.getElementById('char-persona-input')?.value || '',
            birthday: document.getElementById('char-birthday')?.value || '',
            enableDynamicAge: document.getElementById('char-enable-dynamic-age')?.checked || false,
            avatar: 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg',
            myName: document.getElementById('my-name-for-char').value || 'user',
            myPersona: '',
            myAvatar: 'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg',
            theme: 'white_pink',
            maxMemory: 100,
            chatBg: '',
            history: [],
            isPinned: false,
            status: '在线',
            worldBookIds: [],
            useCustomBubbleCss: false,
            customBubbleCss: '',
            bilingualBubbleStyle: 'under',
            unreadCount: 0,
            memoryJournals: [],
            journalWorldBookIds: [],
            lastUserMessageTimestamp: null,
            statusPanel: {enabled:false,promptSuffix:'',regexPattern:'',replacePattern:'',historyLimit:3,currentStatusRaw:'',currentStatusHtml:'',history:[]},
            autoReply: {enabled:false,interval:60,lastTriggerTime:0},
            userAvatarLibrary: [],
            charAvatarLibrary: [],
            charCollectImageAsAvatarEnabled: false,
            coupleAvatarLibrary: [],
            charCollectCoupleAvatarEnabled: false,
            phoneControlEnabled: false,
            phoneControlViewLimit: 10,
            phoneControlHistory: []
        };
        db.characters.push(newChar);
        await saveData();
        renderChatList();
        if (typeof renderContactList === 'function') renderContactList();
        document.getElementById('add-char-modal')?.classList.remove('visible');
        form.reset();
        const personaInput = document.getElementById('char-persona-input');
        if (personaInput) personaInput.value = '';
        const hint = document.getElementById('char-persona-import-hint');
        if (hint) hint.style.display = 'none';
        const personaGroup = document.getElementById('char-persona-group');
        if (personaGroup) personaGroup.style.display = 'none';
        showToast(`角色“${newChar.remarkName}”创建成功！`);
        if (typeof promptForBackupIfNeeded === 'function') promptForBackupIfNeeded('new_char');
    });
}
