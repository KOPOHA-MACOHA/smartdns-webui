let activeTab = '';
let activeList = '';
let currentSettingsMode = 'ui'; 
let isTestMode = false;

let originalConfigContent = ''; 
let originalListContent = '';

function toggleTestMode(enabled) { isTestMode = enabled; }

// Центральный обработчик API
async function apiCall(action, target = null, body = null) {
    const headers = { 
        'X-API': '1', 
        'X-Action': action,
        'X-Test-Mode': isTestMode ? '1' : '0' 
    };
    if (target) headers['X-Target'] = target;
    
    try {
        // Запрос всегда идёт на /index.cgi, независимо от текущего красивого URL
        const response = await fetch('/index.cgi', { method: 'POST', headers, body });
        const text = await response.text();
        
        if (text.includes('<!DOCTYPE html>')) {
            console.error('API вернуло HTML вместо данных! Проверьте index.cgi');
            return action.startsWith('get_') ? '' : false;
        }
        return action.startsWith('get_') ? text : (text.trim() === 'OK');
    } catch (e) {
        console.error("API Error:", e);
        return action.startsWith('get_') ? '' : false;
    }
}

function updateSaveButtonState() {
    const btn = document.getElementById('global-save-btn');
    if (!btn) return;
    
    let dirty = false;
    const normalizeText = (text) => text.replace(/\r\n/g, '\n').trim();
    
    if (activeTab === 'settings') {
        const currentText = currentSettingsMode === 'ui' ? gatherSectionsText() : document.getElementById('raw-config-text').value;
        dirty = normalizeText(currentText) !== normalizeText(originalConfigContent);
    } else if (activeTab === 'lists') {
        const listEl = document.getElementById('list-content');
        if (listEl && !listEl.disabled) {
            dirty = normalizeText(listEl.value) !== normalizeText(originalListContent);
        }
    }

    btn.disabled = !dirty;
    btn.className = dirty ? 'btn btn-primary btn-sm fw-bold ms-auto' : 'btn btn-outline-secondary btn-sm fw-bold ms-auto';
}

function markConfigDirty() { updateSaveButtonState(); }
function markListDirty() { updateSaveButtonState(); }

function switchSettingsMode(mode) {
    if (currentSettingsMode === mode) return;
    
    const uiView = document.getElementById('settings-ui-view');
    const rawView = document.getElementById('settings-raw-view');
    const btnUI = document.getElementById('btn-mode-ui');
    const btnRaw = document.getElementById('btn-mode-raw');

    if (mode === 'raw') {
        document.getElementById('raw-config-text').value = gatherSectionsText();
        uiView.style.display = 'none'; rawView.style.display = 'block';
        btnUI.className = 'btn btn-sm btn-outline-secondary'; btnRaw.className = 'btn btn-sm btn-primary';
    } else {
        const rawContent = document.getElementById('raw-config-text').value;
        document.getElementById('config-sections').innerHTML = parseConfigToSections(rawContent);
        uiView.style.display = 'block'; rawView.style.display = 'none';
        btnUI.className = 'btn btn-sm btn-primary'; btnRaw.className = 'btn btn-sm btn-outline-secondary';
    }
    
    currentSettingsMode = mode;
    updateSaveButtonState();
}

async function switchTab(tabId, clickedEl, pushState = true) {
    if (tabId === activeTab) return;
    
    const btn = document.getElementById('global-save-btn');
    if (btn && !btn.disabled && !confirm('У вас есть несохраненные изменения. Перейти?')) return;
    
    activeTab = tabId;
    
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.getElementById('tab-' + tabId).classList.add('active');
    
    document.querySelectorAll('.nav-pills .nav-link').forEach(link => link.classList.remove('active'));
    
    // Если кликнули не мышкой, а зашли по ссылке — находим нужную кнопку в меню
    if (!clickedEl) {
        clickedEl = document.querySelector(`.nav-link[onclick*="'${tabId}'"]`);
    }
    if (clickedEl) clickedEl.classList.add('active');
    
    // Меняем URL в строке браузера
    if (pushState) {
        window.history.pushState({ tab: tabId }, '', '/' + tabId);
    }
    
    if (btn) {
        btn.disabled = true;
        btn.className = 'btn btn-outline-secondary btn-sm fw-bold ms-auto';
    }
    
    if (tabId === 'settings') {
        await loadConfig();
    } else if (tabId === 'lists') {
        activeList = ''; // ФИКС: Сбрасываем выбранный лист, чтобы он загрузился заново
        originalListContent = ''; 
        document.getElementById('list-content').value = 'Загрузка...';
        document.getElementById('list-content').disabled = true;
        await loadLists();
    } else if (tabId === 'logs') {
        await loadLog();
    }
}

// Обработка кнопок "Назад" и "Вперед" в браузере
window.addEventListener('popstate', (e) => {
    const tab = (e.state && e.state.tab) ? e.state.tab : 'settings';
    switchTab(tab, null, false);
});

function validateSyntax(text) {
    const lines = text.split('\n');
    const validServers = ['server', 'server-tcp', 'server-tls', 'server-https', 'server-quic', 'server-h3'];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith('#')) continue;
        
        const cmd = line.split(/\s+/)[0];
        if (cmd.startsWith('server-') && !validServers.includes(cmd)) {
            return `Ошибка в строке ${i + 1}:\n"${line}"\nНесуществующая директива '${cmd}'!`;
        }
    }
    return null;
}

async function loadConfig() {
    const content = await apiCall('get_config');
    document.getElementById('config-sections').innerHTML = parseConfigToSections(content);
    
    const normalized = gatherSectionsText();
    originalConfigContent = currentSettingsMode === 'ui' ? normalized : content;
    
    if (currentSettingsMode === 'raw') {
        document.getElementById('raw-config-text').value = content;
    }
    updateSaveButtonState();
}

async function globalSave() {
    let contentToSave = '';
    
    if (activeTab === 'settings') {
        contentToSave = currentSettingsMode === 'ui' ? gatherSectionsText() : document.getElementById('raw-config-text').value;
        const error = validateSyntax(contentToSave);
        if (error) { alert(error); return false; }
        
        await apiCall('save_config', null, contentToSave);
        originalConfigContent = contentToSave; 
        
    } else if (activeTab === 'lists' && activeList) {
        contentToSave = document.getElementById('list-content').value;
        await apiCall('save_list', activeList, contentToSave);
        originalListContent = contentToSave; 
    }
    
    updateSaveButtonState();
    return true; 
}

async function restartService() {
    const btn = document.getElementById('global-save-btn');
    if (!btn.disabled) {
        const saved = await globalSave();
        if (!saved) return;
    }
    await apiCall('restart_service');
    alert('Конфигурация применена, сервис перезапущен!');
}

async function loadLists() {
    const listsRaw = await apiCall('get_lists');
    const lists = listsRaw.split('\n').filter(l => l.trim() !== '');
    let html = '';
    
    lists.forEach(l => {
        const activeClass = l === activeList ? 'active' : 'bg-dark text-light border-secondary';
        // ФИКС: Заменили href="#" на javascript:void(0);, чтобы не ломался роутинг SPA
        html += `<a href="javascript:void(0);" onclick="selectList('${l}')" class="list-group-item list-group-item-action ${activeClass}"><i class="bi bi-file-earmark-text me-2"></i>${l}</a>`;
    });
    
    document.getElementById('lists-container').innerHTML = html;

    if (!activeList && lists.length > 0) {
        await selectList(lists[0]);
    } else {
        updateSaveButtonState();
    }
}

async function selectList(name) {
    const btn = document.getElementById('global-save-btn');
    if (btn && !btn.disabled && activeTab === 'lists' && !confirm('Изменения не сохранены. Продолжить?')) return;
    
    activeList = name;
    
    document.querySelectorAll('#lists-container .list-group-item').forEach(el => {
        el.classList.remove('active');
        el.classList.add('bg-dark', 'text-light', 'border-secondary');
        if (el.innerText.trim() === name) {
            el.classList.add('active');
            el.classList.remove('bg-dark', 'text-light', 'border-secondary');
        }
    });
    
    document.getElementById('current-list-title').innerText = 'Редактирование: ' + name;
    
    const ta = document.getElementById('list-content');
    ta.disabled = true;
    ta.value = 'Загрузка...';
    if (btn) btn.disabled = true; 
    
    const content = await apiCall('get_list', name);
    ta.value = content;
    ta.disabled = false;
    
    originalListContent = content; 
    updateSaveButtonState();
}

async function createList() {
    const input = document.getElementById('new-list-name');
    let name = input.value.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!name) return;
    name += '.list';
    await apiCall('save_list', name, '');
    input.value = '';
    
    await loadLists(); 
    await selectList(name);
}

async function deleteList() {
    if (!activeList || !confirm('Точно удалить ' + activeList + '?')) return;
    await apiCall('delete_list', activeList);
    activeList = '';
    const ta = document.getElementById('list-content');
    ta.value = ''; ta.disabled = true;
    originalListContent = '';
    document.getElementById('current-list-title').innerText = 'Выберите список';
    await loadLists();
}

async function loadLog() {
    document.getElementById('log-content').value = await apiCall('get_log');
}

document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const btn = document.getElementById('global-save-btn');
        if (!btn.disabled) globalSave();
    }
    
    if (e.ctrlKey && e.key === '/') {
        const el = document.activeElement;
        if (el && el.tagName === 'TEXTAREA') {
            e.preventDefault();
            toggleComment(el);
            if (activeTab === 'settings') markConfigDirty();
            if (activeTab === 'lists') markListDirty();
        }
    }
});

function toggleComment(textarea) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const val = textarea.value;
    
    let lineStart = val.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = val.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = val.length;
    
    const selectedText = val.substring(lineStart, lineEnd);
    const lines = selectedText.split('\n');
    
    const allCommented = lines.every(line => line.trim() === '' || line.trim().startsWith('#'));
    
    const newLines = lines.map(line => {
        if (line.trim() === '') return line;
        if (allCommented) {
            return line.replace(/^(\s*)#\s*/, '$1');
        } else {
            return '#' + line;
        }
    });
    
    const newText = newLines.join('\n');
    textarea.value = val.substring(0, lineStart) + newText + val.substring(lineEnd);
    
    textarea.selectionStart = lineStart;
    textarea.selectionEnd = lineStart + newText.length;
}

// === ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ ===
function initApp() {
    const path = window.location.pathname.replace('/', '');
    const validTabs = ['settings', 'lists', 'logs'];
    const startTab = validTabs.includes(path) ? path : 'settings';

    // Фиксируем стартовое состояние в истории
    window.history.replaceState({ tab: startTab }, '', '/' + startTab);
    
    // Запускаем отрисовку нужной вкладки
    switchTab(startTab, null, false);
}

initApp();