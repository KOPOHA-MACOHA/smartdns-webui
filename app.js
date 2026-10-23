let activeTab = '';
let activeList = '';
let currentSettingsMode = 'ui'; 
let isTestMode = false;

window.rawEditor = null;
let rawEditor = null; // Глобальная переменная для редактора с подсветкой

function resetToHome() {
    switchTab('settings', null, true);
    switchSettingsMode('ui');
}

let originalConfigContent = ''; 
let configRevision = '';
let configSnapshotMode = false;
let preflightBusy = false;
let originalListContent = '';

const settingsUndoHistory = {
    undo: [],
    redo: [],
    lastSnapshot: null,
    pending: false,
    timer: null,
    limit: 30
};

function captureSettingsSnapshot() {
    const root = document.getElementById('config-sections');
    if (!root) return null;
    const controls = Array.from(root.querySelectorAll('input, textarea, select'));
    const active = document.activeElement;
    const activeIndex = controls.indexOf(active);
    let selectionStart = null;
    let selectionEnd = null;
    try {
        if (active && typeof active.selectionStart === 'number') {
            selectionStart = active.selectionStart;
            selectionEnd = active.selectionEnd;
        }
    } catch (_) {}

    return {
        html: root.innerHTML,
        controls: controls.map(el => ({
            value: el.value,
            checked: 'checked' in el ? el.checked : null,
            selectedIndex: el.tagName === 'SELECT' ? el.selectedIndex : null
        })),
        activeId: active && root.contains(active) ? active.id : '',
        activeIndex,
        selectionStart,
        selectionEnd
    };
}

function settingsSnapshotsEqual(a, b) {
    return !!a && !!b && a.html === b.html &&
        JSON.stringify(a.controls) === JSON.stringify(b.controls);
}

function pushSettingsUndo(snapshot) {
    if (!snapshot) return;
    settingsUndoHistory.undo.push(snapshot);
    if (settingsUndoHistory.undo.length > settingsUndoHistory.limit) {
        settingsUndoHistory.undo.shift();
    }
    settingsUndoHistory.redo = [];
}

function resetSettingsUndoHistory() {
    if (settingsUndoHistory.timer) clearTimeout(settingsUndoHistory.timer);
    settingsUndoHistory.undo = [];
    settingsUndoHistory.redo = [];
    settingsUndoHistory.pending = false;
    settingsUndoHistory.timer = null;
    settingsUndoHistory.lastSnapshot = captureSettingsSnapshot();
}

function commitPendingSettingsEdit() {
    if (settingsUndoHistory.timer) clearTimeout(settingsUndoHistory.timer);
    settingsUndoHistory.timer = null;
    if (settingsUndoHistory.pending) {
        settingsUndoHistory.lastSnapshot = captureSettingsSnapshot();
        settingsUndoHistory.pending = false;
    }
}

function scheduleSettingsUndoCheckpoint() {
    if (activeTab !== 'settings' || currentSettingsMode !== 'ui') return;
    const current = captureSettingsSnapshot();
    if (!current) return;

    if (!settingsUndoHistory.lastSnapshot) {
        settingsUndoHistory.lastSnapshot = current;
        return;
    }
    if (settingsSnapshotsEqual(settingsUndoHistory.lastSnapshot, current)) return;

    if (!settingsUndoHistory.pending) {
        pushSettingsUndo(settingsUndoHistory.lastSnapshot);
        settingsUndoHistory.pending = true;
    }
    if (settingsUndoHistory.timer) clearTimeout(settingsUndoHistory.timer);
    settingsUndoHistory.timer = setTimeout(() => {
        settingsUndoHistory.lastSnapshot = captureSettingsSnapshot();
        settingsUndoHistory.pending = false;
        settingsUndoHistory.timer = null;
    }, 500);
}

function restoreSettingsSnapshot(snapshot) {
    const root = document.getElementById('config-sections');
    if (!root || !snapshot) return;

    root.innerHTML = snapshot.html;
    const controls = Array.from(root.querySelectorAll('input, textarea, select'));
    controls.forEach((el, index) => {
        const state = snapshot.controls[index];
        if (!state) return;
        el.value = state.value;
        if (state.checked !== null && 'checked' in el) el.checked = state.checked;
        if (el.tagName === 'SELECT' && state.selectedIndex !== null) el.selectedIndex = state.selectedIndex;
    });

    if (typeof refreshRouteGroupOptions === 'function') refreshRouteGroupOptions();
    if (typeof refreshRouteFileOptions === 'function') refreshRouteFileOptions();
    if (typeof initSortable === 'function') initSortable();

    let focusTarget = snapshot.activeId ? root.querySelector('#' + CSS.escape(snapshot.activeId)) : null;
    if (!focusTarget && snapshot.activeIndex >= 0) focusTarget = controls[snapshot.activeIndex];
    if (focusTarget && root.contains(focusTarget)) {
        focusTarget.focus({ preventScroll: true });
        try {
            if (snapshot.selectionStart !== null && typeof focusTarget.setSelectionRange === 'function') {
                focusTarget.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
            }
        } catch (_) {}
    }

    setTimeout(() => root.querySelectorAll('textarea').forEach(autoResizeTextarea), 0);
    settingsUndoHistory.lastSnapshot = captureSettingsSnapshot();
    settingsUndoHistory.pending = false;
    if (settingsUndoHistory.timer) clearTimeout(settingsUndoHistory.timer);
    settingsUndoHistory.timer = null;
    updateSaveButtonState();
}

function undoSettingsChange() {
    commitPendingSettingsEdit();
    if (!settingsUndoHistory.undo.length) return;
    const current = captureSettingsSnapshot();
    const previous = settingsUndoHistory.undo.pop();
    if (current) {
        settingsUndoHistory.redo.push(current);
        if (settingsUndoHistory.redo.length > settingsUndoHistory.limit) settingsUndoHistory.redo.shift();
    }
    restoreSettingsSnapshot(previous);
}

function redoSettingsChange() {
    commitPendingSettingsEdit();
    if (!settingsUndoHistory.redo.length) return;
    const current = captureSettingsSnapshot();
    const next = settingsUndoHistory.redo.pop();
    if (current) {
        settingsUndoHistory.undo.push(current);
        if (settingsUndoHistory.undo.length > settingsUndoHistory.limit) settingsUndoHistory.undo.shift();
    }
    restoreSettingsSnapshot(next);
}
function toggleTestMode(enabled) { isTestMode = enabled; }

// Центральный обработчик API
async function apiCall(action, target = null, body = null, strict = false, revision = '') {
    const headers = { 
        'X-API': '1', 
        'X-Action': action,
        'X-Test-Mode': isTestMode ? '1' : '0' 
    };
    if (target) headers['X-Target'] = target;
    if (revision) headers['X-Config-Revision'] = revision;
    
    try {
        const response = await fetch('/index.cgi', { method: 'POST', headers, body });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const text = await response.text();
        
        if (text.includes('<!DOCTYPE html>')) {
            if (strict) throw new Error('Вместо конфигурации получена HTML-страница.');
            console.error('API вернуло HTML вместо данных! Проверьте index.cgi');
            return action.startsWith('get_') ? '' : false;
        }
        return action.startsWith('get_') || ['save_config', 'validate_config', 'preflight_config', 'apply_config', 'confirm_apply', 'abort_apply'].includes(action) ? text : (action === 'restart_service' ? text.trim() : (text.trim() === 'OK'));
    } catch (e) {
        if (strict) throw e;
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

function markConfigDirty() { scheduleSettingsUndoCheckpoint(); updateSaveButtonState(); }
function markListDirty() { updateSaveButtonState(); }

// === АВТОРЕСАЙЗ ТЕКСТОВЫХ ПОЛЕЙ ===
function autoResizeTextarea(el) {
    if (['raw-config-text', 'list-content', 'log-content'].includes(el.id)) return;
    
    el.style.overflow = 'hidden'; 
    el.style.height = 'auto'; 
    el.style.height = (el.scrollHeight + 2) + 'px'; 
}

document.addEventListener('input', (e) => {
    if (e.target && e.target.tagName === 'TEXTAREA') {
        autoResizeTextarea(e.target);
    }
});

// Reshape parser output into three focused settings tabs without changing field IDs.
function switchConfigSubtab(id, clicked) {
    const root = document.getElementById('config-sections');
    if (!root) return;
    root.querySelectorAll('.settings-subtab-panel').forEach(panel => panel.classList.toggle('active', panel.id === 'settings-subtab-' + id));
    root.querySelectorAll('.settings-subnav .nav-link').forEach(link => link.classList.toggle('active', link === clicked || link.dataset.subtab === id));
    // Textareas in inactive sub-tabs have no measurable layout. Resize them after the panel becomes visible.
    const activePanel = root.querySelector('#settings-subtab-' + id);
    setTimeout(() => {
        activePanel?.querySelectorAll('textarea').forEach(autoResizeTextarea);
    }, 0);
    try { localStorage.setItem('smartdns-ui-active-subtab', id); } catch (_) {}
}
window.switchConfigSubtab = switchConfigSubtab;

function organizeConfigSections() {
    const root = document.getElementById('config-sections');
    const row = root?.querySelector(':scope > .row');
    if (!root || !row) return;
    const cols = Array.from(row.children).filter(el => el.classList.contains('col-md-6'));
    if (!cols.length) return;
    const cards = cols.flatMap(col => Array.from(col.children).filter(el => el.classList.contains('card')));
    const nav = document.createElement('div');
    nav.className = 'settings-subnav nav nav-pills';
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', 'Разделы настроек');
    nav.innerHTML = [
        ['core','Основное','bi-sliders'],
        ['groups','Группы DNS','bi-diagram-3'],
        ['routing','Маршрутизация','bi-signpost-split']
    ].map(([id,label,icon]) => '<button type="button" class="nav-link" role="tab" data-subtab="' + id + '" onclick="switchConfigSubtab(\'' + id + '\', this)"><i class="bi ' + icon + ' me-1"></i>' + label + '</button>').join('');
    const panels = {};
    [['core','Основное'],['groups','Группы DNS'],['routing','Маршрутизация']].forEach(([id,label]) => {
        const panel = document.createElement('section');
        panel.id = 'settings-subtab-' + id;
        panel.className = 'settings-subtab-panel';
        panel.setAttribute('role','tabpanel');
        panel.setAttribute('aria-label',label);
        panels[id] = panel;
    });
    cards.forEach(card => {
        let target = 'routing';
        if (card.querySelector('#core-bind, #sec-bootstrap, #sec-upstream, #sec-fallback, #sec-logging-select')) target = 'core';
        else if (card.querySelector('#dynamic-groups-container')) target = 'groups';
        panels[target].appendChild(card);
    });
    row.remove();
    const sourceRecord = root.querySelector('#config-source-record');
    root.replaceChildren(nav, panels.core, panels.groups, panels.routing);
    if (sourceRecord) root.append(sourceRecord);
    let active = 'core';
    try {
        const saved = localStorage.getItem('smartdns-ui-active-subtab');
        if (['core','groups','routing'].includes(saved)) active = saved;
    } catch (_) {}
    switchConfigSubtab(active, nav.querySelector('[data-subtab="' + active + '"]'));
    if (typeof window.applyDnsGroupCollapseState === 'function') window.applyDnsGroupCollapseState();
}

function organizeDnsBlocks() {
    try {
        const rawMode = currentSettingsMode === 'raw';
        const source = rawMode ? (rawEditor ? rawEditor.getValue() : document.getElementById('raw-config-text').value) : gatherSectionsText();
        const organized = organizeDnsSource(source);
        if (organized === source) return;
        if (rawMode) {
            document.getElementById('raw-config-text').value = organized;
            if (rawEditor) rawEditor.setValue(organized);
        } else {
            document.getElementById('config-sections').innerHTML = parseConfigToSections(organized);
            organizeConfigSections();
            refreshRouteGroupOptions();
            if (typeof refreshRouteFileOptions === 'function') refreshRouteFileOptions();
            document.querySelectorAll('#config-sections textarea').forEach(autoResizeTextarea);
            initSortable();
        }
        markConfigDirty();
    } catch (error) { alert(error.message); }
}

function switchSettingsMode(mode) {
    if (currentSettingsMode === mode) return;
    
    const uiView = document.getElementById('settings-ui-view');
    const rawView = document.getElementById('settings-raw-view');
    const btnUI = document.getElementById('btn-mode-ui');
    const btnRaw = document.getElementById('btn-mode-raw');

    if (mode === 'raw') {
        const configText = gatherSectionsText();
        document.getElementById('raw-config-text').value = configText;
        
        uiView.style.display = 'none'; 
        rawView.style.display = 'block';
        btnUI.className = 'btn btn-sm btn-outline-secondary'; 
        btnRaw.className = 'btn btn-sm btn-primary';

        if (!rawEditor) {
            CodeMirror.defineSimpleMode("smartdns", {
              start: [
                {regex: /#.*/, token: "comment"},
                {regex: /^(server(?:-[a-z0-9]+)?)\b/, token: "keyword"}, 
                {regex: /^(bind-tcp|bind|force-AAAA-SOA|cache-persist|cache-size|prefetch-domain|serve-expired|response-mode|speed-check-mode|log-level|address|domain-set|nameserver|ipset|nftset)\b/, token: "builtin"},
                {regex: /-(group|bootstrap-dns|exclude-default-group|name|file|e)\b/, token: "attribute"}, 
                {regex: /(?:https|tls|quic|h3|tcp):\/\/[^\s]+/, token: "string"}, 
                {regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/, token: "number"} 
              ]
            });
            rawEditor = CodeMirror.fromTextArea(document.getElementById('raw-config-text'), {
                mode: "smartdns",
                theme: "default",
                lineNumbers: true,
                lineWrapping: true,
                extraKeys: {
                    "Ctrl-/": toggleCommentRaw,
                    "Cmd-/": toggleCommentRaw
                }
            });
            window.rawEditor = rawEditor;
            rawEditor.on('change', () => {
                document.getElementById('raw-config-text').value = rawEditor.getValue();
                markConfigDirty();
            });
        }
        
        rawEditor.setValue(configText);
        setTimeout(() => rawEditor.refresh(), 10);

    } else {
        const rawContent = rawEditor ? rawEditor.getValue() : document.getElementById('raw-config-text').value;
        document.getElementById('config-sections').innerHTML = parseConfigToSections(rawContent);
        organizeConfigSections();
        if (typeof refreshRouteGroupOptions === 'function') refreshRouteGroupOptions();
        if (typeof refreshRouteFileOptions === 'function') refreshRouteFileOptions();
        
        uiView.style.display = 'block'; 
        rawView.style.display = 'none';
        btnUI.className = 'btn btn-sm btn-primary'; 
        btnRaw.className = 'btn btn-sm btn-outline-secondary';
        
        setTimeout(() => {
            document.querySelectorAll('#config-sections textarea').forEach(autoResizeTextarea);
            initSortable();
        }, 10);
    }
    
    currentSettingsMode = mode;
    resetSettingsUndoHistory();
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
    if (currentSettingsMode !== 'ui') return null;
    const names = new Set();
    for (const item of document.querySelectorAll('.group-item')) {
        const name = item.querySelector('.group-name-input').value.trim();
        if (!name) return 'Укажите имя DNS-группы или удалите незаполненную карточку.';
        if (names.has(name)) return 'Карточка DNS-группы «' + name + '» повторяется.';
        names.add(name);
    }
    for (const [index, item] of Array.from(document.querySelectorAll('.route-item')).entries()) {
        if (!item.querySelector('.route-name')?.value.trim()) return 'Маршрут №' + (index + 1) + ': укажите имя набора.';
        if (!item.querySelector('.route-group')?.value.trim()) return 'Маршрут №' + (index + 1) + ': выберите группу.';
        const files = Array.from(item.querySelectorAll('.route-file-select'));
        if (!files.length || files.some(input => !input.value.trim())) return 'Маршрут №' + (index + 1) + ': выберите все списки.';
    }
    return null;
}

async function validateConfigOnServer(content) {
    return window.parseValidationReport(await apiCall('validate_config', null, content, true));
}

async function validateCurrentConfig() {
    if (activeTab !== 'settings') { alert('Перейдите в настройки для проверки конфигурации.'); return; }
    try {
        const content = currentSettingsMode === 'ui' ? gatherSectionsText() : document.getElementById('raw-config-text').value;
        await window.reviewValidationReport(await validateConfigOnServer(content), true);
    } catch (error) { alert('Проверка не выполнена: ' + error.message); }
}

async function preflightCurrentConfig() {
    if (activeTab !== 'settings' || preflightBusy) return;
    const button = document.getElementById('preflight-config-btn');
    const restart = document.getElementById('restart-service-btn');
    const oldHtml = button?.innerHTML;
    const restartDisabled = restart?.disabled;
    preflightBusy = true;
    if (button) { button.disabled = true; button.textContent = 'Тест DNS…'; button.setAttribute('aria-busy', 'true'); }
    if (restart) restart.disabled = true;
    try {
        const content = currentSettingsMode === 'ui' ? gatherSectionsText() : document.getElementById('raw-config-text').value;
        const error = await validateConfigLogical(content);
        if (error) { alert(error); return; }
        if (!await window.reviewValidationReport(await validateConfigOnServer(content))) return;
        const reply = await apiCall('preflight_config', null, content, true);
        await window.reviewValidationReport(window.parseValidationReport(reply), true);
    } catch (error) { alert('Тест DNS не подтверждён: ' + error.message); }
    finally {
        preflightBusy = false;
        if (button) { button.disabled = false; button.innerHTML = oldHtml; button.removeAttribute('aria-busy'); }
        if (restart) restart.disabled = restartDisabled;
    }
}

// === ОСНОВНОЕ СОХРАНЕНИЕ ===
async function readConfigSnapshot() {
    const reply = await apiCall('get_config_snapshot', null, null, true);
    if (typeof reply !== 'string' || !/^REVISION [0-9a-f]{64}\n/.test(reply)) throw new Error('Не удалось прочитать версию конфигурации. Обновите WebUI.');
    return {revision:reply.slice(9, 73), content:reply.slice(74)};
}

async function globalSave() {
    let contentToSave = '';
    
    if (activeTab === 'settings') {
        try {
            contentToSave = currentSettingsMode === 'ui' ? gatherSectionsText() : document.getElementById('raw-config-text').value;
        } catch (error) {
            alert(error.message);
            return false;
        }
        
        const error = await validateConfigLogical(contentToSave);
        if (error) {
            alert(error);
            return false;
        }

        // The router validates this exact text; the same check is repeated on save.
        try {
            if (!configRevision || configSnapshotMode !== isTestMode) throw new Error('Заново загрузите конфигурацию выбранного режима перед сохранением.');
            const report = await validateConfigOnServer(contentToSave);
            if (!await window.reviewValidationReport(report)) return false;
            const snapshot = await readConfigSnapshot();
            if (snapshot.revision !== configRevision) throw new Error('Файл изменён другим сеансом. Ваши правки остались в редакторе. Скопируйте их из Raw и заново загрузите конфигурацию.');
            if (!await window.reviewConfigChanges(snapshot.content, contentToSave)) return false;
            const reply = await apiCall('save_config', null, contentToSave, true, configRevision);
            if (typeof reply !== 'string' || !/^OK\nREVISION [0-9a-f]{64}(?:\n|$)/.test(reply)) {
                if (typeof reply === 'string' && reply.startsWith('VALIDATION_FAILED\n')) {
                    await window.reviewValidationReport(window.parseValidationReport(reply.slice(18)), true);
                    return false;
                }
                if (typeof reply === 'string' && reply.startsWith('CONFLICT:')) throw new Error('Файл изменился во время просмотра. Запись отменена; правки сохранены в редакторе.');
                if (typeof reply === 'string' && reply.startsWith('BUSY:')) throw new Error('Другой сеанс сейчас сохраняет файл. Повторите позже.');
                throw new Error('Сохранение не подтверждено. Проверьте соединение и возможность создания резервной копии.');
            }
            configRevision = reply.slice(12, 76);
        } catch (error) {
            alert(error.message);
            return false;
        }
        originalConfigContent = contentToSave; 
        
    } else if (activeTab === 'lists' && activeList) {
        contentToSave = document.getElementById('list-content').value;
        const saved = await apiCall('save_list', activeList, contentToSave);
        if (!saved) {
            alert('Не удалось сохранить список. Изменения остались в редакторе.');
            return false;
        }
        originalListContent = contentToSave; 
    }
    
    updateSaveButtonState();
    return true; 
}

async function loadConfig() {
    let snapshot;
    try { snapshot = await readConfigSnapshot(); }
    catch (error) { alert(error.message); return; }
    const content = snapshot.content;
    configRevision = snapshot.revision;
    configSnapshotMode = isTestMode;
    document.getElementById('config-sections').innerHTML = parseConfigToSections(content);
    organizeConfigSections();
    if (typeof refreshRouteGroupOptions === 'function') refreshRouteGroupOptions();
    if (typeof refreshRouteFileOptions === 'function') await refreshRouteFileOptions();
    
    const normalized = gatherSectionsText();
    originalConfigContent = currentSettingsMode === 'ui' ? normalized : content;
    
    if (currentSettingsMode === 'raw') {
        document.getElementById('raw-config-text').value = content;
    }
    resetSettingsUndoHistory();
    updateSaveButtonState();
    
    setTimeout(() => {
        document.querySelectorAll('#config-sections textarea').forEach(autoResizeTextarea);
        initSortable();
    }, 10);
}

let safeApplyBusy = false;
async function restartService() {
    if (safeApplyBusy || preflightBusy || activeTab !== 'settings') return;
    safeApplyBusy = true;
    const btn = document.getElementById('restart-service-btn');
    const oldHtml = btn?.innerHTML;
    let operationObserved = false;
    if (btn) { btn.disabled=true; btn.textContent='Применение…'; }
    try {
        if (isTestMode) throw new Error('Применение отключено в тестовом режиме UI. Рабочий DNS не изменён.');
        let pending = localStorage.getItem('smartdns-apply-transaction');
        if (!pending && !isTestMode) {
            const active = await apiCall('get_active_apply',null,null,true);
            if (active.trim() !== 'NONE') {
                const found = /^TRANSACTION (tx-[A-Za-z0-9]{12})\n?$/.exec(active);
                if (!found) throw new Error('Не удалось определить текущую операцию применения.');
                pending = found[1];localStorage.setItem('smartdns-apply-transaction',pending);
            }
        }
        if (pending) {
            operationObserved = true;
            await window.monitorSafeApply(pending, (action,id)=>apiCall(action,id,null,true));
            return;
        }
        if (!configRevision || configSnapshotMode !== isTestMode) throw new Error('Заново загрузите конфигурацию перед применением.');
        const content = currentSettingsMode === 'ui' ? gatherSectionsText() : document.getElementById('raw-config-text').value;
        const error = await validateConfigLogical(content);
        if (error) throw new Error(error);
        if (!await window.reviewValidationReport(await validateConfigOnServer(content))) return;
        const snapshot = await readConfigSnapshot();
        if (snapshot.revision !== configRevision) throw new Error('Файл изменён другим сеансом. Ваши правки остались в редакторе.');
        if (!await window.reviewConfigChanges(snapshot.content, content, {apply:true})) return;
        if (!confirm('Применить конфигурацию с перезапуском DNS?\n\nОткат вернёт текущий файл на диске. Он может отличаться от настроек запущенного процесса, если вы ранее сохранили файл без рестарта. Старый файл и кандидат сначала пройдут отдельный тест.\n\nНа проверку и подтверждение отведено 180 секунд с начала операции. Без подтверждения начнётся автоматический откат.')) return;
        const reply = await apiCall('apply_config', null, content, true, configRevision);
        const match = /^OK\nTRANSACTION (tx-[A-Za-z0-9]{12})\n?$/.exec(reply);
        if (!match) throw new Error(String(reply).slice(0,500));
        operationObserved = true;
        localStorage.setItem('smartdns-apply-transaction',match[1]);
        await window.monitorSafeApply(match[1],(action,id)=>apiCall(action,id,null,true));
    } catch(error) { alert('Применение не подтверждено: '+error.message); }
    finally {
        safeApplyBusy=false;
        if(btn) { btn.disabled=false;btn.innerHTML=oldHtml; }
        // Refresh the saved baseline without overwriting edits made while polling.
        if (operationObserved) try {
            const snapshot=await readConfigSnapshot();
            configRevision=snapshot.revision;originalConfigContent=snapshot.content;
            updateSaveButtonState();
        } catch (_) { /* Keep the editor intact if the connection was lost. */ }
    }
}

async function loadLists() {
    const listsRaw = await apiCall('get_lists');
    const lists = listsRaw.split('\n').filter(l => l.trim() !== '');
    const container = document.getElementById('lists-container');
    container.replaceChildren();

    lists.forEach(name => {
        const item = document.createElement('div');
        item.className = 'list-group-item list-group-item-action d-flex align-items-center gap-2 ' +
            (name === activeList ? 'active' : 'bg-dark text-light border-secondary');
        item.setAttribute('role', 'group');
        item.title = name;

        const selectButton = document.createElement('button');
        selectButton.type = 'button';
        selectButton.dataset.listName = name;
        selectButton.setAttribute('aria-label', 'Выбрать список ' + name);
        selectButton.className = 'btn btn-link text-start text-decoration-none p-0 flex-grow-1 text-reset';
        selectButton.style.minWidth = '0';
        selectButton.style.overflowWrap = 'anywhere';
        const icon = document.createElement('i');
        icon.className = 'bi bi-file-earmark-text me-2';
        selectButton.append(icon, document.createTextNode(name));
        selectButton.addEventListener('click', () => selectList(name));

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'btn btn-sm btn-outline-danger flex-shrink-0';
        deleteButton.title = 'Удалить список ' + name;
        deleteButton.setAttribute('aria-label', 'Удалить список ' + name);
        deleteButton.innerHTML = '<i class="bi bi-trash"></i>';
        deleteButton.addEventListener('click', event => {
            event.stopPropagation();
            deleteList(name);
        });

        item.append(selectButton, deleteButton);
        container.appendChild(item);
    });

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
        const selected = el.querySelector('button[aria-label^="Выбрать список"]')?.dataset.listName === name;
        el.classList.toggle('active', selected);
        el.classList.toggle('bg-dark', !selected);
        el.classList.toggle('text-light', !selected);
        el.classList.toggle('border-secondary', !selected);
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
    const saved = await apiCall('save_list', name, '');
    if (!saved) {
        alert('Не удалось создать список. Проверьте права доступа и журнал.');
        return;
    }
    input.value = '';
    
    await loadLists(); 
    await selectList(name);
}

async function deleteList(name = activeList) {
    if (!name || !confirm('Точно удалить ' + name + '?')) return;
    if (name === activeList) {
        const saveButton = document.getElementById('global-save-btn');
        if (saveButton && !saveButton.disabled &&
            !confirm('В текущем списке есть несохранённые изменения. Удалить список вместе с ними?')) return;
    }

    const deleted = await apiCall('delete_list', name);
    if (!deleted) {
        alert('Не удалось удалить список. Проверьте права доступа и журнал.');
        return;
    }

    if (name === activeList) {
        activeList = '';
        const ta = document.getElementById('list-content');
        ta.value = '';
        ta.disabled = true;
        originalListContent = '';
        document.getElementById('current-list-title').innerText = 'Выберите список';
    }
    await loadLists();
}

async function loadLog() {
    document.getElementById('log-content').value = await apiCall('get_log');
}

document.addEventListener('click', (e) => {
    if (activeTab !== 'settings' || currentSettingsMode !== 'ui' ||
        !e.target.closest('#config-sections')) return;

    // Structural actions do not fire input/change events, so save the DOM before
    // adding/removing a route, DNS group, or route-list row.
    const action = e.target.closest('button[onclick]');
    const handler = action?.getAttribute('onclick') || '';
    const changesStructure = /addNewGroupUI|addNewRouteUI|addRouteFileUI|\.closest\('\.(?:group-item|route-item|route-file-row)'\)\.remove\(\)/.test(handler);
    if (changesStructure) {
        commitPendingSettingsEdit();
        const before = captureSettingsSnapshot();
        if (before && (!settingsUndoHistory.lastSnapshot ||
            !settingsSnapshotsEqual(settingsUndoHistory.lastSnapshot, before))) {
            settingsUndoHistory.lastSnapshot = before;
        }
        if (before) pushSettingsUndo(before);
        settingsUndoHistory.lastSnapshot = before;
        return;
    }

    commitPendingSettingsEdit();
}, true);

// Capture a select's state before the user changes it. The DOM value is already
// updated by the time its change event fires, so relying only on that event can
// leave undo history with a post-change snapshot.
const selectUndoBefore = new WeakMap();
function rememberSelectUndoBefore(target) {
    if (activeTab !== 'settings' || currentSettingsMode !== 'ui' ||
        !target || target.tagName !== 'SELECT' ||
        !target.closest('#config-sections')) return;
    const snapshot = captureSettingsSnapshot();
    if (snapshot) selectUndoBefore.set(target, snapshot);
}

document.addEventListener('focusin', (e) => rememberSelectUndoBefore(e.target), true);
document.addEventListener('pointerdown', (e) => rememberSelectUndoBefore(e.target), true);
document.addEventListener('keydown', (e) => {
    if (!e.ctrlKey && !e.metaKey && !e.altKey) rememberSelectUndoBefore(e.target);
}, true);

// Select values have already changed when the change event fires. Prefer the
// snapshot captured on focus/pointer/keyboard interaction, then advance baseline.
document.addEventListener('change', (e) => {
    if (activeTab !== 'settings' || currentSettingsMode !== 'ui' ||
        !e.target || e.target.tagName !== 'SELECT' ||
        !e.target.closest('#config-sections')) return;
    const current = captureSettingsSnapshot();
    const previous = selectUndoBefore.get(e.target) || settingsUndoHistory.lastSnapshot;
    selectUndoBefore.delete(e.target);
    if (!current || !previous || settingsSnapshotsEqual(previous, current)) {
        settingsUndoHistory.lastSnapshot = current || settingsUndoHistory.lastSnapshot;
        return;
    }

    // Finish any edit already in progress before recording the select change.
    // The prior edit has its own undo entry; the select needs an additional
    // checkpoint for the exact state immediately before this selection.
    commitPendingSettingsEdit();
    pushSettingsUndo(previous);
    settingsUndoHistory.lastSnapshot = current;
}, true);

document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.altKey && activeTab === 'settings' && currentSettingsMode === 'ui') {
        const key = e.key.toLowerCase();
        if (key === 'z' && !e.shiftKey) {
            e.preventDefault();
            undoSettingsChange();
            return;
        }
        if (key === 'y' || (key === 'z' && e.shiftKey)) {
            e.preventDefault();
            redoSettingsChange();
            return;
        }
    }

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

function toggleCommentRaw(cm) {
    const from = cm.getCursor('from');
    const to = cm.getCursor('to');
    const firstLine = from.line;
    const lastLine = to.ch === 0 && to.line > firstLine ? to.line - 1 : to.line;
    const lines = [];
    for (let line = firstLine; line <= lastLine; line++) lines.push(cm.getLine(line));

    const allCommented = lines.every(line => line.trim() === '' || line.trim().startsWith('#'));
    const updated = lines.map(line => {
        if (line.trim() === '') return line;
        return allCommented ? line.replace(/^(\s*)#\s?/, '$1') : '#' + line;
    });

    cm.operation(() => {
        cm.replaceRange(updated.join('\n'), { line: firstLine, ch: 0 }, {
            line: lastLine,
            ch: cm.getLine(lastLine).length
        });
        cm.setSelection(
            { line: firstLine, ch: 0 },
            { line: lastLine, ch: updated[updated.length - 1].length }
        );
    });
}

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
    btn.disabled = true;
    btn.classList.remove('btn-outline-success');
    btn.classList.add('btn-outline-secondary');
    badge.classList.add('d-none');

    const comparison = typeof window.compareSmartDnsVersions === 'function'
        ? window.compareSmartDnsVersions(current, latest)
        : null;

    if (comparison === 1) {
        btn.classList.remove('btn-outline-secondary');
        btn.classList.add('btn-outline-success');
        btn.disabled = false;
        btn.title = `Доступна новая версия: v${latest}\nНажмите для обновления`;
        badge.classList.remove('d-none');
    } else if (comparison === null) {
        btn.title = 'Не удалось проверить корректную версию на GitHub';
    } else if (comparison < 0) {
        btn.title = `Ветка main содержит более старую версию (v${latest}). Откат не предлагается.`;
    } else {
        btn.title = 'У вас установлена актуальная версия';
    }
}

async function performUpdate() {
    const btn = document.getElementById('btn-update');
    const latestVer = btn.title.match(/v([\d\.]+)/) ? btn.title.match(/v([\d\.]+)/)[1] : '';

    if (!confirm(`Найдена новая версия на GitHub${latestVer ? ' (' + latestVer + ')' : ''}. Скачать и установить?`)) return;

    const originalButtonHtml = btn.innerHTML;
    btn.innerHTML = `<i class="bi bi-hourglass-split me-1"></i> Обновление...`;
    btn.disabled = true;
    document.getElementById('update-badge')?.classList.add('d-none');

    const queued = await apiCall('do_update');
    if (!queued) {
        alert('Не удалось запустить обновление. Возможно, оно уже выполняется. Проверьте журнал /opt/var/log/smartdns-webui-update.log.');
        btn.innerHTML = originalButtonHtml;
        btn.disabled = false;
        return;
    }

    // The API acknowledges only that the background updater was started.
    // Wait for an explicit terminal state instead of assuming success after a fixed delay.
    for (let attempt = 0; attempt < 120; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const status = (await apiCall('get_update_status')).trim();

        if (status === 'SUCCESS') {
            alert('Обновление завершено. Страница будет перезагружена.');
            window.location.reload();
            return;
        }
        if (status === 'ERROR') {
            alert('Обновление завершилось с ошибкой. Проверьте журнал /opt/var/log/smartdns-webui-update.log.');
            btn.innerHTML = originalButtonHtml;
            btn.disabled = false;
            return;
        }
    }

    alert('Нет подтверждения завершения обновления за 4 минуты. Не запускайте обновление повторно; проверьте журнал /opt/var/log/smartdns-webui-update.log.');
    btn.innerHTML = originalButtonHtml;
    btn.disabled = false;
}

// === АКТИВАЦИЯ ПЕРЕТАСКИВАНИЯ (DRAG & DROP) ===
function initSortable() {
    const containers = ['dynamic-groups-container', 'dynamic-routes-container', 'dynamic-addresses-container'];
    containers.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            Sortable.create(el, {
                handle: '.drag-handle',
                animation: 150,
                ghostClass: 'bg-secondary',
                onEnd: () => markConfigDirty()
            });
        }
    });
}

// Theme preference
window.toggleTheme = function() {
    const root = document.documentElement;
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('smartdns-ui-theme', next); } catch (_) {}
    const button = document.getElementById('theme-toggle');
    if (window.rawEditor) window.rawEditor.refresh();
    if (button) {
        button.innerHTML = next === 'dark' ? '<i class="bi bi-sun"></i>' : '<i class="bi bi-moon-stars"></i>';
        button.title = next === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему';
        button.setAttribute('aria-label', button.title);
    }
};
(function initTheme() {
    let saved = 'light';
    try { saved = localStorage.getItem('smartdns-ui-theme') || 'light'; } catch (_) {}
    document.documentElement.dataset.theme = saved === 'dark' ? 'dark' : 'light';
    const applyIcon = () => {
        const button = document.getElementById('theme-toggle');
        if (!button) return;
        button.innerHTML = saved === 'dark' ? '<i class="bi bi-sun"></i>' : '<i class="bi bi-moon-stars"></i>';
        button.title = saved === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему';
        button.setAttribute('aria-label', button.title);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyIcon); else applyIcon();
})();

window.refreshRouteFileOptions = async function() {
    const selects = Array.from(document.querySelectorAll('.route-file-select'));
    if (!selects.length) return;
    let names = [];
    try { names = (await apiCall('get_lists')).split('\n').map(name => name.trim()).filter(Boolean); } catch (_) { return; }
    selects.forEach(select => {
        const current = select.value || select.dataset.currentPath || '';
        const options = ['<option value="" disabled>Выберите список…</option>'];
        names.forEach(name => {
            const path = name.startsWith('/') ? name : '/opt/etc/smartdns/domains/' + name;
            options.push('<option value="' + UI.escape(path) + '">' + UI.escape(name) + '</option>');
        });
        const currentExists = names.some(name => current === name || current === (name.startsWith('/') ? name : '/opt/etc/smartdns/domains/' + name));
        if (current && !currentExists) options.push('<option value="' + UI.escape(current) + '">' + UI.escape(current) + ' (путь из конфига)</option>');
        select.innerHTML = options.join('');
        select.value = current;
        select.dataset.currentPath = current;
        select.disabled = names.length === 0 && !current;
        select.title = select.disabled ? 'Сначала создайте список доменов' : '';
    });
};
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
