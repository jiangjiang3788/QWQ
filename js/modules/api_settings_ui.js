(function () {
  'use strict';

  const SECTION_CONFIG = [
    { key: 'main', label: '主聊天', selector: '#api-form', provider: 'api-provider', url: 'api-url', keyId: 'api-key', model: 'api-model' },
    { key: 'summary', label: '总结', prefix: 'summary', title: '总结专用 API' },
    { key: 'vector', label: '向量', prefix: 'vector', title: '向量记忆 API' },
    { key: 'background', label: '后台', prefix: 'background', title: '后台活动专用 API' },
    { key: 'persona', label: '人设', prefix: 'supplementPersona', title: '补齐人设专用 API' },
    { key: 'vision', label: '识图', prefix: 'imageRecognition', title: '自动识图专用 API' }
  ];

  function byId(id) { return document.getElementById(id); }

  function setTextIfChanged(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
  }

  function findSection(config) {
    if (config.selector) return document.querySelector(config.selector);
    const provider = byId(`${config.prefix}-api-provider`);
    return provider ? provider.closest('.collapsible-section') : null;
  }

  function valuesFor(config) {
    const prefix = config.prefix;
    return {
      provider: byId(config.provider || `${prefix}-api-provider`)?.value || '',
      url: byId(config.url || `${prefix}-api-url`)?.value.trim() || '',
      key: byId(config.keyId || `${prefix}-api-key`)?.value.trim() || '',
      model: byId(config.model || `${prefix}-api-model`)?.value || ''
    };
  }

  function isConfigured(config) {
    const value = valuesFor(config);
    return Boolean(value.url && value.key && value.model);
  }

  function addPasswordToggles(screen) {
    screen.querySelectorAll('input[type="password"][id*="api-key"]').forEach((input) => {
      if (input.parentElement?.classList.contains('api-key-wrap')) return;
      const wrap = document.createElement('div');
      wrap.className = 'api-key-wrap';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'api-key-toggle';
      button.setAttribute('aria-label', '显示密钥');
      button.textContent = '◉';
      button.addEventListener('click', () => {
        const visible = input.type === 'text';
        input.type = visible ? 'password' : 'text';
        button.textContent = visible ? '◉' : '◎';
        button.setAttribute('aria-label', visible ? '显示密钥' : '隐藏密钥');
      });
      wrap.appendChild(button);
    });
  }

  function enhanceModelButtons(screen) {
    screen.querySelectorAll('button[id$="fetch-models-btn"]').forEach((button) => {
      const text = button.querySelector('.btn-text');
      if (text) text.textContent = '测试并拉取';
      const prefix = button.id.replace('-fetch-models-btn', '');
      const modelId = prefix === 'fetch-models-btn' ? 'api-model' : `${prefix}-api-model`;
      const model = byId(modelId) || (button.id === 'fetch-models-btn' ? byId('api-model') : null);
      if (!model || model.dataset.uiObserved) return;
      model.dataset.uiObserved = '1';
      const meta = document.createElement('span');
      meta.className = 'api-model-meta';
      const update = () => {
        const count = [...model.options].filter((opt) => opt.value).length;
        meta.textContent = count ? `${count} 个模型` : '未拉取';
      };
      model.parentElement?.appendChild(meta);
      new MutationObserver(update).observe(model, { childList: true, subtree: true });
      model.addEventListener('change', update);
      update();
    });
  }

  function makePresetsCompact(screen) {
    screen.querySelectorAll('.api-presets-embedded').forEach((box) => {
      const header = box.firstElementChild;
      if (!header || header.dataset.presetToggle) return;
      header.dataset.presetToggle = '1';
      header.setAttribute('role', 'button');
      header.setAttribute('tabindex', '0');
      const toggle = () => box.classList.toggle('preset-open');
      header.addEventListener('click', toggle);
      header.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggle();
        }
      });
    });
  }

  function addSectionStatus(config) {
    const section = findSection(config);
    if (!section || config.key === 'main') return;
    section.id ||= `api-ui-section-${config.key}`;
    const title = section.querySelector('.collapsible-header h3');
    if (!title || title.querySelector('.api-ui-section-tag')) return;
    const tag = document.createElement('span');
    tag.className = 'api-ui-section-tag';
    title.appendChild(tag);
    const update = () => {
      const ready = isConfigured(config);
      tag.textContent = ready ? '已配置' : '跟随主 API';
      tag.classList.toggle('configured', ready);
    };
    section.querySelectorAll('input,select').forEach((el) => el.addEventListener('input', update));
    update();
  }

  function buildHero(screen) {
    if (screen.querySelector('.api-ui-hero')) return;
    const container = screen.querySelector('.kkt-settings-container');
    const form = byId('api-form');
    if (!container || !form) return;

    const hero = document.createElement('section');
    hero.className = 'api-ui-hero';
    hero.innerHTML = `
      <h2 class="api-ui-hero-title">AI 服务管理</h2>
      <p class="api-ui-hero-desc">主 API 负责聊天；专项 API 留空时自动跟随主 API。密钥只保存在当前应用数据中。</p>
      <div class="api-ui-status-row">
        <span class="api-ui-chip" id="api-ui-main-status"><span class="api-ui-dot"></span><span>主 API</span><strong>未配置</strong></span>
        <span class="api-ui-chip" id="api-ui-model-status"><span class="api-ui-dot"></span><span>模型</span><strong>未选择</strong></span>
        <span class="api-ui-chip" id="api-ui-special-status"><span class="api-ui-dot"></span><span>专项 API</span><strong>0 个</strong></span>
      </div>`;
    container.insertBefore(hero, form);

    const nav = document.createElement('nav');
    nav.className = 'api-ui-nav';
    SECTION_CONFIG.forEach((config, index) => {
      const section = findSection(config);
      if (!section) return;
      if (config.key === 'main') section.id = 'api-ui-section-main';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = config.label;
      button.classList.toggle('active', index === 0);
      button.addEventListener('click', () => {
        document.querySelectorAll('.api-ui-nav button').forEach((item) => item.classList.remove('active'));
        button.classList.add('active');
        if (section.classList.contains('collapsible-section')) section.classList.add('open');
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      nav.appendChild(button);
    });
    container.insertBefore(nav, form);

    const footnote = document.createElement('p');
    footnote.className = 'api-ui-footnote';
    footnote.textContent = '“测试并拉取”用于验证地址与密钥并获取模型列表；保存后 QuickDock 会读取当前主 API 的模型。';
    container.appendChild(footnote);
  }

  function updateHero() {
    const main = SECTION_CONFIG[0];
    const values = valuesFor(main);
    const ready = Boolean(values.url && values.key);
    const mainChip = byId('api-ui-main-status');
    const modelChip = byId('api-ui-model-status');
    const specialChip = byId('api-ui-special-status');
    if (mainChip) {
      mainChip.classList.toggle('ready', ready);
      mainChip.classList.toggle('partial', !ready && Boolean(values.url || values.key));
      setTextIfChanged(mainChip.querySelector('strong'), ready ? (values.provider || '已配置') : '未完成');
    }
    if (modelChip) {
      modelChip.classList.toggle('ready', Boolean(values.model));
      setTextIfChanged(modelChip.querySelector('strong'), values.model || '未选择');
    }
    if (specialChip) {
      const count = SECTION_CONFIG.slice(1).filter(isConfigured).length;
      specialChip.classList.toggle('ready', count > 0);
      setTextIfChanged(specialChip.querySelector('strong'), `${count} 个已配置`);
    }
  }

  function init() {
    const screen = byId('api-settings-screen');
    if (!screen || screen.dataset.apiUiEnhanced) return;
    screen.dataset.apiUiEnhanced = '1';
    const title = screen.querySelector('.app-header .title');
    if (title) title.textContent = 'API 管理';
    buildHero(screen);
    addPasswordToggles(screen);
    enhanceModelButtons(screen);
    makePresetsCompact(screen);
    SECTION_CONFIG.forEach(addSectionStatus);
    screen.addEventListener('input', updateHero);
    screen.addEventListener('change', updateHero);
    let heroUpdateQueued = false;
    const scheduleHeroUpdate = () => {
      if (heroUpdateQueued) return;
      heroUpdateQueued = true;
      requestAnimationFrame(() => {
        heroUpdateQueued = false;
        updateHero();
      });
    };
    const observer = new MutationObserver((mutations) => {
      const hasRelevantChange = mutations.some((mutation) => {
        const target = mutation.target.nodeType === Node.ELEMENT_NODE
          ? mutation.target
          : mutation.target.parentElement;
        return !target?.closest?.('.api-ui-hero');
      });
      if (hasRelevantChange) scheduleHeroUpdate();
    });
    observer.observe(screen, { subtree: true, childList: true });
    updateHero();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
