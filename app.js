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

const changes = new window.ChangeController({onChange: renderChangeCenter});
let renderingEditor = false;
function configDocumentId() { return 'config:' + (isTestMode ? 'test' : 'live'); }
function listDocumentId(name=activeList) { return 'list:'+(isTestMode?'test:':'live:')+name; }
function currentDocumentId() { return activeTab==='settings'?configDocumentId():activeTab==='lists'&&activeList?listDocumentId():null; }
function hasIncompleteConfig() {
    return [...document.querySelectorAll('.address-item')].some(item=>!item.querySelector('.addr-domain').value.trim()||!item.querySelector('.addr-ip').value.trim()) ||
        [...document.querySelectorAll('.group-item')].some(item=>!item.querySelector('.group-name-input').value.trim()) ||
        [...document.querySelectorAll('.route-item')].some(item=>!item.querySelector('.route-name').value.trim() || !item.querySelector('.route-group').value || !item.querySelector('.route-file-select') || [...item.querySelectorAll('.route-file-select')].some(el=>!el.value));
}
function captureConfigDraft() {
    if(currentSettingsMode==='raw') return {text:rawEditor?rawEditor.getValue():document.getElementById('raw-config-text').value};
    const root=document.getElementById('config-sections');
    const controls=[...root.querySelectorAll('input,textarea,select')];
    const active=document.activeElement;
    const ui={html:root.innerHTML,controls:controls.map(el=>({value:el.value,checked:'checked' in el?el.checked:null})),activeIndex:controls.indexOf(active)};
    try {ui.start=active.selectionStart;ui.end=active.selectionEnd;}catch(_){}
    let text=null,error='';try {text=gatherSectionsText();}catch(e){error=e.message;}
    return {text,ui,incomplete:!!error||hasIncompleteConfig(),error,signature:JSON.stringify({html:ui.html,controls:ui.controls})};
}
function captureCurrentDraft() { return activeTab==='settings'?captureConfigDraft():{text:document.getElementById('list-content').value,deleted:!!changes.get(currentDocumentId())?.draft.deleted}; }
function trackEditorChange(event) {
    if(renderingEditor)return;
    if(activeTab==='lists'&&document.getElementById('list-content').disabled)return;
    const id=currentDocumentId();if(!changes.has(id))return;
    const target=event?.target;
    const typing=event?.type==='input' && (target?.tagName==='TEXTAREA'||target?.matches('input[type=text],input[type=number],input:not([type])'));
    const controls=activeTab==='settings'?[...document.querySelectorAll('#config-sections input,#config-sections textarea')]:[];
    const group=typing?'type:'+(target.id||controls.indexOf(target)):null;
    changes.change(id,captureCurrentDraft(),{group});renderChangeCenter();
}
function markConfigDirty(event) { if(activeTab==='settings')trackEditorChange(event); }
function markListDirty(event) { if(activeTab==='lists')trackEditorChange(event); }
function renderConfigDraft(snapshot) {
    renderingEditor=true;
    try {
        const root=document.getElementById('config-sections');
        if(currentSettingsMode==='ui') {
            if(snapshot.ui) {
                root.innerHTML=snapshot.ui.html;
                root.querySelectorAll('input,textarea,select').forEach((el,i)=>{
                    const state=snapshot.ui.controls[i];if(!state)return;
                    el.value=state.value;if(state.checked!==null)el.checked=state.checked;
                });
            } else root.innerHTML=parseConfigToSections(snapshot.text);
            organizeConfigSections();refreshRouteGroupOptions();
            if(typeof refreshRouteFileOptions==='function')refreshRouteFileOptions();
            if(typeof applyDnsGroupCollapseState==='function')applyDnsGroupCollapseState();
            root.querySelectorAll('textarea').forEach(autoResizeTextarea);initSortable();
            const focus=snapshot.ui&&[...root.querySelectorAll('input,textarea,select')][snapshot.ui.activeIndex];
            if(focus){focus.focus({preventScroll:true});try{focus.setSelectionRange(snapshot.ui.start,snapshot.ui.end);}catch(_){}}
        } else {
            document.getElementById('raw-config-text').value=snapshot.text;
            if(rawEditor){rawEditor.setValue(snapshot.text);rawEditor.clearHistory();}
        }
    } finally {renderingEditor=false;}
}
function renderCurrentDraft(snapshot) {
    if(!snapshot)return;
    if(activeTab==='settings') {
        if(snapshot.incomplete&&currentSettingsMode==='raw')setSettingsModeView('ui');
        renderConfigDraft(snapshot);
    } else if(activeTab==='lists') {
        const el=document.getElementById('list-content');el.value=snapshot.text;el.disabled=!!snapshot.deleted;
    }
    renderChangeCenter();
}
function undoEditorChange() {renderCurrentDraft(changes.undo());}
function redoEditorChange() {renderCurrentDraft(changes.redo());}
async function discardEditorChanges() {
    if(!changes.dirty()||!confirm('Отменить несохранённые правки выбранного файла? Это действие можно отменить.'))return;
    renderCurrentDraft(changes.discard());
}
async function previewEditorChanges() {
    const doc=changes.get();if(!doc)return;
    if(doc.draft.incomplete){alert(doc.draft.error||'Заполните незавершённые карточки для просмотра diff.');return;}
    const before=doc.saved.deleted?'':doc.saved.text,after=doc.draft.deleted?'':doc.draft.text;
    if(before===after){alert(doc.draft.deleted?'Файл будет удалён при сохранении.':'При сохранении будет создан пустой файл.');return;}
    await window.reviewConfigChanges(before,after,{preview:true,title:doc.label});
}
function renderChangeCenter() {
    const panel=document.getElementById('change-center');if(!panel)return;
    const id=currentDocumentId(),doc=changes.get(id),busy=!!changes.operation;
    const config=activeTab==='settings'&&!!doc;
    const disable=(id,value)=>{const el=document.getElementById(id);if(el)el.disabled=value;};
    disable('undo-change-btn',busy||!doc?.undo.length);disable('redo-change-btn',busy||!doc?.redo.length);
    disable('diff-change-btn',busy||!doc||!changes.dirty(id));disable('discard-change-btn',busy||!doc||!changes.dirty(id));
    disable('global-save-btn',busy||!doc||!changes.dirty(id));
    disable('validate-config-btn',busy||!config);disable('preflight-config-btn',busy||!config);
    disable('restart-service-btn',busy||!config||isTestMode);
    disable('organize-dns-btn',busy||!config);disable('reload-change-btn',busy||!doc);
    const save=document.getElementById('global-save-btn');if(save)save.classList.toggle('btn-primary',!!doc&&changes.dirty(id));
    const status=document.getElementById('change-status');
    if(status)status.textContent=changes.operation?({save:'Сохранение файла…',validate:'Проверка…',preflight:'Тест DNS…',apply:'Применение DNS…',load:'Загрузка файла…'}[changes.operation]||changes.operation):!doc?'Выберите файл для редактирования':changes.dirty(id)?'Есть несохранённые правки':doc.kind==='config'&&doc.applied===doc.saved.text?'Сохранено и применено в этом сеансе':'Нет несохранённых правок';
    const detail=document.getElementById('change-detail');
    if(detail)detail.textContent=!doc?'Черновики открытых файлов остаются в этом сеансе браузера.':doc.kind==='list'?(doc.draft.deleted?'Файл помечен к удалению. Подтвердите через «Сохранить».':doc.saved.deleted?'Новый файл будет создан при сохранении.':'Сохранение списка не перезапускает DNS.'):
        doc.applyState&&doc.applyState!=='COMMITTED'?'Последний статус применения: '+doc.applyState:
        doc.applied===doc.saved.text?'Работа сети была подтверждена.':doc.savedInSession?'Файл сохранён. Для загрузки настроек в DNS нажмите «Применить».':'Файл загружен. Применение в этом сеансе не проверялось.';
    const select=document.getElementById('change-document');
    if(select){select.replaceChildren();const empty=document.createElement('option');empty.value='';empty.textContent='Открытые файлы';select.append(empty);
        for(const item of changes.documents.values()){
            if(!item.id.includes(isTestMode?':test':':live'))continue;
            const option=document.createElement('option');option.value=item.id;option.textContent=item.label+(changes.dirty(item.id)?' •':'');select.append(option);
        }select.value=doc?.id||'';select.disabled=busy;
    }
    const count=document.getElementById('change-count');if(count)count.textContent=changes.dirtyCount()?'Несохранённых файлов: '+changes.dirtyCount():'';
}
async function reloadEditorDocument() {
    const doc=changes.get(currentDocumentId());if(!doc||changes.operation)return;
    if(!confirm('Перечитать '+doc.label+' с роутера? Черновик и история этого файла будут сброшены.'))return;
    changes.forget(doc.id);
    if(doc.kind==='config')await loadConfig();else {activeList='';await loadLists();if(!doc.saved.deleted)await selectList(doc.label);}
}
async function openChangeDocument(id) {
    const doc=changes.get(id);if(!doc)return;
    if(doc.kind==='config')await switchTab('settings',null);else {await switchTab('lists',null);await selectList(id.split(':').slice(2).join(':'));}
}
function updateSaveButtonState() {renderChangeCenter();}
window.addEventListener('beforeunload',event=>{if(changes.dirtyCount()){event.preventDefault();event.returnValue='';}});
async function toggleTestMode(enabled) {
    if(changes.operation){document.getElementById('test-mode-toggle').checked=isTestMode;return;}
    trackEditorChange();changes.boundary();
    isTestMode=enabled;activeList='';
    if(activeTab==='settings')await loadConfig();else if(activeTab==='lists')await loadLists();
    renderChangeCenter();
}

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

function setSettingsModeView(mode) {
    currentSettingsMode=mode;
    document.getElementById('settings-ui-view').style.display=mode==='ui'?'block':'none';
    document.getElementById('settings-raw-view').style.display=mode==='raw'?'block':'none';
    document.getElementById('btn-mode-ui').className='btn btn-sm '+(mode==='ui'?'btn-primary':'btn-outline-secondary');
    document.getElementById('btn-mode-raw').className='btn btn-sm '+(mode==='raw'?'btn-primary':'btn-outline-secondary');
}
function switchSettingsMode(mode) {
    if (changes.operation || currentSettingsMode === mode) return;
    trackEditorChange();changes.boundary();
    if(mode==='raw'&&captureConfigDraft().incomplete){alert('Заполните или удалите незавершённые карточки перед переходом в Raw.');return;}
    renderingEditor=true;
    try {
    
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
                if(renderingEditor)return;
                const input=document.getElementById('raw-config-text');input.value=rawEditor.getValue();
                markConfigDirty({type:'input',target:input});rawEditor.clearHistory();
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
    changes.change(configDocumentId(),captureConfigDraft());changes.boundary();
    updateSaveButtonState();
    } catch(error){alert(error.message);} finally {renderingEditor=false;}
}

async function switchTab(tabId, clickedEl, pushState = true) {
    if (changes.operation || tabId === activeTab) return;
    
    trackEditorChange();changes.boundary();
    
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
    
    renderChangeCenter();

if (tabId === 'settings') {
        await loadConfig();
    } else if (tabId === 'lists') {
        document.getElementById('list-content').disabled = !activeList;
        await loadLists();
    } else if (tabId === 'logs') {
        await loadLog();
    }
    changes.activate(currentDocumentId());renderChangeCenter();
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
    if(activeTab!=='settings'||!changes.begin('validate'))return;
    try {const draft=captureConfigDraft();if(draft.incomplete)throw new Error(draft.error||'Заполните незавершённые карточки.');await window.reviewValidationReport(await validateConfigOnServer(draft.text),true);}
    catch(error){alert('Проверка не выполнена: '+error.message);}
    finally{changes.end();}
}

async function preflightCurrentConfig() {
    if(activeTab!=='settings'||!changes.begin('preflight'))return;
    try {
        const draft=captureConfigDraft();if(draft.incomplete)throw new Error(draft.error||'Заполните незавершённые карточки.');
        const content=draft.text;
        const error=await validateConfigLogical(content);if(error)throw new Error(error);
        if(!await window.reviewValidationReport(await validateConfigOnServer(content)))return;
        const reply=await apiCall('preflight_config',null,content,true);
        await window.reviewValidationReport(window.parseValidationReport(reply),true);
    }catch(error){alert('Тест DNS не подтверждён: '+error.message);}
    finally{changes.end();}
}

// === ОСНОВНОЕ СОХРАНЕНИЕ ===
async function readConfigSnapshot() {
    const reply = await apiCall('get_config_snapshot', null, null, true);
    if (typeof reply !== 'string' || !/^REVISION [0-9a-f]{64}\n/.test(reply)) throw new Error('Не удалось прочитать версию конфигурации. Обновите WebUI.');
    return {revision:reply.slice(9, 73), content:reply.slice(74)};
}

async function globalSave() {
    const id=currentDocumentId(),doc=changes.get(id);
    if(!doc || !changes.begin('save'))return false;
    try {
        const snapshot=captureCurrentDraft();
        if(snapshot.incomplete)throw new Error(snapshot.error||'Заполните незавершённые карточки.');
        const contentToSave=snapshot.text;
        changes.change(id,snapshot);
        if(doc.kind==='config') {
            const error=await validateConfigLogical(contentToSave);if(error)throw new Error(error);
            if(!doc.revision)throw new Error('Заново загрузите конфигурацию перед сохранением.');
            if(!await window.reviewValidationReport(await validateConfigOnServer(contentToSave)))return false;
            const disk=await readConfigSnapshot();
            if(disk.revision!==doc.revision)throw new Error('Файл изменён другим сеансом. Ваши правки остались в редакторе.');
            if(!await window.reviewConfigChanges(disk.content,contentToSave))return false;
            const reply=await apiCall('save_config',null,contentToSave,true,doc.revision);
            if(typeof reply!=='string'||!/^OK\nREVISION [0-9a-f]{64}(?:\n|$)/.test(reply)) {
                if(typeof reply==='string'&&reply.startsWith('VALIDATION_FAILED\n')){
                    await window.reviewValidationReport(window.parseValidationReport(reply.slice(18)),true);return false;
                }
                throw new Error(typeof reply==='string'&&reply.startsWith('CONFLICT:')?'Файл изменился во время просмотра. Правки остались в редакторе.':'Сохранение не подтверждено. Проверьте соединение и резервные копии.');
            }
            changes.saved(id,snapshot,reply.slice(12,76));
        } else {
            if(snapshot.deleted) {
                if(!confirm('Удалить файл '+doc.label+'? Его содержимое останется в истории этого сеанса.'))return false;
                if(!doc.saved.deleted&&!await apiCall('delete_list',doc.label,null,true))throw new Error('Не удалось удалить список.');
            } else {
                if(doc.saved.deleted&&!confirm('Создать файл '+doc.label+'?'))return false;
                if(!await window.reviewConfigChanges(doc.saved.deleted?'':doc.saved.text,contentToSave))return false;
                if(!await apiCall('save_list',doc.label,contentToSave,true))throw new Error('Не удалось сохранить список.');
            }
            changes.saved(id,snapshot);
        }
        return true;
    } catch(error) {alert(error.message);return false;}
    finally {changes.end();}
}

async function loadConfig() {
    const id=configDocumentId(),mode=isTestMode;
    if(changes.has(id)) {
        changes.activate(id);renderConfigDraft(changes.get(id).draft);return;
    }
    if(!changes.begin('load'))return;
    try {
        const snapshot=await readConfigSnapshot();
        if(mode!==isTestMode||activeTab!=='settings')return;
        changes.open(id,{text:snapshot.content},{label:isTestMode?'Тестовая конфигурация':'Конфигурация DNS',kind:'config',revision:snapshot.revision});
        renderConfigDraft(changes.get(id).draft);
        changes.change(id,captureConfigDraft());
        renderChangeCenter();
    } catch(error){alert(error.message);}
    finally{changes.end();}
}

async function restartService() {
    if(activeTab!=='settings'||!changes.begin('apply'))return;
    const id=configDocumentId(),doc=changes.get(id);
    let observed=false,target=null;
    const monitor=async transaction=>{
        observed=true;
        await window.monitorSafeApply(transaction,(action,tid)=>apiCall(action,tid,null,true),state=>changes.applyState(id,state,target));
    };
    try {
        if(isTestMode)throw new Error('Применение отключено в тестовом режиме.');
        let pending=localStorage.getItem('smartdns-apply-transaction');
        if(!pending) {
            const active=await apiCall('get_active_apply',null,null,true);
            if(active.trim()!=='NONE'){
                const match=/^TRANSACTION (tx-[A-Za-z0-9]{12})\n?$/.exec(active);
                if(!match)throw new Error('Не удалось определить текущую операцию.');
                pending=match[1];localStorage.setItem('smartdns-apply-transaction',pending);
            }
        }
        if(pending){await monitor(pending);return;}
        if(!doc?.revision)throw new Error('Заново загрузите конфигурацию перед применением.');
        const snapshot=captureConfigDraft();
        if(snapshot.incomplete)throw new Error(snapshot.error||'Заполните незавершённые карточки.');
        const content=snapshot.text;
        const error=await validateConfigLogical(content);if(error)throw new Error(error);
        if(!await window.reviewValidationReport(await validateConfigOnServer(content)))return;
        const disk=await readConfigSnapshot();
        if(disk.revision!==doc.revision)throw new Error('Файл изменён другим сеансом. Правки остались в редакторе.');
        if(!await window.reviewConfigChanges(disk.content,content,{apply:true}))return;
        if(!confirm('Применить конфигурацию с перезапуском DNS?\n\nСторож вернёт прежний файл при ошибке или отсутствии подтверждения за 180 секунд. Это предыдущий файл на диске: он мог отличаться от настроек запущенного процесса.'))return;
        const reply=await apiCall('apply_config',null,content,true,doc.revision);
        const match=/^OK\nTRANSACTION (tx-[A-Za-z0-9]{12})\n?$/.exec(reply);
        if(!match)throw new Error(String(reply).slice(0,500));
        target=content;
        localStorage.setItem('smartdns-apply-transaction',match[1]);await monitor(match[1]);
    } catch(error){alert('Применение не подтверждено: '+error.message);}
    finally {
        if(observed)try {
            const disk=await readConfigSnapshot();changes.saved(id,{text:disk.content},disk.revision);
        }catch(_){/* Keep the draft and its revision if the connection was lost. */}
        changes.end();
    }
}

async function loadLists() {
    const mode=isTestMode;
    const listsRaw = await apiCall('get_lists');
    if(mode!==isTestMode||activeTab!=='lists')return;
    const lists = listsRaw.split('\n').filter(l => l.trim() !== '');
    for(const doc of changes.documents.values())if(doc.kind==='list'&&doc.id.startsWith('list:'+(isTestMode?'test:':'live:'))&&(!doc.saved.deleted||!doc.draft.deleted)&&!lists.includes(doc.label))lists.push(doc.label);
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
    if(changes.operation)return;
    trackEditorChange();changes.boundary();
    const previous=activeList;
    activeList=name;
    const id=listDocumentId(name),cached=changes.get(id);
    const ta=document.getElementById('list-content');
    changes.begin('load');
    ta.disabled=true;
    try {
        const content=cached?cached.draft.text:await apiCall('get_list',name,null,true);
        ta.value=content;ta.disabled=!!cached?.draft.deleted;
        document.getElementById('current-list-title').innerText='Редактирование: '+name;
        changes.open(id,{text:content},{label:name,kind:'list'});
        document.querySelectorAll('#lists-container .list-group-item').forEach(el=>{
            const selected=el.querySelector('button[data-list-name]')?.dataset.listName===name;
            el.classList.toggle('active',selected);
            for(const cls of ['bg-dark','text-light','border-secondary'])el.classList.toggle(cls,!selected);
        });
    } catch(error) {
        activeList=previous;
        const draft=changes.get(listDocumentId())?.draft;
        ta.value=draft?.text||'';ta.disabled=!draft||!!draft.deleted;
        changes.activate(currentDocumentId());alert(error.message);
    } finally {changes.end();}
}

async function createList() {
    if(changes.operation)return;
    const input=document.getElementById('new-list-name');
    const clean=input.value.replace(/[^a-zA-Z0-9_-]/g,'');if(!clean)return;
    const name=clean+'.list';
    const mode=isTestMode;
    let names;try{names=(await apiCall('get_lists',null,null,true)).split('\n');}catch(error){alert(error.message);return;}
    if(mode!==isTestMode||activeTab!=='lists')return;
    if(names.includes(name)||changes.has(listDocumentId(name))){alert('Список с таким именем уже существует.');return;}
    trackEditorChange();changes.boundary();
    const id=listDocumentId(name);
    changes.open(id,{text:'',deleted:true},{label:name,kind:'list'});
    changes.change(id,{text:''});
    input.value='';await loadLists();await selectList(name);
}
async function deleteList(name=activeList) {
    if(changes.operation||!name)return;
    await selectList(name);
    if(activeList!==name)return;
    changes.change(listDocumentId(name),{text:changes.get().draft.text,deleted:true});
    renderCurrentDraft(changes.get().draft);
}

async function loadLog() {
    document.getElementById('log-content').value = await apiCall('get_log');
}

document.addEventListener('keydown', (e) => {
    if(e.defaultPrevented || e.target.closest?.('dialog'))return;
    const modifier=(e.ctrlKey||e.metaKey)&&!e.altKey;
    // Physical keys also work with Russian and other keyboard layouts.
    const key=({KeyZ:'z',KeyY:'y',KeyS:'s'})[e.code]||e.key.toLowerCase();
    const inEditor=e.target.closest?.('#config-sections,#settings-raw-view,#change-center')||e.target.id==='list-content';
    const otherInput=!inEditor&&e.target.closest?.('input,textarea,select,[contenteditable="true"]');
    // Native controls and rebuilding the form can leave focus on body.
    const editorPage=(activeTab==='settings'||activeTab==='lists')&&!otherInput;
    if(modifier&&editorPage&&(key==='z'||key==='y')){
        e.preventDefault();e.stopImmediatePropagation();if(key==='y'||e.shiftKey)redoEditorChange();else undoEditorChange();return;
    }
    if(modifier&&key==='s'){
        e.preventDefault();if(!document.getElementById('global-save-btn').disabled)globalSave();return;
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
},true);

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
            if(Sortable.get?.(el))return;
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
