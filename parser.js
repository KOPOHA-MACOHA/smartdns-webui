// === УМНАЯ ТРАНСФОРМАЦИЯ DNS ===
window.formatDns = function(url, suffix) {
    let isComment = url.startsWith('#');
    if (isComment) url = url.replace(/^#+\s*/, '');
    
    let prefix = '';
    if (!url.match(/^server(?:-[a-z0-9]+)?\s+/)) {
        prefix = 'server';
        if (url.startsWith('https://')) prefix = 'server-https';
        else if (url.startsWith('dot://')) { url = url.slice(6); prefix = 'server-tls'; }
        else if (url.startsWith('tls://')) prefix = 'server-tls';
        else if (url.startsWith('doq://')) { url = url.slice(6); prefix = 'server-quic'; }
        else if (url.startsWith('quic://')) prefix = 'server-quic';
        else if (url.startsWith('h3://')) prefix = 'server-h3';
        else if (url.startsWith('tcp://')) prefix = 'server-tcp';
    }
    
    let result = prefix ? `${prefix} ${url} ${suffix}`.trim() : `${url} ${suffix}`.trim();
    return isComment ? `#${result}` : result;
}

window.cleanDns = function(line, suffixesToRemove) {
    let isComment = line.startsWith('#');
    if (isComment) line = line.replace(/^#+\s*/, '');
    
    let match = line.match(/^server(?:-([a-z0-9]+))?\s+(.+)/);
    if (match) {
        let type = match[1]; 
        let rest = match[2]; 

        if (!type) { 
            line = rest;
        } else if (type === 'tls' && !rest.includes('://')) { 
            line = 'dot://' + rest;
        } else if (type === 'quic' && !rest.includes('://')) {
            line = 'doq://' + rest;
        } else if (rest.includes('://')) { 
            line = rest;
        }
    }
    
    if (Array.isArray(suffixesToRemove)) {
        suffixesToRemove.forEach(s => {
            if (s === '-e') line = line.replace(/\s+-e\b/g, '');
            else if (s instanceof RegExp) line = line.replace(s, '');
            else line = line.replace(new RegExp(s, 'g'), '');
        });
    } else {
        if (suffixesToRemove === '-e') line = line.replace(/\s+-e\b/g, '');
        else line = line.replace(suffixesToRemove, '');
    }
    line = line.replace(/\s+/g, ' ').trim();
    
    return isComment ? `# ${line}` : line;
}

// === ГЕНЕРАТОРЫ HTML КАРТОЧЕК ===
const UI = {
    escape: (str) => str ? str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') : '',
    
    dnsServerRow: (value) => {
        const raw = (value || '').trim();
        const isComment = raw.startsWith('#');
        const cleanLine = raw.replace(/^#+\s*/, '')
            .replace(/\s+-bootstrap-dns\b/g, '')
            .replace(/\s+-exclude-default-group\b/g, '')
            .replace(/\s+-group\s+[^\s]+/g, '')
            .trim();
        const parts = window.parseDnsModalValue ? window.parseDnsModalValue(cleanLine) : { type: 'udp4', address: cleanLine, port: '', path: '/dns-query', options: '' };
        const labels = { udp4: 'DNS IPv4', udp6: 'DNS IPv6', tcp: 'TCP', dot: 'DoT', doh: 'DoH', doq: 'DoQ', h3: 'HTTP/3' };
        const endpoint = (parts.type === 'doh' ? 'https://' : '') + (parts.address || '') + (parts.port ? ':' + parts.port : '') + (['doh','h3'].includes(parts.type) ? (parts.path || '/dns-query') : '');
        const protocol = labels[parts.type] || 'DNS';
        return `<div class="dns-server-row d-flex align-items-center gap-3${isComment ? ' is-disabled' : ''}">
            <label class="dns-enabled-control" title="Включить или отключить DNS-запись">
                <input type="checkbox" class="dns-enabled" ${isComment ? '' : 'checked'} onchange="toggleDnsRecord(this)" aria-label="Включить DNS-запись">
            </label>
            <span class="dns-protocol">${UI.escape(protocol)}</span>
            <span class="dns-endpoint flex-grow-1" title="${UI.escape(endpoint)}">${UI.escape(endpoint)}</span>
            <input type="hidden" class="dns-value" value="${UI.escape(cleanLine)}">
            <button type="button" class="icon-action" onclick="openDnsModal(this.closest('.dns-server-list'), this.closest('.dns-server-row'))" aria-label="Редактировать DNS" title="Редактировать"><i class="bi bi-pencil"></i></button>
            <button type="button" class="icon-action danger" onclick="this.closest('.dns-server-row').remove(); markConfigDirty()" aria-label="Удалить DNS" title="Удалить"><i class="bi bi-trash3"></i></button>
        </div>`;
    },
    card: (title, id, linesArr, notice = '') => {
        const dnsSection = ['bootstrap','upstream','fallback'].includes(id);
        const body = dnsSection
            ? '<textarea id="sec-' + id + '" class="form-control code-font dns-multiline-editor border-0 rounded-0 p-3" rows="' + Math.max(5, Math.min(12, linesArr.length + 2)) + '" spellcheck="false" oninput="markConfigDirty()" placeholder="Один DNS-сервер на строку; строки с # отключены">' + UI.escape(linesArr.join('\n')) + '</textarea>'
            : '<textarea id="sec-' + id + '" class="form-control code-font border-0 rounded-0 p-2" rows="' + Math.max(3, Math.min(15, linesArr.length)) + '" oninput="markConfigDirty()">' + UI.escape(linesArr.join('\n')) + '</textarea>';
        return '<div class="card mb-3"><div class="card-header section-header d-flex justify-content-between align-items-center"><span>' + title + '</span></div><div class="card-body p-0">' + (notice ? '<div class="p-2 text-muted small border-bottom">' + notice + '</div>' : '') + body + '</div></div>';
    },
    logCard: (level) => `
        <div class="card bg-dark border-secondary mb-3 shadow-sm">
            <div class="card-header border-secondary section-header py-2"><span>Логирование</span></div>
            <div class="card-body p-3">
                <div class="d-flex align-items-center">
                    <label class="form-label text-light small fw-bold mb-0 me-3">Уровень логов (log-level):</label>
                    <select id="sec-logging-select" class="form-select form-select-sm bg-secondary text-light border-secondary w-50" onchange="markConfigDirty()">
                        ${['fatal','error','warn','notice','info','debug'].map(l => `<option value="${l}" ${l===level?'selected':''}>${l}</option>`).join('')}
                    </select>
                </div>
            </div>
        </div>`,

    addressRow: (domain, ip, enabled = true) => `
        <div class="address-item d-flex mb-2 align-items-center${enabled ? '' : ' is-disabled'}">
            <label class="dns-enabled-control" title="Включить или отключить локальный адрес">
                <input type="checkbox" class="addr-enabled" ${enabled ? 'checked' : ''} onchange="toggleAddressRecord(this)" aria-label="Включить локальный адрес">
            </label>
            <i class="bi bi-grip-vertical text-secondary me-2 drag-handle" style="cursor: grab; font-size: 1.2rem;"></i>
            <input type="text" class="form-control form-control-sm bg-secondary text-light border-secondary addr-domain me-2" placeholder="Домен" value="${UI.escape(domain)}" oninput="this.value=this.value.replace(/,/g, ''); markConfigDirty()">
            <input type="text" class="form-control form-control-sm bg-secondary text-light border-secondary addr-ip me-2 w-50" placeholder="IP" value="${UI.escape(ip)}" oninput="this.value=this.value.replace(/,/g, ''); markConfigDirty()">
            <button class="btn btn-sm btn-outline-danger" onclick="this.parentElement.remove(); markConfigDirty();" title="Удалить"><i class="bi bi-trash"></i></button>
        </div>`,

    routeFileRow: (path) => `
        <div class="route-file-row d-flex align-items-center gap-2">
            <i class="bi bi-file-earmark-text text-secondary"></i>
            <select class="form-select form-select-sm route-file-select" data-current-path="${UI.escape(path)}" onchange="this.dataset.currentPath=this.value; markConfigDirty()"><option value="" disabled ${path ? '' : 'selected'}>Выберите список…</option>${path ? '<option value="' + UI.escape(path) + '" selected>' + UI.escape(path) + '</option>' : ''}</select>
            <button type="button" class="icon-action danger" onclick="this.closest('.route-file-row').remove(); markConfigDirty();" title="Убрать список"><i class="bi bi-trash3"></i></button>
        </div>`,
    routeCard: (name, group, files) => `
        <div class="route-item border p-2 mb-2 rounded position-relative shadow-sm">
            <div class="d-flex gap-2 align-items-center mb-2">
                <i class="bi bi-grip-vertical text-secondary drag-handle" style="cursor:grab;font-size:1.1rem" title="Перетащить"></i>
                <div class="editable-name route-editable-name flex-grow-1">
                    <span class="route-name-display fw-semibold">${UI.escape(name || 'Новый маршрут')}</span>
                    <input type="text" class="form-control form-control-sm route-name d-none" value="${UI.escape(name)}" placeholder="Имя набора" oninput="updateInlineName(this); markConfigDirty()" onblur="setTimeout(() => finishInlineEdit(this), 120)" onkeydown="if(event.key==='Enter'){event.preventDefault();finishInlineEdit(this)}else if(event.key==='Escape'){finishInlineEdit(this,true)}">
                    <button type="button" class="btn btn-sm btn-link text-secondary p-1" onclick="toggleInlineEdit(this)" title="Переименовать"><i class="bi bi-pencil"></i></button>
                </div>
                <button class="btn btn-sm btn-outline-danger" onclick="this.closest('.route-item').remove(); markConfigDirty();" title="Удалить маршрут"><i class="bi bi-trash"></i></button>
            </div>
            <div class="route-files-list">
                ${(files || '').split(/\r?\n/).filter(f => f.trim()).map(f => UI.routeFileRow(f)).join('') || '<div class="route-files-empty settings-section-hint mb-2">Списки ещё не добавлены</div>'}
            </div>
            <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mt-2">
                <button class="btn btn-sm btn-outline-primary" type="button" onclick="addRouteFileUI(this)"><i class="bi bi-plus-lg me-1"></i>Добавить список</button>
                <div class="d-flex align-items-center">
                    <label class="small text-muted me-2">DNS-группа</label>
                    <select class="form-select form-select-sm route-group" style="max-width:240px" data-current-group="${UI.escape(group)}" onchange="this.dataset.currentGroup=this.value; markConfigDirty()"><option value="${UI.escape(group)}" selected>${UI.escape(group)}</option></select>
                </div>
            </div>
        </div>`,

    groupCard: (name, content) => `
        <div class="group-item border p-2 mb-2 rounded position-relative shadow-sm" data-group-name="${UI.escape(name)}">
            <div class="group-heading d-flex gap-2 align-items-center mb-2">
                <i class="bi bi-grip-vertical text-secondary drag-handle" style="cursor:grab;font-size:1.1rem" title="Перетащить"></i>
                <button type="button" class="group-collapse-toggle btn btn-sm btn-link text-reset p-1" onclick="toggleDnsGroup(this)" aria-expanded="true" title="Свернуть DNS-группу" aria-label="Свернуть DNS-группу"><i class="bi bi-chevron-down"></i></button>
                <div class="editable-name group-editable-name flex-grow-1">
                    <span class="group-name-display fw-semibold">${UI.escape(name || 'Новая DNS-группа')}</span>
                    <input type="text" class="form-control form-control-sm group-name-input d-none" value="${UI.escape(name)}" data-prev-name="${UI.escape(name)}" placeholder="Имя группы" oninput="renameDnsGroup(this); markConfigDirty()" onblur="setTimeout(() => finishInlineEdit(this), 120)" onkeydown="if(event.key==='Enter'){event.preventDefault();finishInlineEdit(this)}else if(event.key==='Escape'){finishInlineEdit(this,true)}">
                    <button type="button" class="btn btn-sm btn-link text-secondary p-1" onclick="toggleInlineEdit(this)" title="Переименовать"><i class="bi bi-pencil"></i></button>
                </div>
                <button class="btn btn-sm btn-outline-danger" onclick="this.closest('.group-item').remove(); refreshRouteGroupOptions(); markConfigDirty();" title="Удалить группу"><i class="bi bi-trash"></i></button>
            </div>
            <div class="group-body">
                <textarea class="form-control code-font dns-multiline-editor group-dns-list border-0 rounded-0 p-3" rows="${Math.max(5, Math.min(12, (content || '').split(/\r?\n/).length + 2))}" spellcheck="false" oninput="markConfigDirty()" placeholder="Один DNS-сервер на строку; строки с # отключены">${UI.escape(content || '')}</textarea>
            </div>
        </div>`,
    coreCard: (data, rawLines) => `
        <div class="card bg-dark border-secondary mb-3 shadow-sm">
            <div class="card-header border-secondary section-header py-2"><span>Основные параметры (Core)</span></div>
            <div class="card-body p-3">
                <div class="row mb-3 align-items-center">
                    <div class="col-sm-6"><label class="form-label text-light small mb-0">Порт (bind):</label></div>
                    <div class="col-sm-6"><input type="text" id="core-bind" class="form-control form-control-sm bg-secondary text-light border-secondary" value="${UI.escape(data.bind)}" oninput="markConfigDirty()"></div>
                </div>
                <div class="row mb-3 align-items-center">
                    <div class="col-sm-6"><label class="form-label text-light small mb-0">Размер кэша:</label></div>
                    <div class="col-sm-6"><input type="number" id="core-cache-size" class="form-control form-control-sm bg-secondary text-light border-secondary" value="${UI.escape(data.cache_size)}" oninput="markConfigDirty()"></div>
                </div>
                <div class="row mb-3 align-items-center">
                    <div class="col-sm-6"><label class="form-label text-light small mb-0">Упреждающее обновление:</label></div>
                    <div class="col-sm-6"><div class="form-check form-switch m-0"><input class="form-check-input shadow-none" type="checkbox" id="core-prefetch" ${data.prefetch_domain === 'yes' ? 'checked' : ''} onchange="markConfigDirty()"></div></div>
                </div>
                <div class="row mb-3 align-items-center">
                    <div class="col-sm-6"><label class="form-label text-light small mb-0">Отдавать просроченный кэш:</label></div>
                    <div class="col-sm-6"><div class="form-check form-switch m-0"><input class="form-check-input shadow-none" type="checkbox" id="core-serve-expired" ${data.serve_expired === 'yes' ? 'checked' : ''} onchange="markConfigDirty()"></div></div>
                </div>
                <div class="row mb-3 align-items-center">
                    <div class="col-sm-6"><label class="form-label text-light small mb-0">Выбор лучшего IP:</label></div>
                    <div class="col-sm-6">
                        <select id="core-response-mode" class="form-select form-select-sm bg-secondary text-light border-secondary" onchange="markConfigDirty()">
                            <option value="fastest-response" ${data.response_mode === 'fastest-response' ? 'selected' : ''}>fastest-response</option>
                            <option value="first-response" ${data.response_mode === 'first-response' ? 'selected' : ''}>first-response</option>
                            <option value="tcp-fastest" ${data.response_mode === 'tcp-fastest' ? 'selected' : ''}>tcp-fastest</option>
                        </select>
                    </div>
                </div>
                <div class="row mb-2 align-items-start">
                    <div class="col-sm-6"><label class="form-label text-light small mb-0">Проверка скорости:</label></div>
                    <div class="col-sm-6">
                        <div class="form-check mb-1"><input class="form-check-input" type="checkbox" id="speed-ping" ${data.speed_check_mode.includes('ping') ? 'checked' : ''} onchange="markConfigDirty()"><label class="form-check-label small text-light">ICMP Ping</label></div>
                        <div class="form-check mb-1"><input class="form-check-input" type="checkbox" id="speed-tcp443" ${data.speed_check_mode.includes('tcp:443') ? 'checked' : ''} onchange="markConfigDirty()"><label class="form-check-label small text-light">TCP 443</label></div>
                        <div class="form-check mb-2"><input class="form-check-input" type="checkbox" id="speed-tcp80" ${data.speed_check_mode.includes('tcp:80') ? 'checked' : ''} onchange="markConfigDirty()"><label class="form-check-label small text-light">TCP 80</label></div>
                    </div>
                </div>
                <input type="hidden" id="sec-core-others" value="${UI.escape(rawLines.join('\n'))}">
            </div>
        </div>`
};

window.getCollapsedDnsGroups = function() {
    try { return JSON.parse(localStorage.getItem('smartdns-ui-collapsed-groups') || '{}') || {}; }
    catch (_) { return {}; }
};
window.saveCollapsedDnsGroups = function(state) {
    try { localStorage.setItem('smartdns-ui-collapsed-groups', JSON.stringify(state)); } catch (_) {}
};
window.applyDnsGroupCollapseState = function() {
    const state = window.getCollapsedDnsGroups();
    document.querySelectorAll('.group-item').forEach(item => {
        const name = item.dataset.groupName || item.querySelector('.group-name-input')?.value || '';
        const collapsed = !!(name && state[name]);
        item.classList.toggle('is-collapsed', collapsed);
        const button = item.querySelector('.group-collapse-toggle');
        if (!button) return;
        button.setAttribute('aria-expanded', String(!collapsed));
        button.setAttribute('aria-label', collapsed ? 'Развернуть DNS-группу' : 'Свернуть DNS-группу');
        button.title = collapsed ? 'Развернуть DNS-группу' : 'Свернуть DNS-группу';
        const icon = button.querySelector('i');
        if (icon) {
            icon.classList.toggle('bi-chevron-down', !collapsed);
            icon.classList.toggle('bi-chevron-right', collapsed);
        }
    });
};
window.toggleDnsRecord = function(checkbox) {
    const row = checkbox.closest('.dns-server-row');
    if (!row) return;
    row.classList.toggle('is-disabled', !checkbox.checked);
    checkbox.title = checkbox.checked ? 'DNS-запись включена' : 'DNS-запись отключена';
    markConfigDirty();
};
window.toggleAddressRecord = function(checkbox) {
    const row = checkbox.closest('.address-item');
    if (!row) return;
    row.classList.toggle('is-disabled', !checkbox.checked);
    checkbox.title = checkbox.checked ? 'Локальный адрес включён' : 'Локальный адрес отключён';
    markConfigDirty();
};

window.toggleDnsGroup = function(button) {
    const item = button.closest('.group-item');
    if (!item) return;
    const name = item.dataset.groupName || item.querySelector('.group-name-input')?.value || '';
    const collapsed = item.classList.toggle('is-collapsed');
    if (name) {
        const state = window.getCollapsedDnsGroups();
        if (collapsed) state[name] = true; else delete state[name];
        window.saveCollapsedDnsGroups(state);
    }
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', collapsed ? 'Развернуть DNS-группу' : 'Свернуть DNS-группу');
    button.title = collapsed ? 'Развернуть DNS-группу' : 'Свернуть DNS-группу';
    const icon = button.querySelector('i');
    if (icon) {
        icon.classList.toggle('bi-chevron-down', !collapsed);
        icon.classList.toggle('bi-chevron-right', collapsed);
    }
    // A collapsed group's textarea cannot report its full scrollHeight until it is visible.
    if (!collapsed) {
        const textarea = item.querySelector('textarea.dns-multiline-editor');
        if (textarea && typeof autoResizeTextarea === 'function') {
            setTimeout(() => autoResizeTextarea(textarea), 0);
        }
    }
};

window.addNewGroupUI = () => {
    const cont = document.getElementById('dynamic-groups-container');
    if (cont) { document.getElementById('no-groups-msg')?.remove(); cont.insertAdjacentHTML('beforeend', UI.groupCard('', '')); refreshRouteGroupOptions(); markConfigDirty(); }
};
window.addNewAddressUI = () => {
    const cont = document.getElementById('dynamic-addresses-container');
    if (cont) { document.getElementById('no-addr-msg')?.remove(); cont.insertAdjacentHTML('beforeend', UI.addressRow('', '')); markConfigDirty(); }
};
window.addNewRouteUI = () => {
    const cont = document.getElementById('dynamic-routes-container');
    if (cont) { document.getElementById('no-route-msg')?.remove(); cont.insertAdjacentHTML('beforeend', UI.routeCard('', '', '')); refreshRouteGroupOptions(); markConfigDirty(); }
};



window.addRouteFileUI = function(button) {
    const list = button.closest('.route-item')?.querySelector('.route-files-list');
    if (!list) return;
    list.querySelector('.route-files-empty')?.remove();
    list.insertAdjacentHTML('beforeend', UI.routeFileRow(''));
    const inputs = list.querySelectorAll('.route-file-select');
    inputs[inputs.length - 1]?.focus();
    if (typeof refreshRouteFileOptions === 'function') refreshRouteFileOptions();
    markConfigDirty();
};

window.toggleInlineEdit = function(button) {
    const wrapper = button.closest('.editable-name');
    if (!wrapper) return;
    if (wrapper.classList.contains('is-editing')) { finishInlineEdit(wrapper.querySelector('input')); return; }
    wrapper.classList.add('is-editing');
    const input = wrapper.querySelector('input');
    input.dataset.originalValue = input.value;
    input.focus(); input.select();
};
window.finishInlineEdit = function(input, cancel = false) {
    if (!input) return;
    const wrapper = input.closest('.editable-name');
    if (!wrapper || !wrapper.classList.contains('is-editing')) return;
    if (cancel) input.value = input.dataset.originalValue || '';
    wrapper.classList.remove('is-editing');
    updateInlineName(input);
    if (input.classList.contains('group-name-input')) renameDnsGroup(input);
    markConfigDirty();
};
window.updateInlineName = function(input) {
    const display = input.parentElement.querySelector('span');
    if (display) display.textContent = input.value.trim() || (input.classList.contains('group-name-input') ? 'Новая DNS-группа' : 'Новый маршрут');
};

window.refreshRouteGroupOptions = function() {
    const names = Array.from(document.querySelectorAll('.group-name-input'))
        .map(input => input.value.trim()).filter(Boolean);
    document.querySelectorAll('.route-group').forEach(select => {
        const selected = select.value || select.dataset.currentGroup || '';
        const options = ['<option value="" disabled>Выберите DNS-группу…</option>'];
        names.forEach(name => options.push('<option value="' + UI.escape(name) + '">' + UI.escape(name) + '</option>'));
        if (selected && !names.includes(selected)) options.push('<option value="' + UI.escape(selected) + '">' + UI.escape(selected) + ' (не найдена)</option>');
        select.innerHTML = options.join('');
        select.value = selected;
        select.dataset.currentGroup = selected;
        select.disabled = names.length === 0 && !selected;
        select.title = select.disabled ? 'Сначала создайте DNS-группу' : '';
    });
};

window.renameDnsGroup = function(input) {
    const oldName = input.dataset.prevName || '';
    const newName = input.value.trim();
    updateInlineName(input);
    if (oldName && newName && oldName !== newName) {
        document.querySelectorAll('.route-group').forEach(select => {
            if (select.value === oldName || select.dataset.currentGroup === oldName) {
                select.value = newName;
                select.dataset.currentGroup = newName;
            }
        });
    }
    input.dataset.prevName = newName;
    const groupItem = input.closest('.group-item');
    if (groupItem) {
        const state = window.getCollapsedDnsGroups();
        const wasCollapsed = !!state[oldName];
        if (oldName && oldName !== newName) delete state[oldName];
        groupItem.dataset.groupName = newName;
        if (wasCollapsed && newName) state[newName] = true;
        window.saveCollapsedDnsGroups(state);
    }
    refreshRouteGroupOptions();
};

window.parseDnsModalValue = function(value) {
    let line = String(value || '').trim();
    if (line.startsWith('#')) line = line.replace(/^#+\s*/, '');
    let type = 'udp4';
    let payload = line;
    const cmd = line.match(/^(server(?:-[a-z0-9]+)?)\s+(.+)$/i);
    if (cmd) {
        payload = cmd[2].trim();
        const directive = cmd[1].toLowerCase();
        if (directive === 'server-tls') type = 'dot';
        else if (directive === 'server-quic') type = 'doq';
        else if (directive === 'server-https') type = 'doh';
        else if (directive === 'server-h3') type = 'h3';
        else if (directive === 'server-tcp') type = 'tcp';
        else type = payload.startsWith('[') ? 'udp6' : (/^[0-9a-f:]+$/i.test(payload.split(/\s/)[0]) && payload.includes(':') ? 'udp6' : 'udp4');
    } else if (/^(?:dot|tls):\/\//i.test(payload)) type = 'dot';
    else if (/^(?:doq|quic):\/\//i.test(payload)) type = 'doq';
    else if (/^https:\/\//i.test(payload)) type = 'doh';
    else if (/^h3:\/\//i.test(payload)) type = 'h3';
    else if (/^tcp:\/\//i.test(payload)) type = 'tcp';

    const firstSpace = payload.search(/\s/);
    let endpoint = firstSpace < 0 ? payload : payload.slice(0, firstSpace);
    const options = firstSpace < 0 ? '' : payload.slice(firstSpace).trim();
    const schemes = { dot: /^(?:dot|tls):\/\//i, doq: /^(?:doq|quic):\/\//i, doh: /^https:\/\//i, h3: /^h3:\/\//i, tcp: /^tcp:\/\//i };
    if (schemes[type]) endpoint = endpoint.replace(schemes[type], '');

    let address = endpoint, port = '', path = '/dns-query';
    if (['doh','h3'].includes(type)) {
        const pathIndex = endpoint.indexOf('/');
        if (pathIndex >= 0) { path = endpoint.slice(pathIndex) || '/dns-query'; endpoint = endpoint.slice(0, pathIndex); }
        address = endpoint;
    }
    if (endpoint.startsWith('[')) {
        const close = endpoint.indexOf(']');
        if (close >= 0) {
            address = endpoint.slice(1, close);
            const remainder = endpoint.slice(close + 1);
            if (remainder.startsWith(':')) port = remainder.slice(1);
        }
    } else {
        const colonCount = (endpoint.match(/:/g) || []).length;
        if (colonCount === 1) {
            const idx = endpoint.lastIndexOf(':');
            if (/^\d+$/.test(endpoint.slice(idx + 1))) { address = endpoint.slice(0, idx); port = endpoint.slice(idx + 1); }
        }
        if (colonCount > 1) address = endpoint;
    }
    return { type, address, port, path, options };
};

window.openDnsModal = function(target, row = null) {
    const modal = document.getElementById('dns-server-modal');
    if (!modal || !window.bootstrap) return;
    window.dnsModalTarget = target;
    window.dnsModalEditRow = row;
    window.dnsModalWasCommented = !!(row && !row.querySelector('.dns-enabled')?.checked);
    const title = document.getElementById('dns-server-modal-title');
    const submit = document.getElementById('dns-modal-submit');
    if (row) {
        const parsed = window.parseDnsModalValue(row.querySelector('.dns-value')?.value || '');
        document.getElementById('dns-type').value = parsed.type;
        document.getElementById('dns-address').value = parsed.address;
        document.getElementById('dns-port').value = parsed.port;
        document.getElementById('dns-path').value = parsed.path || '/dns-query';
        document.getElementById('dns-options').value = parsed.options || '';
        if (title) title.innerHTML = '<i class="bi bi-hdd-network me-2"></i>Редактировать DNS-сервер';
        if (submit) submit.innerHTML = '<i class="bi bi-check-lg me-1"></i>Сохранить';
    } else {
        document.getElementById('dns-type').value = 'udp4';
        document.getElementById('dns-address').value = '';
        document.getElementById('dns-path').value = '/dns-query';
        document.getElementById('dns-port').value = '';
        document.getElementById('dns-options').value = '';
        if (title) title.innerHTML = '<i class="bi bi-hdd-network me-2"></i>Добавить DNS-сервер';
        if (submit) submit.innerHTML = '<i class="bi bi-plus-lg me-1"></i>Добавить DNS';
    }
    updateDnsModalFields();
    bootstrap.Modal.getOrCreateInstance(modal).show();
};

window.updateDnsModalFields = function() {
    const type = document.getElementById('dns-type')?.value || 'udp4';
    const pathRow = document.getElementById('dns-path-row');
    if (pathRow) pathRow.classList.toggle('d-none', !['doh','h3'].includes(type));
    const scheme = document.getElementById('dns-address-scheme');
    if (scheme) {
        scheme.textContent = type === 'doh' ? 'https://' : '';
        scheme.classList.toggle('d-none', type !== 'doh');
    }
    const port = document.getElementById('dns-port');
    if (port) port.placeholder = ({udp4:'53',udp6:'53',tcp:'53',dot:'853',doq:'853',doh:'443',h3:'443'})[type] || 'Порт';
};

window.addDnsServerFromModal = function() {
    const type = document.getElementById('dns-type').value;
    const address = document.getElementById('dns-address').value.trim();
    const port = document.getElementById('dns-port').value.trim();
    const path = document.getElementById('dns-path').value.trim() || '/dns-query';
    const options = document.getElementById('dns-options').value.trim();
    if (!address) { alert('Укажите адрес DNS-сервера.'); return; }
    const host = address.includes(':') && !address.startsWith('[') ? '[' + address + ']' : address;
    let line;
    if (type === 'dot') line = 'dot://' + host + (port ? ':' + port : '');
    else if (type === 'doq') line = 'doq://' + host + (port ? ':' + port : '');
    else if (type === 'doh') line = 'server-https https://' + host + (port ? ':' + port : '') + path;
    else if (type === 'h3') line = 'server-h3 h3://' + host + (port ? ':' + port : '') + path;
    else if (type === 'tcp') line = 'server-tcp ' + host + (port ? ':' + port : '');
    else line = host + (port && port !== '53' ? ':' + port : '');
    if (options) line += ' ' + options;
    if (window.dnsModalEditRow && window.dnsModalWasCommented) line = '# ' + line;
    const target = window.dnsModalTarget;
    if (!target) return;
    const list = target.classList.contains('dns-server-list') ? target : target.querySelector('.group-dns-list');
    if (!list) return;
    list.querySelector('.dns-empty')?.remove();
    const editRow = window.dnsModalEditRow;
    const html = UI.dnsServerRow(line);
    if (editRow && editRow.isConnected) editRow.outerHTML = html;
    else list.insertAdjacentHTML('beforeend', html);
    window.dnsModalEditRow = null;
    window.dnsModalWasCommented = false;
    markConfigDirty();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('dns-server-modal')).hide();
};

// === ОСНОВНОЙ ПАРСЕР ===
function parseConfigToSections(content) {
    let coreLines = [], bootstrap = [], upstream = [], fallback = [], group = [], routing = [], other = [];
    let addresses = [];
    let routesObj = {}; 
    let logging = { level: 'notice' };
    let coreData = { bind: '53', cache_size: '65536', prefetch_domain: 'yes', serve_expired: 'yes', response_mode: 'fastest-response', speed_check_mode: 'tcp:443,ping' };

    content.split(/\r?\n/).forEach(line => {
        const originalTrimmed = line.trim();
        if (!originalTrimmed) return;
        
        if (originalTrimmed.match(/^#{3,}$/) || originalTrimmed.match(/^# [^#]+ #$/)) return;

        let isComment = originalTrimmed.startsWith('#');
        let activeLine = isComment ? originalTrimmed.replace(/^#+\s*/, '') : originalTrimmed;
        
        const matchCmd = activeLine.match(/^([^\s]+)/);
        if (!matchCmd) {
            other.push(originalTrimmed);
            return;
        }
        
        const cmd = matchCmd[1];

        if (['bind', 'cache-size', 'prefetch-domain', 'serve-expired', 'response-mode', 'speed-check-mode'].includes(cmd)) {
            if (!isComment) {
                const val = activeLine.substring(cmd.length).trim();
                if (cmd === 'bind') coreData.bind = val.replace(/^:/, '');
                else if (cmd === 'cache-size') coreData.cache_size = val;
                else if (cmd === 'prefetch-domain') coreData.prefetch_domain = val;
                else if (cmd === 'serve-expired') coreData.serve_expired = val;
                else if (cmd === 'response-mode') coreData.response_mode = val;
                else if (cmd === 'speed-check-mode') coreData.speed_check_mode = val;
            } else {
                coreLines.push(originalTrimmed);
            }
        } else if (['rr-filter', 'max-reply-ip-num', 'force-aaaa-soa', 'dns-force-tcp'].includes(cmd)) {
            coreLines.push(originalTrimmed);
        } else if (cmd === 'log-level') {
            if (!isComment) logging.level = activeLine.replace('log-level', '').trim();
            else other.push(originalTrimmed);
        } else if (cmd === 'address') {
            let m = activeLine.match(/^address\s+\/([^\/]+)\/(.+)$/);
            if (m) addresses.push({ domain: m[1], ip: m[2].replace(/,/g, ''), enabled: !isComment });
            else other.push(originalTrimmed);
        } else if (cmd === 'domain-set') {
            let m = activeLine.match(/-name\s+([\w.-]+)\s+-file\s+(.+)$/);
            if (m) {
                if (!routesObj[m[1]]) routesObj[m[1]] = { group: '', files: [] };
                routesObj[m[1]].files.push((isComment ? '# ' : '') + m[2]);
            } else {
                // Preserve unsupported or malformed domain-set directives in Raw/Other.
                other.push(originalTrimmed);
            }
        } else if (cmd === 'nameserver') {
            let m = activeLine.match(/\/domain-set:([\w.-]+)\/([\w.-]+)/);
            if (m) {
                if (!routesObj[m[1]]) routesObj[m[1]] = { group: '', files: [] };
                if (!isComment) routesObj[m[1]].group = m[2];
            } else {
                other.push(originalTrimmed);
            }
        } else if (['server', 'server-tls', 'server-https', 'server-quic', 'server-h3', 'server-tcp'].includes(cmd)) {
            
            // ФИКС: Ищем -group только если перед ним пробел или начало строки
            let groupMatch = activeLine.match(/(?:\s|^)-group\s+([^\s]+)/);
            
            if (activeLine.includes('-bootstrap-dns')) {
                bootstrap.push(originalTrimmed);
            } else if (groupMatch) {
                if (groupMatch[1] === 'fallback') {
                    fallback.push(originalTrimmed); 
                } else {
                    group.push(originalTrimmed);
                }
            } else {
                upstream.push(originalTrimmed);
            }

        } else if (['ipset', 'nftset'].includes(cmd)) {
            routing.push(originalTrimmed); 
        } else {
            other.push(originalTrimmed);
        }
    });

    let bsClean = bootstrap.map(l => cleanDns(l, ['-bootstrap-dns']));
    let upClean = upstream.map(l => cleanDns(l, ['-exclude-default-group', '-e']));
    let fallbackClean = fallback.map(l => cleanDns(l, ['-exclude-default-group', '-e', '-group fallback']));
    
    let groupsObj = {};
    group.forEach(line => {
        let m = line.match(/(?:\s|^)-group\s+([^\s]+)/);
        if (m) {
            if (!groupsObj[m[1]]) groupsObj[m[1]] = [];
            groupsObj[m[1]].push(cleanDns(line, [new RegExp(`-group\\s+${m[1]}`), '-exclude-default-group', '-e']));
        }
    });

    let groupsHtml = Object.keys(groupsObj).map(g => UI.groupCard(g, groupsObj[g].join('\n'))).join('');
    let routesHtml = Object.keys(routesObj).map(r => UI.routeCard(r, routesObj[r].group, routesObj[r].files.join('\n'))).join('');
    let addrHtml = addresses.map(a => UI.addressRow(a.domain, a.ip, a.enabled)).join('');

    return `
    <div class="row">
        <div class="col-md-6">
            ${UI.coreCard(coreData, coreLines)}
            ${UI.card('Bootstrap DNS', 'bootstrap', bsClean, 'Закомментируйте (#) любой адрес, чтобы временно выключить его.')}
            ${UI.card('Вышестоящие DNS (Основная группа)', 'upstream', upClean, 'Серверы по умолчанию (без привязки к группам).')}
            ${UI.card('Резервные DNS (Fallback)', 'fallback', fallbackClean, 'Автоматически получат суффикс <b>-exclude-default-group -group fallback</b>.')}
            ${UI.logCard(logging.level)}
        </div>
        <div class="col-md-6">
            <div class="card bg-dark border-secondary mb-3 shadow-sm">
                <div class="card-header border-secondary section-header d-flex justify-content-between align-items-center py-2">
                    <span>Групповые DNS записи</span>
                    <button class="btn btn-sm btn-outline-success" onclick="addNewGroupUI()"><i class="bi bi-plus-lg"></i> Добавить</button>
                </div>
                <div class="card-body p-2" id="dynamic-groups-container">
                    ${groupsHtml || '<div class="text-muted small p-2" id="no-groups-msg">Нет групп.</div>'}
                </div>
            </div>

            <div class="card bg-dark border-secondary mb-3 shadow-sm">
                <div class="card-header border-secondary section-header d-flex justify-content-between align-items-center py-2">
                    <span>Маршрутизация (Domain-sets)</span>
                    <button class="btn btn-sm btn-outline-success" onclick="addNewRouteUI()"><i class="bi bi-plus-lg"></i> Добавить</button>
                </div>
                <div class="card-body p-2" id="dynamic-routes-container">
                    ${routesHtml || '<div class="text-muted small p-2" id="no-route-msg">Нет маршрутов.</div>'}
                </div>
            </div>

            <div class="card bg-dark border-secondary mb-3 shadow-sm">
                <div class="card-header border-secondary section-header d-flex justify-content-between align-items-center py-2">
                    <span>Локальные адреса (Статика)</span>
                    <button class="btn btn-sm btn-outline-success" onclick="addNewAddressUI()"><i class="bi bi-plus-lg"></i> Добавить</button>
                </div>
                <div class="card-body p-2" id="dynamic-addresses-container">
                    ${addrHtml || '<div class="text-muted small p-2" id="no-addr-msg">Нет адресов.</div>'}
                </div>
            </div>

            ${routing.length > 0 ? UI.card('Прочая маршрутизация (ipset/nftset)', 'routing', routing) : ''}
            ${other.length > 0 ? UI.card('Разное (Сюда улетают все комментарии)', 'other', other) : ''}
        </div>
    </div>`;
}

// === СБОРКА ФАЙЛА ПЕРЕД СОХРАНЕНИЕМ ===
function gatherSectionsText() {
    let text = '';
    
    text += `##########\n# Основные параметры (Core) #\n##########\n`;
    text += `bind :${document.getElementById('core-bind').value}\n`;
    text += `cache-size ${document.getElementById('core-cache-size').value}\n`;
    text += `prefetch-domain ${document.getElementById('core-prefetch').checked ? 'yes' : 'no'}\n`;
    text += `serve-expired ${document.getElementById('core-serve-expired').checked ? 'yes' : 'no'}\n`;
    text += `response-mode ${document.getElementById('core-response-mode').value}\n`;
    
    let speed = [];
    if (document.getElementById('speed-tcp443').checked) speed.push('tcp:443');
    if (document.getElementById('speed-tcp80').checked) speed.push('tcp:80');
    if (document.getElementById('speed-ping').checked) speed.push('ping');
    text += `speed-check-mode ${speed.length ? speed.join(',') : 'none'}\n`;
    
    const coreOthers = document.getElementById('sec-core-others').value;
    if (coreOthers.trim()) text += coreOthers.trim() + '\n';
    text += '\n';

    const collectDnsRows = id => {
        const editor = document.getElementById('sec-' + id);
        return editor ? editor.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean) : [];
    };
        const bsRows = collectDnsRows('bootstrap');
    if (bsRows.length) { text += `##########\n# Bootstrap DNS #\n##########\n`; bsRows.forEach(line => { text += formatDns(line, '-bootstrap-dns') + '\n'; }); text += '\n'; }
    const upRows = collectDnsRows('upstream');
    if (upRows.length) { text += `##########\n# Вышестоящие DNS (Основная группа) #\n##########\n`; upRows.forEach(line => { text += formatDns(line, '') + '\n'; }); text += '\n'; }
    const fbRows = collectDnsRows('fallback');
    if (fbRows.length) { text += `##########\n# Резервные DNS (Fallback) #\n##########\n`; fbRows.forEach(line => { text += formatDns(line, '-exclude-default-group -group fallback') + '\n'; }); text += '\n'; }
    const grpItems = document.querySelectorAll('.group-item');
    if (grpItems.length > 0) {
        text += `##########\n# Групповые записи #\n##########\n`;
        grpItems.forEach(item => {
            let name = item.querySelector('.group-name-input').value.trim();
            const groupEditor = item.querySelector('.group-dns-list');
            const dnsRows = groupEditor ? groupEditor.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean) : [];
            if (name && dnsRows.length) {
                dnsRows.forEach(line => { text += formatDns(line, `-exclude-default-group -group ${name}`) + '\n'; });
            }
        });
        text += '\n';
    }

    const routeItems = document.querySelectorAll('.route-item');
    if (routeItems.length > 0) {
        text += `##########\n# Маршрутизация списков (Domain-sets) #\n##########\n`;
        routeItems.forEach(item => {
            let name = item.querySelector('.route-name').value.trim();
            let group = item.querySelector('.route-group').value.trim();
            let files = Array.from(item.querySelectorAll('.route-file-select')).map(input => (input.value || input.dataset.currentPath || '').trim()).filter(Boolean).join('\n');
            
            if (name && group && files) {
                files.split('\n').forEach(f => {
                    let fTrim = f.trim();
                    if (fTrim) {
                        let isComment = fTrim.startsWith('#');
                        if (isComment) fTrim = fTrim.replace(/^#+\s*/, '');
                        text += (isComment ? '#' : '') + `domain-set -name ${name} -file ${fTrim}\n`;
                    }
                });
                text += `nameserver /domain-set:${name}/${group}\n`;
            }
        });
        text += '\n';
    }

    const addrItems = document.querySelectorAll('.address-item');
    if (addrItems.length > 0) {
        text += `##########\n# Локальные адреса (Статика) #\n##########\n`;
        addrItems.forEach(item => {
            let domain = item.querySelector('.addr-domain').value.trim().replace(/,/g, '');
            let ip = item.querySelector('.addr-ip').value.trim().replace(/,/g, '');
            const enabled = item.querySelector('.addr-enabled')?.checked !== false;
            if (domain && ip) text += (enabled ? '' : '# ') + `address /${domain}/${ip}\n`;
        });
        text += '\n';
    }

    const logSel = document.getElementById('sec-logging-select');
    if (logSel) {
        text += `##########\n# Логирование #\n##########\n`;
        text += `log-level ${logSel.value}\n\n`;
    }

    ['routing', 'other'].forEach(id => {
        const el = document.getElementById('sec-' + id);
        if (el && el.value.trim()) {
            const titles = { 'routing': 'Прочая маршрутизация', 'other': 'Разное' };
            text += `##########\n# ${titles[id]} #\n##########\n${el.value.trim()}\n\n`;
        }
    });

    return text.trim();
}