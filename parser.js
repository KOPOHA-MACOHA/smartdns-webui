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

// Existing directives carry their own membership; defaults apply to new endpoints.
window.dnsMembership = function(line) {
    const tokens = line.replace(/^#+\s*/, '').match(/"[^"]*"|'[^']*'|\S+/g) || [];
    const groups = [];
    tokens.forEach((token, i) => {
        if ((token === '-group' || token === '-g') && tokens[i + 1]) groups.push(tokens[i + 1]);
    });
    return { tokens, groups, bootstrap: tokens.includes('-bootstrap-dns') || tokens.includes('-b') };
};
window.formatDnsForSection = function(line, group = '', sourceGroup = '', bootstrap = false) {
    const raw = line.trim();
    const active = raw.replace(/^#+\s*/, '');
    if (raw.startsWith('#') && !/^(?:server(?:-[a-z0-9]+)?\s|\w+:\/\/|\d|\[|[^\s]+\.[^\s]+)/.test(active)) return raw;
    let result = formatDns(raw, '');
    const membership = dnsMembership(active);
    const hasGroup = membership.groups.length > 0;
    if (group && sourceGroup && group !== sourceGroup && hasGroup) {
        const tokens = dnsMembership(result).tokens;
        tokens.forEach((token, i) => {
            if ((token === '-group' || token === '-g') && tokens[i + 1] === sourceGroup) tokens[i + 1] = group;
        });
        result = (result.startsWith('#') ? '#' : '') + tokens.join(' ');
    }
    if (group && !hasGroup) result += ` -exclude-default-group -group ${group}`;
    if (bootstrap && !membership.bootstrap) result += ' -bootstrap-dns';
    return result;
};

// Show endpoints while retaining the complete imported directives in DOM snapshots.
window.dnsDisplay = function(line) {
    const m = line.trim().match(/^(#\s*)?(server(?:-[a-z0-9]+)?)\s+("[^"]*"|'[^']*'|\S+)/);
    if (!m) return line;
    const schemes = {'server-tls':'dot://', 'server-quic':'doq://', 'server-tcp':'tcp://', 'server-h3':'h3://'};
    return (m[1] ? '# ' : '') + (!m[3].includes('://') ? (schemes[m[2]] || '') : '') + m[3];
};
window.restoreDnsEditor = function(editor) {
    if (!editor) return [];
    const lines = editor.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const key = s => s.replace(/^#+\s*/, '');
    const records = JSON.parse(editor.dataset.dnsRecords || '[]').map(raw => ({raw, display:dnsDisplay(raw), used:false}));
    const result = lines.map(line => {
        const record = records.find(r => !r.used && key(r.display) === key(line));
        if (!record) return null;
        record.used = true;
        return (line.startsWith('#') ? '#' : '') + record.raw.replace(/^#+\s*/, '');
    });
    const pending = lines.map((line, i) => result[i] === null ? i : -1).filter(i => i >= 0);
    const remaining = records.filter(r => !r.used);
    if (pending.length && remaining.length && (pending.length !== 1 || remaining.length !== 1)) {
        throw new Error('Изменяйте DNS-адреса по одному или используйте Raw: невозможно безопасно сопоставить дополнительные параметры серверов.');
    }
    if (pending.length === 1 && remaining.length === 1 && !/^#?\s*server(?:-|\s)/.test(lines[pending[0]])) {
        const i = pending[0], line = lines[i], endpoint = key(line);
        const parts = remaining[0].raw.replace(/^#+\s*/, '').match(/^(server(?:-[a-z0-9]+)?)\s+("[^"]*"|'[^']*'|\S+)(.*)$/);
        if (parts) result[i] = (line.startsWith('#') ? '#' : '') + (endpoint.includes('://') ? formatDns(endpoint, '') : parts[1] + ' ' + endpoint) + parts[3];
    }
    return lines.map((line, i) => result[i] === null ? line : result[i]);
};

// === ГЕНЕРАТОРЫ HTML КАРТОЧЕК ===
const UI = {
    escape: (str) => str ? str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') : '',
    help: (text) => `<details class="setting-help" name="config-help" onclick="event.stopPropagation()"><summary aria-label="Пояснение" title="Что меняет эта настройка">?</summary><div class="setting-help-text" role="note"><button type="button" class="btn-close float-end ms-2" aria-label="Закрыть пояснение" onclick="this.closest('details').open=false"></button>${UI.escape(text)}</div></details>`,
    
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
        const dnsSection = ['bootstrap','upstream'].includes(id);
        const body = dnsSection
            ? '<textarea data-dns-records="' + UI.escape(JSON.stringify(linesArr)) + '" id="sec-' + id + '" class="form-control code-font dns-multiline-editor border-0 rounded-0 p-3" rows="' + Math.max(5, Math.min(12, linesArr.length + 2)) + '" spellcheck="false" oninput="markConfigDirty(event)" placeholder="Один DNS-сервер на строку; строки с # отключены">' + UI.escape(linesArr.map(dnsDisplay).join('\n')) + '</textarea>'
            : '<textarea id="sec-' + id + '" class="form-control code-font border-0 rounded-0 p-2" rows="' + Math.max(3, Math.min(15, linesArr.length)) + '" oninput="markConfigDirty(event)">' + UI.escape(linesArr.join('\n')) + '</textarea>';
        return '<div class="card mb-3"><div class="card-header section-header d-flex justify-content-between align-items-center"><span>' + title + '</span></div><div class="card-body p-0">' + (notice ? '<div class="p-2 text-muted small border-bottom">' + notice + '</div>' : '') + body + '</div></div>';
    },
    logCard: (level) => `
        <div class="card bg-dark border-secondary mb-3 shadow-sm">
            <div class="card-header border-secondary section-header py-2"><span>Логирование</span></div>
            <div class="card-body p-3">
                <div class="d-flex align-items-center">
                    <label for="sec-logging-select" class="form-label text-light small fw-bold mb-0 me-3">Уровень логов (log-level):</label>
                    <span class="log-level-select-wrap"><select id="sec-logging-select" class="form-select form-select-sm bg-secondary text-light border-secondary" onchange="markConfigDirty(event)">
                        ${['fatal','error','warn','notice','info','debug'].map(l => `<option value="${l}" ${l===level?'selected':''}>${l}</option>`).join('')}
                    </select></span>
                </div>
            </div>
        </div>`,

    addressRow: (domain, ip, enabled = true) => `
        <div class="address-item d-flex mb-2 align-items-center${enabled ? '' : ' is-disabled'}">
            <label class="dns-enabled-control" title="Включить или отключить локальный адрес">
                <input type="checkbox" class="addr-enabled" ${enabled ? 'checked' : ''} onchange="toggleAddressRecord(this)" aria-label="Включить локальный адрес">
            </label>
            <i class="bi bi-grip-vertical text-secondary me-2 drag-handle" style="cursor: grab; font-size: 1.2rem;"></i>
            <input type="text" class="form-control form-control-sm bg-secondary text-light border-secondary addr-domain me-2" placeholder="Домен" value="${UI.escape(domain)}" oninput="this.value=this.value.replace(/,/g, ''); markConfigDirty(event)">
            <input type="text" class="form-control form-control-sm bg-secondary text-light border-secondary addr-ip me-2 w-50" placeholder="IP через запятую" value="${UI.escape(ip)}" oninput="markConfigDirty(event)">
            <button class="btn btn-sm btn-outline-danger" onclick="this.parentElement.remove(); markConfigDirty();" title="Удалить"><i class="bi bi-trash"></i></button>
        </div>`,

    routeFileRow: (path) => `
        <div class="route-file-row d-flex align-items-center gap-2">
            <i class="bi bi-file-earmark-text text-secondary"></i>
            <select class="form-select form-select-sm route-file-select" data-current-path="${UI.escape(path)}" onchange="this.dataset.currentPath=this.value; markConfigDirty(event)"><option value="" disabled ${path ? '' : 'selected'}>Выберите список…</option>${path ? '<option value="' + UI.escape(path) + '" selected>' + UI.escape(path) + '</option>' : ''}</select>
            <button type="button" class="icon-action danger" onclick="this.closest('.route-file-row').remove(); markConfigDirty();" title="Убрать список"><i class="bi bi-trash3"></i></button>
        </div>`,
    routeCard: (name, group, files, policy = {}) => `
        <div class="route-item border p-2 mb-2 rounded position-relative shadow-sm">
            <div class="route-heading d-flex gap-2 align-items-center mb-2">
                <i class="bi bi-grip-vertical text-secondary drag-handle" style="cursor:grab;font-size:1.1rem" title="Перетащить"></i>
                <div class="editable-name route-editable-name flex-grow-1">
                    <span class="route-name-display fw-semibold">${UI.escape(name || 'Новый маршрут')}</span>
                    <input type="text" class="form-control form-control-sm route-name d-none" value="${UI.escape(name)}" placeholder="Имя набора" oninput="updateInlineName(this); markConfigDirty(event)" onblur="setTimeout(() => finishInlineEdit(this), 120)" onkeydown="if(event.key==='Enter'){event.preventDefault();finishInlineEdit(this)}else if(event.key==='Escape'){finishInlineEdit(this,true)}">
                    <button type="button" class="btn btn-sm btn-link text-secondary p-1" onclick="toggleInlineEdit(this)" title="Переименовать"><i class="bi bi-pencil"></i></button>
                </div>
                <button class="btn btn-sm btn-outline-danger" onclick="this.closest('.route-item').remove(); markConfigDirty();" title="Удалить маршрут"><i class="bi bi-trash"></i></button>
            </div>
            <div class="route-fields">
                <div class="route-field"><div class="route-field-label">DNS-группа для этих доменов</div><select aria-label="DNS-группа маршрута" class="form-select form-select-sm route-group" data-current-group="${UI.escape(group)}" onchange="this.dataset.currentGroup=this.value; markConfigDirty(event)"><option value="${UI.escape(group)}" selected>${UI.escape(group)}</option></select></div>
                <div class="route-field"><div class="route-field-label">Списки доменов</div><div class="route-files-list">
                ${(files || '').split(/\r?\n/).filter(f => f.trim()).map(f => UI.routeFileRow(f)).join('') || '<div class="route-files-empty settings-section-hint mb-2">Списки ещё не добавлены</div>'}
                </div><button class="route-add-file" type="button" onclick="addRouteFileUI(this)"><i class="bi bi-plus-lg me-1"></i>Добавить ещё список</button><p class="route-files-note">Все списки в этом правиле используют выбранную DNS-группу.</p></div>
            </div>
            ${routePolicyCard(policy)}
        </div>`,

    groupCard: (name, content) => `
        <div class="group-item border p-2 mb-2 rounded position-relative shadow-sm" data-group-name="${UI.escape(name)}" data-source-group="${UI.escape(name)}">
            <div class="group-heading d-flex gap-2 align-items-center mb-2" onclick="toggleDnsGroupFromHeader(event, this)">
                <i class="bi bi-grip-vertical text-secondary drag-handle" style="cursor:grab;font-size:1.1rem" title="Перетащить"></i>
                <button type="button" class="group-collapse-toggle btn btn-sm btn-link text-reset p-1" onclick="toggleDnsGroup(this)" aria-expanded="true" title="Свернуть DNS-группу" aria-label="Свернуть DNS-группу"><i class="bi bi-chevron-down"></i></button>
                <div class="editable-name group-editable-name">
                    <span class="group-name-display fw-semibold">${UI.escape(name || 'Новая DNS-группа')}</span>
                    <input type="text" class="form-control form-control-sm group-name-input d-none" value="${UI.escape(name)}" data-prev-name="${UI.escape(name)}" placeholder="Имя группы" oninput="renameDnsGroup(this); markConfigDirty(event)" onblur="setTimeout(() => finishInlineEdit(this), 120)" onkeydown="if(event.key==='Enter'){event.preventDefault();finishInlineEdit(this)}else if(event.key==='Escape'){finishInlineEdit(this,true)}">
                    <button type="button" class="btn btn-sm btn-link text-secondary p-1" onclick="toggleInlineEdit(this)" title="Переименовать"><i class="bi bi-pencil"></i></button>
                </div>
                <div class="group-summary" aria-live="polite"></div>
                <button class="btn btn-sm btn-outline-danger" onclick="this.closest('.group-item').remove(); refreshRouteGroupOptions(); markConfigDirty();" title="Удалить группу"><i class="bi bi-trash"></i></button>
            </div>
            <div class="group-body">
                <textarea data-dns-records="${UI.escape(JSON.stringify((content || '').split(/\r?\n/).filter(Boolean)))}" class="form-control code-font dns-multiline-editor group-dns-list border-0 rounded-0 p-3" rows="${Math.max(5, Math.min(12, (content || '').split(/\r?\n/).length + 2))}" spellcheck="false" oninput="markConfigDirty(event)" placeholder="Один DNS-сервер на строку; строки с # отключены">${UI.escape((content || '').split(/\r?\n/).map(dnsDisplay).join('\n'))}</textarea>
            </div>
        </div>`,
    coreCard: (data, rawLines) => `
        <div class="card bg-dark border-secondary mb-3 shadow-sm">
            <div class="card-header border-secondary section-header py-2"><span>Основные параметры (Core)</span></div>
            <div class="card-body p-3">
                ${UI.bindPortField(data)}
                <div class="row mb-3 align-items-center dns-bind-advanced ${data.show_simple_bind ? 'd-none' : ''}">
                    <div class="col-sm-6"><label class="form-label text-light small mb-0">Адрес и порт (bind):</label></div>
                    <div class="col-sm-6"><input type="text" id="core-bind" class="form-control form-control-sm bg-secondary text-light border-secondary" value="${UI.escape(data.bind)}" oninput="markConfigDirty(event)"></div>
                </div>
        <div class="row mb-3 dns-bind-advanced ${data.show_simple_bind ? 'd-none' : ''}"><div class="col-sm-6"><label class="form-label small" for="core-bind-tcp">Адреса TCP DNS (bind-tcp)</label></div><div class="col-sm-6"><textarea id="core-bind-tcp" class="form-control form-control-sm" rows="1" placeholder="Не задано" oninput="markConfigDirty(event)">${UI.escape(data.bind_tcp.join('\n'))}</textarea></div></div>
                <div class="row mb-3 align-items-center">
                    <div class="col-sm-6"><label class="form-label text-light small mb-0">Размер кэша:</label></div>
                    <div class="col-sm-6"><input type="number" id="core-cache-size" class="form-control form-control-sm bg-secondary text-light border-secondary" value="${UI.escape(data.cache_size)}" oninput="markConfigDirty(event)"></div>
                </div>
                <div class="row mb-3 align-items-center">
                    <div class="col-sm-6"><label class="form-label text-light small mb-0">Упреждающее обновление:</label></div>
                    <div class="col-sm-6"><div class="form-check form-switch m-0"><input class="form-check-input shadow-none" type="checkbox" id="core-prefetch" ${data.prefetch_domain === 'yes' ? 'checked' : ''} onchange="markConfigDirty(event)"></div></div>
                </div>
                <div class="row mb-3 align-items-center">
                    <div class="col-sm-6"><label class="form-label text-light small mb-0">Отдавать просроченный кэш:</label></div>
                    <div class="col-sm-6"><div class="form-check form-switch m-0"><input class="form-check-input shadow-none" type="checkbox" id="core-serve-expired" ${data.serve_expired === 'yes' ? 'checked' : ''} onchange="markConfigDirty(event)"></div></div>
                </div>
                <div class="row mb-3 align-items-center">
                    <div class="col-sm-6"><label class="form-label text-light small mb-0">Выбор лучшего IP:</label></div>
                    <div class="col-sm-6">
                        <select id="core-response-mode" class="form-select form-select-sm bg-secondary text-light border-secondary" onchange="markConfigDirty(event)">
                            <option value="fastest-response" ${data.response_mode === 'fastest-response' ? 'selected' : ''}>fastest-response</option>
                            <option value="first-ping" ${data.response_mode === 'first-ping' ? 'selected' : ''}>first-ping</option>
                            <option value="fastest-ip" ${data.response_mode === 'fastest-ip' ? 'selected' : ''}>fastest-ip</option>
                            ${['fastest-response','first-ping','fastest-ip'].includes(data.response_mode) ? '' : `<option value="${UI.escape(data.response_mode)}" selected>${UI.escape(data.response_mode)} (проверьте значение)</option>`}
                        </select>
                    </div>
                </div>
                <div class="row mb-2 align-items-start">
                    <div class="col-sm-6"><label class="form-label text-light small mb-0">Проверка скорости:</label></div>
                    <div class="col-sm-6">
                        <div class="form-check mb-1"><input class="form-check-input" type="checkbox" id="speed-ping" ${data.speed_check_mode.includes('ping') ? 'checked' : ''} onchange="markConfigDirty(event)"><label class="form-check-label small text-light">ICMP Ping</label></div>
                        <div class="form-check mb-1"><input class="form-check-input" type="checkbox" id="speed-tcp443" ${data.speed_check_mode.includes('tcp:443') ? 'checked' : ''} onchange="markConfigDirty(event)"><label class="form-check-label small text-light">TCP 443</label></div>
                        <div class="form-check mb-2"><input class="form-check-input" type="checkbox" id="speed-tcp80" ${data.speed_check_mode.includes('tcp:80') ? 'checked' : ''} onchange="markConfigDirty(event)"><label class="form-check-label small text-light">TCP 80</label></div>
                    </div>
                </div>
                ${UI.coreExtraFields(data)}
                <label class="form-label small" for="sec-core-others">Дополнительные параметры Core ${UI.help('Дополнительные bind, отключённые строки и параметры без отдельного переключателя. Они сохраняются как написаны. Одна полная директива на строку; # отключает строку.')}</label>
                <textarea id="sec-core-others" class="form-control code-font" rows="3" oninput="markConfigDirty(event)">${UI.escape(rawLines.join('\n'))}</textarea>
                <input type="hidden" id="core-speed-original" value="${UI.escape(data.speed_check_mode)}" data-selection="${['tcp:443','tcp:80','ping'].filter(v => data.speed_check_mode.split(',').includes(v)).join(',')}">
            </div>
        </div>`,
    coreExtraFields: data => `

        ${[['force-aaaa-soa','Блокировать IPv6-ответы (force-AAAA-SOA)',data.force_aaaa_soa],['cache-persist','Сохранять кэш на диск',data.cache_persist]].map(([id,label,value]) => `<div class="row mb-3"><div class="col-sm-6"><label class="form-label small" for="core-${id}">${label}</label></div><div class="col-sm-6"><select id="core-${id}" class="form-select form-select-sm" onchange="markConfigDirty(event)">${[['','Не задано (наследовать)'],['yes','Да'],['no','Нет'],...(['','yes','no'].includes(value)?[]:[[value,value+' (проверьте значение)']])].map(([v,text])=>`<option value="${UI.escape(v)}" ${v===value?'selected':''}>${UI.escape(text)}</option>`).join('')}</select></div></div>`).join('')}`
};
UI.bindPortField = data => `<div class="dns-bind-port"><div class="row mb-3 align-items-center"><div class="col-sm-6"><label class="form-label small" for="core-dns-port">Порт DNS (UDP и TCP)</label></div><div class="col-sm-6"><input type="number" min="1" max="65535" step="1" id="core-dns-port" ${data.show_simple_bind?'':'disabled'} class="form-control form-control-sm" value="${UI.escape(data.simple_bind?.port || '')}" data-simple="${data.show_simple_bind?'yes':'no'}" data-prefix="${UI.escape(data.simple_bind?.prefix || '')}" oninput="markConfigDirty(event)"><div class="small text-muted mt-1">Принимать запросы по UDP и TCP</div><div id="dns-bind-listen-hint" class="small text-muted mt-1" ${data.show_simple_bind?'':'hidden'}>${UI.escape(dnsBindListenHint(data.simple_bind?.prefix))}</div></div></div><button id="dns-bind-toggle" type="button" class="btn btn-sm btn-outline-info bind-mode-toggle mb-3" aria-expanded="${data.show_simple_bind?'false':'true'}" onclick="this.getAttribute('aria-expanded')==='true'?useSimplifiedDnsBind():useAdvancedDnsBind()"><i class="bi bi-sliders" aria-hidden="true"></i><span>${data.show_simple_bind?'Расширенные настройки адресов':'Скрыть расширенные настройки'}</span></button><div class="small text-muted mb-2" id="dns-bind-mode-hint" role="status"></div></div>`;

function useAdvancedDnsBind() {
    const port = document.getElementById('core-dns-port');
    if (port.dataset.simple === 'yes') {
        const value = unifiedDnsBind(port);
        document.getElementById('core-bind').value = value;
        document.getElementById('core-bind-tcp').value = value;
        port.dataset.simple = 'no';
    }
    port.disabled=true;
    document.getElementById('dns-bind-listen-hint').hidden=true;
    updateBindToggle(true);
    document.querySelectorAll('.dns-bind-advanced').forEach(el=>el.classList.remove('d-none'));
    if(typeof autoResizeTextarea==='function')autoResizeTextarea(document.getElementById('core-bind-tcp'));
    saveDnsBindMode('advanced');
    // Opening advanced controls alone is not a configuration change.
}
function updateBindToggle(advanced) {
    const toggle=document.getElementById('dns-bind-toggle');
    if(toggle){toggle.setAttribute('aria-expanded',String(advanced));toggle.querySelector('span').textContent=advanced?'Скрыть расширенные настройки':'Расширенные настройки адресов';}
    document.getElementById('dns-bind-mode-hint').textContent='';
}
function saveDnsBindMode(mode) {
    try { localStorage.setItem('smartdns-ui-bind-mode',mode); } catch (_) {}
}
function dnsBindListenHint(prefix) {
    return 'Адрес прослушивания SmartDNS: ' + (prefix || 'все IPv4-адреса') + '. Меняется в расширенных настройках.';
}
function simpleDnsBind(bind, tcp, others) {
    const match = bind.match(/^(\[[0-9a-fA-F:.]+\]|(?:\d{1,3}\.){3}\d{1,3}|):(\d+)$/);
    if (match && match[1]) {
        if (match[1].startsWith('[')) {
            try { new URL('http://' + match[1]); } catch (_) { return null; }
        } else if (match[1].split('.').some(part=>+part>255)) return null;
    }
    const extra = others.split(/\r?\n/).some(line=>/^\s*bind(?:-tcp)?\s/.test(line));
    return match && !extra && tcp.length===1 && tcp[0]===bind && +match[2]>=1 && +match[2]<=65535
        ? {prefix:match[1],port:match[2]} : null;
}
function useSimplifiedDnsBind() {
    const bind = document.getElementById('core-bind').value.trim();
    const tcp = document.getElementById('core-bind-tcp').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    const simple = simpleDnsBind(bind,tcp,document.getElementById('sec-core-others').value);
    if (!simple) {
        document.getElementById('dns-bind-mode-hint').textContent='Нельзя объединить текущие адреса: нужны одна одинаковая пара UDP/TCP без аргументов и без дополнительных bind. Адреса не изменены.';
        return false;
    }
    const port = document.getElementById('core-dns-port');
    port.value=simple.port; port.dataset.prefix=simple.prefix; port.dataset.simple='yes';
    port.disabled=false;
    const hint=document.getElementById('dns-bind-listen-hint');
    hint.textContent=dnsBindListenHint(simple.prefix); hint.hidden=false;
    updateBindToggle(false);
    document.querySelectorAll('.dns-bind-advanced').forEach(el=>el.classList.add('d-none'));
    saveDnsBindMode('simple');
    return true;
}
function unifiedDnsBind(port) {
    if (!/^\d+$/.test(port.value) || +port.value<1 || +port.value>65535) throw new Error('Порт DNS должен быть целым числом от 1 до 65535.');
    return port.dataset.prefix + ':' + Number(port.value);
}

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

window.toggleDnsGroupFromHeader = function(event, heading) {
    // Keep controls and drag handling independent from the header's collapse action.
    if (!event || !heading || event.target.closest('button, input, textarea, select, a, .drag-handle, [contenteditable="true"]')) return;
    const button = heading.querySelector('.group-collapse-toggle');
    if (button) window.toggleDnsGroup(button);
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
    if (cont) { document.getElementById('no-groups-msg')?.remove(); cont.insertAdjacentHTML('beforeend', UI.groupCard('', '')); addConfigHelp(cont); refreshRouteGroupOptions(); markConfigDirty(); }
};
window.addNewAddressUI = () => {
    const cont = document.getElementById('dynamic-addresses-container');
    if (cont) { document.getElementById('no-addr-msg')?.remove(); cont.insertAdjacentHTML('beforeend', UI.addressRow('', '')); addConfigHelp(cont); markConfigDirty(); }
};
window.addNewRouteUI = () => {
    const cont = document.getElementById('dynamic-routes-container');
    if (cont) { document.getElementById('no-route-msg')?.remove(); cont.insertAdjacentHTML('beforeend', UI.routeCard('', '', '')); addConfigHelp(cont); refreshRouteGroupOptions(); markConfigDirty(); }
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
    refreshDomainPolicyGroups();
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
        refreshDomainPolicyGroups(oldName,newName);
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

// Browser-only help: no polling, router requests or SmartDNS work.
function addConfigHelp(root) {
    const fields = {
        'core-dns-port': 'Один порт для входящих UDP и TCP DNS. Адреса IPv4/IPv6 сохраняются автоматически. Обычно нужен 53: другой порт требует перенастройки клиентов. Значение — целое число от 1 до 65535. Защита применения проверяет фактические адреса и порты UDP/TCP; доступность DNS для клиентов нужно подтвердить после применения.',
        'core-bind': 'Адрес и порт входящих UDP-запросов клиентов. :53 слушает IPv4; [::]:53 — IPv6 и, при разрешённом dual-stack в ОС, IPv4. Это не адрес вышестоящего DNS. Удаление или смена порта может лишить клиентов DNS.',
        'core-bind-tcp': 'Входящий DNS по TCP: нужен для крупных ответов и клиентов, переключающихся с UDP на TCP. Одна пара адрес:порт с возможными аргументами на строку. Пустое поле удаляет bind-tcp. Это не принудительное использование TCP для upstream.',
        'core-force-aaaa-soa': 'Да: вместо IPv6-адресов (AAAA) SmartDNS возвращает пустой ответ SOA. Клиенты обычно используют IPv4; IPv6-only сервисы могут перестать работать. Не отключает IPv6 на роутере и не мешает принимать DNS-запросы по IPv6.',
        'core-cache-persist': 'Сохраняет кэш на диск для повторного использования после запуска. Да добавляет запись на накопитель; Нет отключает сохранение. Не задано оставляет поведение SmartDNS по умолчанию. Это не ограничение оперативной памяти.',
        'core-cache-size': 'Количество записей в кэше, не мегабайты. Больше записей — больше повторных ответов без обращения к upstream, но выше расход RAM. Память одной записи различается; размер кэша не равен общему лимиту памяти SmartDNS. 0 отключает кэш, -1 включает автоматический размер. На роутере с 254 МБ учитывайте также nfqws2 и sing-box.',
        'core-prefetch': 'Заранее обновляет популярные записи перед окончанием TTL. Повторные запросы чаще получают готовый ответ, но появляются дополнительные обращения к upstream и небольшая нагрузка. Выключение не отключает обычный кэш.',
        'core-serve-expired': 'Разрешает ответить из кэша после окончания TTL и обновить запись в фоне. Может помочь при задержках upstream, но клиент временно получит устаревший IP. Не гарантирует работу при полном отказе DNS и не заменяет резервные серверы.',
        'core-response-mode': 'fastest-response — быстрый ответ, предпочтение меньшей задержке DNS; first-ping — первый IP, подтвердивший доступность проверкой; fastest-ip — выбор IP по результатам проверки задержки. Проверка доступности зависит от speed-check-mode и может быть заблокирована сетью.',
        'speed-ping': 'Проверяет доступность полученных IP через ICMP. Это задержка ответа, а не скорость скачивания. ICMP может быть запрещён сервером или сетью.',
        'speed-tcp443': 'Проверяет задержку установки TCP-соединения к полученным IP на порту 443. Не проверяет содержимое сайта и не измеряет пропускную способность. Создаёт дополнительные соединения.',
        'speed-tcp80': 'Проверяет задержку установки TCP-соединения к полученным IP на порту 80. Закрытый порт не означает, что HTTPS-сайт недоступен. Снятие всех стандартных проверок отключает их; нестандартные проверки из Raw сохраняются.',
        'sec-logging-select': 'Подробность журнала. error/warn показывают проблемы; info — обычные события; debug создаёт много записей и увеличивает нагрузку и запись на накопитель. Выбор уровня не исправляет ошибки DNS.'
    };
    for (const [id,text] of Object.entries(fields)) {
        const field = root.querySelector('#'+id);
        if (!field) continue;
        const row = field.closest('.row') || field.closest('.card-body') || field.parentElement.parentElement;
        const label = root.querySelector('label[for="'+id+'"]') || (id.startsWith('speed-') ? field.parentElement.querySelector('label') : row.querySelector('label'));
        if (label && !label.querySelector('.setting-help')) label.insertAdjacentHTML('beforeend', UI.help(text));
    }
    const sections = {
        'sec-bootstrap': 'Серверы для получения IP-адресов DoH/DoT, заданных именами. Роль задаётся аргументом -bootstrap-dns, а не положением строки. # отключает сервер. Остальные аргументы импортированной записи сохраняются при редактировании адреса.',
        'sec-upstream': 'Серверы без явного -group. Членство в группах определяется аргументами, а не заголовками Raw. Серверы с -group тоже могут участвовать в default, если нет -exclude-default-group. UDP не шифруется; DoH/DoT шифруют соединение с DNS-сервером.',
        'dynamic-groups-container': 'Наборы upstream для правил nameserver. Имя группы само по себе не направляет трафик в VPN. Дополнительные параметры серверов сохраняются; для изменения аргументов используйте Raw.',
        'dynamic-routes-container': 'Domain-set объединяет домены из файлов; nameserver выбирает для них DNS-группу. Это выбор DNS-резолвера, а не IP-маршрут или автоматическое переключение VPN.',
        'dynamic-addresses-container': 'Ручные ответы вместо обращения к upstream. Несколько доменов разделяются /, IP — запятыми. # отключает запись. Ошибочный IP направит клиентов не на тот сервер.',
        'sec-routing': 'Правила ipset/nftset добавляют полученные адреса в наборы для внешней маршрутизации. Требуют настроек ОС и firewall. Сохраняются полными строками.',
        'sec-other': 'Директивы без отдельного визуального поля и пользовательские комментарии. Они не игнорируются: активные строки читает SmartDNS. Одна полная директива на строку.'
    };
    for (const [id,text] of Object.entries(sections)) {
        const header = root.querySelector('#'+id)?.closest('.card')?.querySelector('.card-header > span');
        if (header && !header.querySelector('.setting-help')) header.insertAdjacentHTML('beforeend',UI.help(text));
    }
    for (const [selector,text] of [
        ['.group-editable-name','Имя DNS-группы. При переименовании обновляются ссылки маршрутов в этом редакторе.'],
        ['.route-editable-name','Имя domain-set: связывает файлы доменов с правилом nameserver.'],
        ['.route-files-list','Один или несколько файлов доменов этого набора. Изменение содержимого файла затрагивает все использующие его наборы.'],
        ['.route-group','DNS-группа для доменов выбранных списков. Не является выбором сетевого интерфейса.'],
        ['.addr-domain','Домены этой ручной записи; несколько доменов разделяются /. Правило применяется также к поддоменам по правилам SmartDNS.'],
        ['.addr-ip','Один или несколько IPv4/IPv6 через запятую. Специальные ответы #, #4, #6 запрещают соответствующие типы; -, -4, -6 отменяют переопределение.']
    ]) root.querySelectorAll(selector).forEach(field => {
        if(selector==='.group-editable-name'){
            if(!field.querySelector('.setting-help'))field.insertAdjacentHTML('afterbegin',UI.help(text));return;
        }
        const label = field.closest('.route-field')?.querySelector('.route-field-label');
        if (label) { if (!label.querySelector('.setting-help')) label.insertAdjacentHTML('beforeend',UI.help(text)); return; }
        if (field.nextElementSibling?.classList.contains('setting-help')) return;
        field.insertAdjacentHTML('afterend',UI.help(text));
    });
}

// === ОСНОВНОЙ ПАРСЕР ===

// Domain policies are independent of fixed address records. Unsupported forms stay in Other.
function readDomainPolicy(line) {
    const m=line.trim().match(/^(#\s*)?(domain-rules|https-record)\s+\/([^/\s]+)\/\s*(.*)$/);
    if(!m || !/^(?:domain-set:)?[a-zA-Z0-9_.*-]+$/.test(m[3]))return null;
    const policy={enabled:!m[1],domain:m[3],group:'',response:'',speed:'',expired:'',https:'',extra:'',raw:[line.trim()]};
    if(m[2]==='https-record') {
        if(m[4]!=='#')return null;
        policy.https='block';return policy;
    }
    const tokens=m[4].match(/"[^"\n]*"|'[^'\n]*'|\S+/g)||[];
    const options={'-nameserver':'group','-response-mode':'response','-speed-check-mode':'speed'};
    const seen=new Set(),extra=[];
    for(let i=0;i<tokens.length;i++) {
        const t=tokens[i],key=options[t];
        if(key) {
            if(seen.has(key)||!tokens[i+1]||tokens[i+1].startsWith('-'))return null;
            seen.add(key);policy[key]=tokens[++i];
        } else if(t==='-no-serve-expired') {
            if(seen.has('expired'))return null;
            seen.add('expired');policy.expired='no';
        } else extra.push(t);
    }
    if(policy.response&&!['fastest-ip','fastest-response','first-ping'].includes(policy.response))return null;
    policy.extra=extra.join(' ');return policy;
}
function domainPolicyValues(item) {
    const value=name=>item.querySelector('.policy-'+name).value.trim();
    return {enabled:item.querySelector('.policy-enabled').checked,domain:value('domain'),group:value('group'),response:value('response'),speed:value('speed'),expired:value('expired'),https:value('https'),extra:value('extra')};
}
function domainPolicyCard(p={}) {
    p={enabled:true,domain:'',group:'',response:'',speed:'',expired:'',https:'',extra:'',raw:[],...p};
    const select=(name,label,options,help)=>'<label class="policy-field"><span>'+label+' '+UI.help(help)+'</span><select class="form-select policy-'+name+'" onchange="updateDomainPolicy(this,event)">'+options.map(([v,t])=>'<option value="'+UI.escape(v)+'" '+(p[name]===v?'selected':'')+'>'+UI.escape(t)+'</option>').join('')+'</select></label>';
    const speedOptions=[['','Как в основных настройках'],['tcp:443','TCP 443'],['tcp:80','TCP 80'],['ping','ICMP Ping'],['tcp:443,ping','TCP 443, затем Ping'],['none','Не проверять']];
    if(p.speed&&!speedOptions.some(([v])=>v===p.speed))speedOptions.push([p.speed,p.speed+' (из конфига)']);
    return '<details class="domain-policy'+(p.enabled?'':' is-disabled')+'" '+(!p.domain?'open':'')+' data-policy="'+UI.escape(JSON.stringify(p))+'"><summary><span class="policy-title">'+UI.escape(p.domain||'Новое правило')+'</span><span class="policy-summary">'+UI.escape(domainPolicySummary(p))+'</span></summary><div class="policy-body"><div class="policy-toolbar"><label><input type="checkbox" class="policy-enabled" '+(p.enabled?'checked':'')+' onchange="updateDomainPolicy(this,event)"> Правило включено</label><button type="button" class="btn btn-sm btn-outline-danger" onclick="this.closest(\'.domain-policy\').remove();markConfigDirty()">Удалить правило</button></div><div class="policy-fields"><label class="policy-field"><span>Домены или domain-set '+UI.help('Один домен на строку, без / и адреса IP. Правило действует также на поддомены. Для существующего набора: domain-set:имя. Это настройки поиска адреса, а не фиксированный IP.')+'</span><textarea rows="2" class="form-control policy-domain" oninput="updateDomainPolicy(this,event)" placeholder="ytimg.com&#10;ggpht.com">'+UI.escape(p.domain)+'</textarea></label>'+select('group','DNS-группа',[['','Как в основных настройках'],[p.group,p.group]].filter(([v],i)=>i===0||v),'Группа серверов для поиска адреса. Не означает направление трафика в VPN; обычный DNS по умолчанию наследуется.')+select('response','Выбор IP',[['','Как в основных настройках'],['fastest-response','Быстрый DNS-ответ'],['first-ping','Первый доступный IP'],['fastest-ip','IP с наименьшей задержкой']],'fastest-ip выбирает IP по проверкам задержки. Это не измерение скорости загрузки и не гарантия работы сервиса.')+select('speed','Проверка доступности',speedOptions,'TCP проверяет установление соединения на выбранный порт; Ping — ICMP. Проверки могут задерживать первый ответ. Порядок методов имеет значение.')+select('expired','Просроченный кэш',[['','Как в основных настройках'],['no','Не использовать']],'Не использовать ответы с истёкшим TTL. Действующий кэш продолжает работать; при отказе upstream просроченный ответ не поможет.')+select('https','DNS-записи HTTPS',[['','Без отдельного правила'],['block','Не возвращать (тип 65)']],'Пустой ответ на DNS-запрос HTTPS. Сам HTTPS сайта не блокируется. Убирает дополнительные подсказки подключения, но не запрещает QUIC/HTTP3.')+'</div>'+(p.extra?'<div class="settings-section-hint">Дополнительные аргументы сохранены. Для их изменения используйте Raw.</div>':'')+'<input type="hidden" class="policy-extra" value="'+UI.escape(p.extra)+'"></div></details>';
}
function routePolicyCard(policy={}) {
    const p={response:'',speed:'',expired:'',https:'',raw:[],...policy};
    const select=(name,label,options,help)=>'<label class="policy-field"><span>'+label+' '+UI.help(help)+'</span><select class="form-select route-policy-'+name+'" onchange="markConfigDirty(event)">'+options.map(([v,t])=>'<option value="'+UI.escape(v)+'" '+(p[name]===v?'selected':'')+'>'+UI.escape(t)+'</option>').join('')+'</select></label>';
    const speedOptions=[['','Как в основных настройках'],['tcp:443','TCP 443'],['tcp:80','TCP 80'],['ping','ICMP Ping'],['tcp:443,ping','TCP 443, затем Ping'],['none','Не проверять']];
    if(p.speed&&!speedOptions.some(([v])=>v===p.speed))speedOptions.push([p.speed,p.speed+' (из конфига)']);
    return '<details class="route-policy" data-route-policy="'+UI.escape(JSON.stringify(p))+'"><summary>Обработка DNS '+UI.help('Отдельные настройки для всех списков этого маршрута. По умолчанию наследуются общие параметры SmartDNS. DNS-группа выбирается выше.')+'</summary><div class="policy-fields">'+select('response','Выбор IP',[['','Как в основных настройках'],['fastest-response','Быстрый DNS-ответ'],['first-ping','Первый доступный IP'],['fastest-ip','IP с наименьшей задержкой']],'fastest-ip выбирает IP по проверкам задержки. Это не измерение скорости загрузки и не гарантия работы сервиса.')+select('speed','Проверка доступности',speedOptions,'TCP проверяет установление соединения на выбранный порт; Ping — ICMP. Проверки могут задерживать первый ответ. Порядок методов имеет значение.')+select('expired','Просроченный кэш',[['','Как в основных настройках'],['no','Не использовать']],'Не использовать ответы с истёкшим TTL. Действующий кэш продолжает работать; при отказе upstream просроченный ответ не поможет.')+select('https','DNS-записи HTTPS',[['','Без отдельного правила'],['block','Не возвращать (тип 65)']],'Пустой ответ на DNS-запрос HTTPS. Сам HTTPS сайта не блокируется. Убирает дополнительные подсказки подключения, но не запрещает QUIC/HTTP3.')+'</div></details>';
}
function gatherRoutePolicy(item,name,group) {
    const panel=item.querySelector('.route-policy');if(!panel)return '';
    const original=JSON.parse(panel.dataset.routePolicy);
    const p=Object.fromEntries(['response','speed','expired','https'].map(key=>[key,panel.querySelector('.route-policy-'+key).value]));
    if(original.raw.length && original.domain==='domain-set:'+name && original.sourceGroup===group && Object.keys(p).every(key=>p[key]===original[key]))return original.raw.join('\n');
    const options=[p.response?'-response-mode '+p.response:'',p.speed?'-speed-check-mode '+p.speed:'',p.expired?'-no-serve-expired':''].filter(Boolean).join(' ');
    return [(options?'domain-rules /domain-set:'+name+'/ '+options:''),(p.https?'https-record /domain-set:'+name+'/#':'')].filter(Boolean).join('\n');
}

function domainPolicySummary(p) {
    return [p.enabled?'':'Отключено',p.group?'DNS: '+p.group:'DNS: по умолчанию',p.response==='fastest-ip'?'Выбор по задержке':'',p.speed,p.expired?'Без просроченного кэша':'',p.https?'Без HTTPS-записей':'',p.extra?'Доп. аргументы':''].filter(Boolean).join(' · ');
}
window.updateDomainPolicy=function(control,event) {
    const item=control.closest('.domain-policy'),p=domainPolicyValues(item);
    item.classList.toggle('is-disabled',!p.enabled);
    item.querySelector('.policy-title').textContent=p.domain.replace(/\n/g,', ')||'Новое правило';
    item.querySelector('.policy-summary').textContent=domainPolicySummary(p);
    markConfigDirty(event);
};
window.addDomainPolicy=function() {
    document.getElementById('domain-policies-container').insertAdjacentHTML('beforeend',domainPolicyCard());
    refreshDomainPolicyGroups();markConfigDirty();
};
window.refreshDomainPolicyGroups=function(oldName='',newName='') {
    const names=Array.from(document.querySelectorAll('.group-name-input')).map(el=>el.value.trim()).filter(Boolean);
    document.querySelectorAll('.policy-group').forEach(select=>{
        let value=select.value;if(oldName&&value===oldName)value=newName;
        const choices=[...new Set([...names,...(value?[value]:[])])];
        select.innerHTML='<option value="">Как в основных настройках</option>'+choices.map(name=>'<option value="'+UI.escape(name)+'">'+UI.escape(name)+(names.includes(name)?'':' (не найдена)')+'</option>').join('');
        select.value=value;
        const item=select.closest('.domain-policy');item.querySelector('.policy-summary').textContent=domainPolicySummary(domainPolicyValues(item));
    });
};
function gatherDomainPolicies(root) {
    const lines=[];
    root.querySelectorAll('.domain-policy').forEach(item=>{
        const p=domainPolicyValues(item),original=JSON.parse(item.dataset.policy);
        if(original.raw.length && Object.keys(p).every(key=>p[key]===original[key])) {lines.push(...original.raw);return;}
        const domains=p.domain.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
        if(!domains.length)throw new Error('Правило обработки доменов: укажите домен или удалите пустое правило.');
        if(domains.some(d=>!/^(?:domain-set:)?[a-zA-Z0-9_*-]+(?:\.[a-zA-Z0-9_*-]+)*\.?$/.test(d)))throw new Error('Правило обработки доменов: один домен на строку, без /, пробелов и URL.');
        if(p.group&&!/^[\w.-]+$/.test(p.group))throw new Error('Некорректное имя DNS-группы в правиле.');
        const options=[p.group?'-nameserver '+p.group:'',p.response?'-response-mode '+p.response:'',p.speed?'-speed-check-mode '+p.speed:'',p.expired?'-no-serve-expired':'',p.extra].filter(Boolean).join(' ');
        const prefix=p.enabled?'':'# ';
        domains.forEach(domain=>{
            if(options)lines.push(prefix+'domain-rules /'+domain+'/ '+options);
            if(p.https)lines.push(prefix+'https-record /'+domain+'/#');
        });
        if(!options&&!p.https)throw new Error('Правило обработки доменов: выберите хотя бы одну отдельную настройку.');
    });
    return lines.join('\n');
}

function parseConfigToSections(content) {
    const policies=[];
    const scoped=/^\s*(?:group-begin|group-end)\b/m.test(content);
    let coreLines = [], bootstrap = [], upstream = [], group = [], routing = [], other = [];
    let addresses = [];
    let routesObj = {}; 
    let logging = { level: 'notice' };
    let coreData = { bind: ':53', cache_size: '65536', prefetch_domain: 'yes', serve_expired: 'yes', response_mode: 'fastest-response', speed_check_mode: '' };
    Object.assign(coreData, {bind_tcp: [], force_aaaa_soa: '', cache_persist: ''});
    let seenBind = false;

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

        if (['bind', 'bind-tcp', 'force-AAAA-SOA', 'cache-persist', 'cache-size', 'prefetch-domain', 'serve-expired', 'response-mode', 'speed-check-mode'].includes(cmd)) {
            if (!isComment) {
                const val = activeLine.substring(cmd.length).trim();
                if (cmd === 'bind') {
                    if (seenBind) coreLines.push(originalTrimmed);
                    else { coreData.bind = val; seenBind = true; }
                }
                else if (cmd === 'bind-tcp') coreData.bind_tcp.push(val);
                else if (cmd === 'force-AAAA-SOA') coreData.force_aaaa_soa = val;
                else if (cmd === 'cache-persist') coreData.cache_persist = val;
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
        } else if (!scoped && ['domain-rules','https-record'].includes(cmd) && readDomainPolicy(originalTrimmed)) {
            const policy=readDomainPolicy(originalTrimmed);
            const previous=policies.find(p=>p.domain===policy.domain && p.enabled===policy.enabled && !p.https);
            if(cmd==='https-record' && previous) {previous.https='block';previous.raw.push(originalTrimmed);} else policies.push(policy);
        } else if (cmd === 'address') {
            let m = activeLine.match(/^address\s+\/([^\/]+)\/(.+)$/);
            if (m) addresses.push({ domain: m[1], ip: m[2], enabled: !isComment });
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
            const membership = dnsMembership(activeLine);
            let groupMatch = membership.groups.length ? [null, membership.groups[0]] : null;
            
            if (membership.bootstrap) {
                bootstrap.push(originalTrimmed);
            } else if (groupMatch) {
                group.push(originalTrimmed);
            } else {
                upstream.push(originalTrimmed);
            }

        } else if (['ipset', 'nftset'].includes(cmd)) {
            routing.push(originalTrimmed); 
        } else {
            other.push(originalTrimmed);
        }
    });

    // Fold partial directives by selector, then present equal settings as one card.
    // Preserve all original lines until this card is edited; edits emit effective rules.
    const effective=[];
    for(const p of policies) {
        const prev=!p.extra && effective.find(v=>!v.extra && v.domain===p.domain && v.enabled===p.enabled);
        if(prev) {
            for(const key of ['group','response','speed','expired','https'])if(p[key])prev[key]=p[key];
            prev.raw.push(...p.raw);
        } else effective.push(p);
    }
    policies.length=0;
    for(const p of effective) {
        const name=p.domain.startsWith('domain-set:')?p.domain.slice(11):'';
        const route=routesObj[name];
        if(route && route.files.length && route.group && p.enabled && !p.extra && (!p.group || p.group===route.group)) {
            route.policy={...p,sourceGroup:route.group};continue;
        }
        const prev=!p.extra && policies.find(v=>!v.extra && ['enabled','group','response','speed','expired','https'].every(key=>v[key]===p[key]));
        if(prev) {prev.domain+='\n'+p.domain;prev.raw.push(...p.raw);} else policies.push(p);
    }

    coreData.simple_bind = simpleDnsBind(coreData.bind,coreData.bind_tcp,coreLines.join('\n'));
    coreData.show_simple_bind = !!coreData.simple_bind;
    try { if(localStorage.getItem('smartdns-ui-bind-mode')==='advanced') coreData.show_simple_bind=false; } catch (_) {}
    let bsClean = bootstrap;
    let upClean = upstream;
    
    let groupsObj = {};
    group.forEach(line => {
        const memberships = dnsMembership(line).groups;
        let m = memberships.length ? [null, memberships[0]] : null;
        if (m) {
            if (!groupsObj[m[1]]) groupsObj[m[1]] = [];
            groupsObj[m[1]].push(line);
        }
    });

    let groupsHtml = Object.keys(groupsObj).map(g => UI.groupCard(g, groupsObj[g].join('\n'))).join('');
    let routesHtml = Object.keys(routesObj).map(r => UI.routeCard(r, routesObj[r].group, routesObj[r].files.join('\n'), routesObj[r].policy)).join('');
    let addrHtml = addresses.map(a => UI.addressRow(a.domain, a.ip, a.enabled)).join('');

    const html = `
    <div class="row">
        <div class="col-md-6">
            ${UI.coreCard(coreData, coreLines)}
            ${UI.card('Bootstrap DNS', 'bootstrap', bsClean, 'Закомментируйте (#) любой адрес, чтобы временно выключить его.')}
            ${UI.card('Вышестоящие DNS (Основная группа)', 'upstream', upClean, 'Серверы по умолчанию (без привязки к группам).')}
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

            <div class="card mb-3"><div class="card-header section-header d-flex justify-content-between align-items-center"><span>Правила обработки доменов</span><button type="button" class="btn btn-sm btn-outline-success" onclick="addDomainPolicy()">+ Добавить</button></div><div class="card-body"><p class="settings-section-hint">Отдельные настройки DNS для доменов и списков. Остальные параметры наследуются из основных настроек.</p><div id="domain-policies-container">${policies.map(domainPolicyCard).join('')}</div></div></div>
            ${routing.length > 0 ? UI.card('Прочая маршрутизация (ipset/nftset)', 'routing', routing) : ''}
            ${other.length > 0 ? UI.card('Разное', 'other', other) : ''}
        </div>
    </div>`;
    if (typeof document.createElement !== 'function') return html;
    const container = document.createElement('div');
    container.innerHTML = html;
    addConfigHelp(container);
    const baseline = gatherSectionsCanonical(container);
    return container.innerHTML + '<input type="hidden" id="config-source-record" data-source="' + UI.escape(JSON.stringify(content)) + '" data-baseline="' + UI.escape(JSON.stringify(baseline)) + '">';
}

// === СБОРКА ФАЙЛА ПЕРЕД СОХРАНЕНИЕМ ===
function gatherSectionsText() {
    const generated = gatherSectionsCanonical();
    const record = document.getElementById('config-source-record');
    if (!record) throw new Error('Исходный файл редактора недоступен. Обновите страницу перед сохранением.');
    return patchConfigSource(JSON.parse(record.dataset.source), JSON.parse(record.dataset.baseline), generated);
}



// Browser-side equivalence for button state; the server independently verifies saved state.
function configSemanticKey(source) {
    const rows=[];let unsafe=false;
    for(const line of String(source).split(/\r?\n/)) {
        if(/^[ \t]*(?:#|$)/.test(line))continue;
        const tokens=[];let word='',quote='',escape=false,started=false;
        for(const c of line) {
            if(escape){word+=c;escape=false;started=true;continue;}
            if(c==='\\'){escape=true;started=true;continue;}
            if(quote){if(c===quote)quote='';else word+=c;continue;}
            if(c==='"'||c==="'"){quote=c;started=true;continue;}
            if(c==='#'&&!started&&tokens.length&&!['address','ipset','nftset'].includes(tokens[0]))break;
            if(/[ \t\r]/.test(c)){if(started){tokens.push(word);word='';started=false;}continue;}
            word+=c;started=true;
        }
        if(quote||escape)return null;
        if(started)tokens.push(word);if(!tokens.length)continue;
        const cmd=tokens[0],https=cmd==='https-record'&&tokens.length===2&&/^\/[A-Za-z0-9][A-Za-z0-9_.-]*\/#$/.test(tokens[1]);
        if(cmd==='https-record'&&!https)unsafe=true;
        if(['conf-file','group-begin','group-end','group-match','client-rules'].includes(cmd))unsafe=true;
        if(cmd==='domain-rules')for(let i=2;i<tokens.length;i++){
            if(tokens[i]==='-no-serve-expired')continue;
            if(['-nameserver','-response-mode','-speed-check-mode'].includes(tokens[i])&&i+1<tokens.length){i++;continue;}
            unsafe=true;
        }
        rows.push({tokens,https,logging:cmd==='log-level'&&tokens.length===2,server:/^server(-tcp|-tls|-https)?$/.test(cmd)&&tokens.length>=2});
    }
    const ordered=[],filters=[],logging=[],servers=[];
    for(const row of rows)(!unsafe&&row.https?filters:!unsafe&&row.logging?logging:!unsafe&&row.server?servers:ordered).push(JSON.stringify(row.tokens));
    return JSON.stringify([ordered,filters.sort(),logging,servers]);
}
function sameConfigMeaning(a,b) {
    if(typeof a!=='string'||typeof b!=='string')return false;
    if(a===b)return true;
    const key=configSemanticKey(a);return key!==null&&key===configSemanticKey(b);
}

// Explicit formatting only: preserve quoted/escaped values and comment text.
function formatConfigSource(source) {
    return source.split(/(\r?\n)/).map((line,index)=>{
        if(index%2)return line;
        if(/^\s*#/.test(line))return line.replace(/^[ \t]+/,'').replace(/[ \t]+$/,'');
        let out='',quote='',escape=false,space=false;
        for(let i=0;i<line.length;i++) {
            const c=line[i];
            if(escape){out+=c;escape=false;continue;}
            if(quote){out+=c;if(c==='\\')escape=true;else if(c===quote)quote='';continue;}
            if(c===' '||c==='\t'){space=out.length>0;continue;}
            if(c==='#' && space)return out+' '+line.slice(i).replace(/[ \t]+$/,'');
            if(space){out+=' ';space=false;}
            out+=c;
            if(c==='"'||c==="'")quote=c;
            else if(c==='\\')escape=true;
        }
        return out;
    }).join('');
}

// Explicit formatting action; normal edits still preserve the original file layout.
function organizeDnsSource(source) {
    if (/^\s*(?:group-begin|group-end)\b/m.test(source)) throw new Error('Конфиг содержит области group-begin/group-end: раскладывайте DNS вручную, чтобы сохранить область действия.');
    source=formatConfigSource(source);
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    const finalNewline = source.endsWith('\n');
    const lines = source.split(/\r?\n/);
    if (finalNewline) lines.pop();
    const headings = [
        ['bootstrap','Bootstrap DNS'], ['upstream','Вышестоящие DNS (Основная группа)'],
        ['groups','Групповые записи']
    ];
    const section = line => {
        const m = line.trim().match(/^#\s*(.*?)\s*#$/);
        if (!m || /^#+$/.test(m[1])) return null;
        return headings.find(([,title])=>title===m[1])?.[0] || 'other';
    };
    const blocks = [], moves = new Map(headings.map(([id])=>[id,[]]));
    const removed = new Set();
    let current = null;
    lines.forEach((line,index) => {
        const id = section(line);
        if (id) { current = id; blocks.push({id,index}); }
        if (!/^\s*(?:#+\s*)?server(?:-(?:tls|https|quic|h3|tcp))?\s+/.test(line)) return;
        const member = dnsMembership(line.trim());
        const target = member.bootstrap ? 'bootstrap' : !member.groups.length ? 'upstream' : 'groups';
        if (current !== target) { moves.get(target).push(line); removed.add(index); }
    });
    if (!removed.size) return organizePolicySource(source);
    const insert = new Map();
    const missing = [];
    for (const [id,title] of headings) {
        const records = moves.get(id);
        if (!records.length) continue;
        const block = blocks.find(b=>b.id===id);
        if (!block) { missing.push('', '##########', '# '+title+' #', '##########', ...records); continue; }
        const next = blocks.find(b=>b.index>block.index);
        let end = next ? next.index : lines.length;
        if (end && /^\s*#{3,}\s*$/.test(lines[end-1])) end--;
        while (end>block.index+1 && !lines[end-1].trim()) end--;
        insert.set(end, [...(insert.get(end)||[]), ...records]);
    }
    const result = [];
    for (let i=0;i<=lines.length;i++) {
        if (insert.has(i)) result.push(...insert.get(i));
        if (i<lines.length && !removed.has(i)) result.push(lines[i]);
    }
    return organizePolicySource(result.concat(missing).join(newline)+(finalNewline?newline:''));
}


// Move related directives as a stable sequence: overlapping sets/rules may override each other.

// Pair independent HTTPS filters with their selector without reordering competing HTTPS rules.
function pairPolicyRecords(records) {
    const result=[],segment=[];
    const overlapping=(a,b)=>{
        if(!a||!b||a.startsWith('domain-set:')||b.startsWith('domain-set:')||!/^\w[\w.-]*$/.test(a)||!/^\w[\w.-]*$/.test(b))return true;
        a=a.toLowerCase().replace(/\.$/,'');b=b.toLowerCase().replace(/\.$/,'');
        return a===b||a.endsWith('.'+b)||b.endsWith('.'+a);
    };
    const flush=()=>{
        const last=new Map();segment.forEach(row=>{if(row.kind==='domain-rules')last.set(row.key,row);});
        for(const rule of last.values()) {
            const matches=segment.filter(row=>row.kind==='https-record'&&row.key===rule.key);
            if(matches.length!==1)continue;
            const https=matches[0],from=segment.indexOf(https),anchor=segment.indexOf(rule);
            const crossed=from<anchor?segment.slice(from+1,anchor+1):segment.slice(anchor+1,from);
            if(crossed.some(row=>row.kind==='https-record'&&overlapping(row.selector,https.selector)))continue;
            segment.splice(from,1);segment.splice(segment.indexOf(rule)+1,0,https);
        }
        result.push(...segment.map(row=>row.line));segment.length=0;
    };
    for(const line of records) {
        const m=line.match(/^\s*(#\s*)?(domain-rules|https-record)\s+\/([^/\s]+)\//);
        if(!m){flush();result.push(line);continue;}
        const selector=m[3],key=(m[1]?'disabled:':'active:')+(selector.startsWith('domain-set:')?selector:selector.toLowerCase().replace(/\.$/,''));
        segment.push({line,kind:m[2],selector,key});
    }
    flush();return result;
}

function organizePolicySource(source) {
    const newline=source.includes('\r\n')?'\r\n':'\n',final=source.endsWith('\n');
    const lines=source.split(/\r?\n/);if(final)lines.pop();
    const selected=new Set(),records=[];
    lines.forEach((line,i)=>{if(/^\s*(?:#+\s*)?(?:domain-set|nameserver|domain-rules|https-record)\s+/.test(line)){selected.add(i);records.push(line);}});
    if(!records.length)return source;
    if(records.some(line=>/^\s*(?:#+\s*)?domain-rules\s+/.test(line) && (!readDomainPolicy(line)||readDomainPolicy(line).extra)))throw new Error('Правила с дополнительными аргументами нужно упорядочить вручную: перенос может изменить приоритет адресов или других настроек.');
    if(/^\s*conf-file\b/m.test(source))throw new Error('Конфиг содержит conf-file: порядок правил из включаемых файлов нужно сохранить вручную.');
    let anchor=lines.findIndex(line=>/^\s*#\s*(?:Маршрутизация списков \(Domain-sets\)|Правила DNS \(домены и списки\))\s*#\s*$/.test(line));
    let heading=false;
    if(anchor>=0) {anchor++;if(/^\s*#{3,}\s*$/.test(lines[anchor]||''))anchor++;}
    else {
        anchor=lines.findIndex(line=>/^\s*#\s*(?:Локальные адреса \(Статика\)|Логирование)\s*#\s*$/.test(line));
        if(anchor<0)anchor=Math.min(...selected);else if(anchor>0&&/^\s*#{3,}\s*$/.test(lines[anchor-1]))anchor--;
        heading=true;
    }
    const first=Math.min(...selected);
    if(anchor>first) {anchor=first;heading=true;}
    const output=[];
    for(let i=0;i<=lines.length;i++) {
        if(i===anchor)output.push(...(heading?['##########','# Правила DNS (домены и списки) #','##########']:[]),...pairPolicyRecords(records),...(heading?['']:[]));
        if(i<lines.length&&!selected.has(i))output.push(lines[i]);
    }
    return output.join(newline)+(final?newline:'');
}

// Compare editor states, then apply only their actual changes to the source file.
// Generated section headings never replace user headings, comments or whitespace.
function patchConfigSource(source, baseline, edited) {
    if (baseline === edited) return source;
    const key = line => (line.trim().replace(/^#+\s*/, '# ').match(/"[^"]*"|'[^']*'|\S+/g) || []).join(' ');
    const meaningful = text => text.split(/\r?\n/).filter(line => line.trim() &&
        !/^#{3,}$/.test(line.trim()) && !/^# [^#]+ #$/.test(line.trim()));
    const old = meaningful(baseline), next = meaningful(edited);
    const original = source.split(/\r?\n/).map(text => ({text}));
    const queues = new Map();
    original.forEach(row => {
        const k = key(row.text);
        if (!queues.has(k)) queues.set(k, []);
        queues.get(k).push(row);
    });
    const previous = old.map(text => ({text, row:(queues.get(key(text)) || []).shift(), used:false}));
    const additions = [];
    const nextRows = next.map((text, i) => {
        const match = previous.find(row => !row.used && key(row.text) === key(text));
        if (match) { match.used = true; return match.row; }
        const addition = {text, index:i}; additions.push(addition); return null;
    });
    const family = text => {
        const command = text.trim().replace(/^#+\s*/, '').split(/\s/)[0];
        return /^server(?:-[a-z0-9]+)?$/.test(command) ? 'server' : command;
    };
    for (const removed of previous.filter(row => !row.used)) {
        const replacement = additions.find(row => !row.used && family(row.text) === family(removed.text));
        if (replacement && removed.row) {
            // Preserve the indentation of the edited source line.
            removed.row.text = (removed.row.text.match(/^\s*/) || [''])[0] + replacement.text.trim();
            replacement.used = true;
            nextRows[replacement.index] = removed.row;
        } else if (removed.row) {
            removed.row.deleted = true;
        }
    }
    for (const addition of additions.filter(row => !row.used)) {
        const row = {text:addition.text};
        let anchor = null;
        for (let i = addition.index - 1; i >= 0; i--) if (nextRows[i] && !nextRows[i].deleted) { anchor = nextRows[i]; break; }
        if (anchor) original.splice(original.indexOf(anchor) + 1, 0, row);
        else {
            const following = nextRows.slice(addition.index + 1).find(item => item && !item.deleted);
            if (following) original.splice(original.indexOf(following), 0, row);
            else original.splice(original.length - (original.at(-1)?.text === '' ? 1 : 0), 0, row);
        }
        nextRows[addition.index] = row;
    }
    // Honour deliberate reordering, without applying the generator's section order.
    const kept = previous.map(item => item.row).filter(row => row && !row.deleted && nextRows.includes(row));
    const desired = nextRows.filter(row => kept.includes(row));
    let first = 0, last = kept.length;
    while (first < last && kept[first] === desired[first]) first++;
    while (last > first && kept[last - 1] === desired[last - 1]) last--;
    if (first < last) {
        const positions = kept.slice(first, last).map(row => original.indexOf(row)).sort((a, b) => a - b);
        desired.slice(first, last).forEach((row, i) => { original[positions[i]] = row; });
    }
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    return original.filter(row => !row.deleted).map(row => row.text).join(newline);
}

function gatherSectionsCanonical(root = window.document) {
    const document = {
        getElementById: id => root.querySelector('#' + id),
        querySelectorAll: selector => root.querySelectorAll(selector)
    };
    let text = '';
    
    text += `##########\n# Основные параметры (Core) #\n##########\n`;
    const unifiedPort = document.getElementById('core-dns-port');
    const simpleBind = unifiedPort?.dataset.simple === 'yes' ? unifiedDnsBind(unifiedPort) : null;
    const bindValue = simpleBind || document.getElementById('core-bind').value.trim();
    text += `bind ${/^\d+$/.test(bindValue) ? ':' + bindValue : bindValue}\n`;
    (simpleBind ? [simpleBind] : document.getElementById('core-bind-tcp').value.split(/\r?\n/)).map(s=>s.trim()).filter(Boolean).forEach(value => {
        text += `bind-tcp ${/^\d+$/.test(value)?':'+value:value}\n`;
    });
    for (const [id,command] of [['force-aaaa-soa','force-AAAA-SOA'],['cache-persist','cache-persist']]) {
        const value = document.getElementById('core-'+id).value;
        if (value) text += `${command} ${value}\n`;
    }
    text += `cache-size ${document.getElementById('core-cache-size').value}\n`;
    text += `prefetch-domain ${document.getElementById('core-prefetch').checked ? 'yes' : 'no'}\n`;
    text += `serve-expired ${document.getElementById('core-serve-expired').checked ? 'yes' : 'no'}\n`;
    text += `response-mode ${document.getElementById('core-response-mode').value}\n`;
    
    let speed = [];
    if (document.getElementById('speed-tcp443').checked) speed.push('tcp:443');
    if (document.getElementById('speed-tcp80').checked) speed.push('tcp:80');
    if (document.getElementById('speed-ping').checked) speed.push('ping');
    const originalSpeed = document.getElementById('core-speed-original');
    if (originalSpeed && speed.join(',') === originalSpeed.dataset.selection) {
        if (originalSpeed.value) text += `speed-check-mode ${originalSpeed.value}\n`;
    } else {
        const extraModes = (originalSpeed?.value || '').split(',').filter(v => v && !['none','ping','tcp:443','tcp:80'].includes(v));
        const modes = extraModes.concat(speed);
        text += `speed-check-mode ${modes.length ? modes.join(',') : 'none'}\n`;
    }
    
    const coreOthers = document.getElementById('sec-core-others').value;
    if (coreOthers.trim()) text += coreOthers.trim() + '\n';
    text += '\n';

    const collectDnsRows = id => {
        const editor = document.getElementById('sec-' + id);
        return restoreDnsEditor(editor);
    };
        const bsRows = collectDnsRows('bootstrap');
    if (bsRows.length) { text += `##########\n# Bootstrap DNS #\n##########\n`; bsRows.forEach(line => { text += formatDnsForSection(line, '', '', true) + '\n'; }); text += '\n'; }
    const upRows = collectDnsRows('upstream');
    if (upRows.length) { text += `##########\n# Вышестоящие DNS (Основная группа) #\n##########\n`; upRows.forEach(line => { text += formatDnsForSection(line) + '\n'; }); text += '\n'; }
    const grpItems = document.querySelectorAll('.group-item');
    if (grpItems.length > 0) {
        text += `##########\n# Групповые записи #\n##########\n`;
        grpItems.forEach(item => {
            let name = item.querySelector('.group-name-input').value.trim();
            const groupEditor = item.querySelector('.group-dns-list');
            const dnsRows = restoreDnsEditor(groupEditor);
            if (name && dnsRows.length) {
                dnsRows.forEach(line => { text += formatDnsForSection(line, name, item.dataset.sourceGroup || name) + '\n'; });
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
                const policy=gatherRoutePolicy(item,name,group);if(policy)text+=policy+'\n';
            }
        });
        text += '\n';
    }

    const addrItems = document.querySelectorAll('.address-item');
    if (addrItems.length > 0) {
        text += `##########\n# Локальные адреса (Статика) #\n##########\n`;
        addrItems.forEach(item => {
            let domain = item.querySelector('.addr-domain').value.trim().replace(/,/g, '');
            let ip = item.querySelector('.addr-ip').value.trim();
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

    const policiesText=gatherDomainPolicies(root);
    if(policiesText)text+='\n'+policiesText+'\n';
    ['routing', 'other'].forEach(id => {
        const el = document.getElementById('sec-' + id);
        if (el && el.value.trim()) {
            const titles = { 'routing': 'Прочая маршрутизация', 'other': 'Разное' };
            text += `##########\n# ${titles[id]} #\n##########\n${el.value.trim()}\n\n`;
        }
    });

    return text.trim();
}
