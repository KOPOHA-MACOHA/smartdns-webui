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

// === АВТОРЕСАЙЗ ТЕКСТОВЫХ ПОЛЕЙ ===
function autoResizeTextarea(el) {
    // Пропускаем главные большие редакторы (Сырой конфиг, Списки, Логи)
    if (['raw-config-text', 'list-content', 'log-content'].includes(el.id)) return;
    
    el.style.overflow = 'hidden'; // Убираем мерцание скроллбара
    el.style.height = 'auto'; // Сбрасываем высоту для корректного пересчета при удалении строк
    el.style.height = (el.scrollHeight + 2) + 'px'; // Устанавливаем высоту по контенту + бордер
}

document.addEventListener('input', (e) => {
    if (e.target && e.target.tagName === 'TEXTAREA') {
        autoResizeTextarea(e.target);
    }
});

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
        
        // Подгоняем размеры блоков после возврата в визуальный режим
        setTimeout(() => {
            document.querySelectorAll('#config-sections textarea').forEach(autoResizeTextarea);
        }, 10);
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
    
    if (!clickedEl) {
        clickedEl = document.querySelector(`.nav-link[onclick*="'${tabId}'"]`);
    }
    if (clickedEl) clickedEl.classList.add('active');
    
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
        activeList = ''; 
        originalListContent = ''; 
        document.getElementById('list-content').value = 'Загрузка...';
        document.getElementById('list-content').disabled = true;
        await loadLists();
    } else if (tabId === 'logs') {
        await loadLog();
    }
}

window.addEventListener('popstate', (e) => {
    const tab = (e.state && e.state.tab) ? e.state.tab : 'settings';
    switchTab(tab, null, false);
});

// === ЛОГИЧЕСКАЯ И СИНТАКСИЧЕСКАЯ ВАЛИДАЦИЯ КОНФИГА ===
async function validateConfigLogical(text) {
    const lines = text.split('\n');
    const validServers = ['server', 'server-tcp', 'server-tls', 'server-https', 'server-quic', 'server-h3'];
    
    let definedGroups = ['fallback', '#', '-']; 
    let usedLists = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith('#')) continue;
        
        const cmd = line.split(/\s+/)[0];
        
        if (cmd.startsWith('server-') && !validServers.includes(cmd)) {
            return `Ошибка в строке ${i + 1}:\n"${line}"\nНесуществующая директива '${cmd}'!`;
        }

        if (validServers.includes(cmd)) {
            // ФИКС: добавлено (?:\s|^)
            const regex = /(?:\s|^)-group\s+([^\s]+)/g;
            let match;
            while ((match = regex.exec(line)) !== null) {
                definedGroups.push(match[1]);
            }
        }
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith('#')) continue;
        const cmd = line.split(/\s+/)[0];

        if (cmd === 'nameserver') {
            const nsMatch = line.match(/\/domain-set:[^\/]+\/([^\s\/]+)/);
            if (nsMatch) {
                const g = nsMatch[1];
                if (!definedGroups.includes(g)) {
                    return `Отмена сохранения!\nМаршрут ссылается на группу "${g}", но такая группа не создана!\nСначала добавьте её в блоке "Групповые DNS записи".`;
                }
            }
        }

        if (cmd === 'domain-set') {
            const fileMatch = line.match(/-file\s+([^\s]+)/);
            if (fileMatch) {
                usedLists.push(fileMatch[1].replace(/['"]/g, ''));
            }
        }
    }

    if (usedLists.length > 0) {
        const listsRaw = await apiCall('get_lists');
        const availableLists = listsRaw.split('\n').map(l => l.trim()).filter(l => l);
        
        for (let file of usedLists) {
            const fileName = file.split('/').pop();
            if (fileName.endsWith('.list') && !availableLists.includes(fileName)) {
                return `Отмена сохранения!\nМаршрут требует лист "${fileName}", но он не существует!\nПерейдите во вкладку "Списки" и сначала создайте его.`;
            }
        }
    }

    return null; 
}

// === ОСНОВНОЕ СОХРАНЕНИЕ ===
async function globalSave() {
    let contentToSave = '';
    
    if (activeTab === 'settings') {
        contentToSave = currentSettingsMode === 'ui' ? gatherSectionsText() : document.getElementById('raw-config-text').value;
        
        const error = await validateConfigLogical(contentToSave);
        if (error) { 
            alert(error); 
            return false; 
        }
        
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

async function loadConfig() {
    const content = await apiCall('get_config');
    document.getElementById('config-sections').innerHTML = parseConfigToSections(content);
    
    const normalized = gatherSectionsText();
    originalConfigContent = currentSettingsMode === 'ui' ? normalized : content;
    
    if (currentSettingsMode === 'raw') {
        document.getElementById('raw-config-text').value = content;
    }
    updateSaveButtonState();
    
    // Подгоняем размеры блоков сразу после отрисовки конфига
    setTimeout(() => {
        document.querySelectorAll('#config-sections textarea').forEach(autoResizeTextarea);
    }, 10);
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

// === АВТООБНОВЛЕНИЕ ===
async function checkUpdate() {
    const btn = document.getElementById('btn-update');
    const verText = document.getElementById('current-version-text');
    const badge = document.getElementById('update-badge');
    
    const res = await apiCall('get_update');
    if (!res || !res.includes('|')) {
        verText.innerText = "???";
        return;
    }
    
    const [current, latest] = res.trim().split('|');
    verText.innerText = current; 
    
    if (latest && latest !== current && !latest.includes('<')) {
        btn.classList.remove('btn-outline-secondary');
        btn.classList.add('btn-outline-success');
        btn.disabled = false;
        btn.title = `Доступна новая версия: v${latest}\nНажмите для обновления`;
        badge.classList.remove('d-none');
    } else {
        btn.title = 'У вас установлена актуальная версия';
    }
}

async function performUpdate() {
    const btn = document.getElementById('btn-update');
    const latestVer = btn.title.match(/v([\d\.]+)/) ? btn.title.match(/v([\d\.]+)/)[1] : '';
    
    if (!confirm(`Найдена новая версия на GitHub${latestVer ? ' (' + latestVer + ')' : ''}. Скачать и установить? Страница будет перезагружена.`)) return;
    
    btn.innerHTML = `<i class="bi bi-hourglass-split me-1"></i> Обновление...`;
    btn.disabled = true;
    document.getElementById('update-badge')?.classList.add('d-none');
    
    await apiCall('do_update');
    
    setTimeout(() => {
        window.location.reload(true);
    }, 4000);
}

// === ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ ===
function initApp() {
    const path = window.location.pathname.replace('/', '');
    const validTabs = ['settings', 'lists', 'logs'];
    const startTab = validTabs.includes(path) ? path : 'settings';

    window.history.replaceState({ tab: startTab }, '', '/' + startTab);
    switchTab(startTab, null, false);
    
    setTimeout(checkUpdate, 2000);
}

initApp();