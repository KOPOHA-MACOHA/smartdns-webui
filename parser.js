// === УМНАЯ ТРАНСФОРМАЦИЯ DNS ===
window.formatDns = function(url, suffix) {
    let isComment = url.startsWith('#');
    if (isComment) url = url.replace(/^#+\s*/, '');
    
    let prefix = '';
    // Если юзер УЖЕ написал server или server-h3 вручную, не добавляем дубликат
    if (!url.match(/^server(?:-[a-z0-9]+)?\s+/)) {
        prefix = 'server';
        if (url.startsWith('https://')) prefix = 'server-https';
        else if (url.startsWith('tls://')) prefix = 'server-tls';
        else if (url.startsWith('quic://') || url.startsWith('doq://')) prefix = 'server-quic';
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
        } else if (rest.includes('://')) { 
            line = rest;
        }
    }
    
    if (Array.isArray(suffixesToRemove)) {
        suffixesToRemove.forEach(s => {
            // Защита: если удаляем "-e", чтобы не отрезало кусок от "-exclude-default-group"
            if (s === '-e') line = line.replace(/\s+-e\b/g, '');
            else line = line.replace(new RegExp(s, 'g'), '');
        });
    } else {
        line = line.replace(suffixesToRemove, '');
    }
    line = line.replace(/\s+/g, ' ').trim();
    
    return isComment ? `# ${line}` : line;
}

// === ГЕНЕРАТОРЫ HTML КАРТОЧЕК ===
const UI = {
    escape: (str) => str ? str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') : '',
    
    card: (title, id, linesArr, notice = '') => {
        const val = linesArr.join('\n');
        const rows = Math.max(3, Math.min(15, linesArr.length));
        return `
        <div class="card bg-dark border-secondary mb-3 shadow-sm">
            <div class="card-header border-secondary section-header py-2"><span>${title}</span></div>
            <div class="card-body p-0">
                ${notice ? `<div class="p-2 text-muted small border-bottom border-secondary" style="font-size:0.75rem;">${notice}</div>` : ''}
                <textarea id="sec-${id}" class="form-control code-font border-0 rounded-0 p-2" rows="${rows}" oninput="markConfigDirty()">${UI.escape(val)}</textarea>
            </div>
        </div>`;
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

    addressRow: (domain, ip) => `
        <div class="address-item d-flex mb-2">
            <input type="text" class="form-control form-control-sm bg-secondary text-light border-secondary addr-domain me-2" placeholder="Домен (или # домен)" value="${UI.escape(domain)}" oninput="markConfigDirty()">
            <input type="text" class="form-control form-control-sm bg-secondary text-light border-secondary addr-ip me-2 w-50" placeholder="IP" value="${UI.escape(ip)}" oninput="markConfigDirty()">
            <button class="btn btn-sm btn-outline-danger" onclick="this.parentElement.remove(); markConfigDirty();" title="Удалить"><i class="bi bi-trash"></i></button>
        </div>`,

    routeCard: (name, group, files) => `
        <div class="route-item border border-secondary p-2 mb-2 rounded bg-dark position-relative shadow-sm">
            <div class="d-flex mb-2">
                <input type="text" class="form-control form-control-sm bg-secondary text-light border-secondary route-name w-50 me-2 fw-bold" placeholder="Имя сета" value="${UI.escape(name)}" oninput="markConfigDirty()">
                <input type="text" class="form-control form-control-sm bg-secondary text-light border-secondary route-group w-50 me-2" placeholder="В группу" value="${UI.escape(group)}" oninput="markConfigDirty()">
                <button class="btn btn-sm btn-outline-danger" onclick="this.closest('.route-item').remove(); markConfigDirty();" title="Удалить"><i class="bi bi-trash"></i></button>
            </div>
            <textarea class="form-control code-font bg-secondary text-light border-secondary p-2 route-files" rows="3" placeholder="/opt/etc/smartdns/domains/list.list\n# /opt/... (комментарий)" oninput="markConfigDirty()">${UI.escape(files)}</textarea>
        </div>`,

    groupCard: (name, content) => `
        <div class="group-item border border-secondary p-2 mb-2 rounded bg-dark position-relative shadow-sm">
            <div class="d-flex mb-2">
                <input type="text" class="form-control form-control-sm bg-secondary text-light border-secondary group-name-input w-50 me-2 fw-bold" placeholder="Имя группы" value="${UI.escape(name)}" oninput="markConfigDirty()">
                <button class="btn btn-sm btn-outline-danger ms-auto" onclick="this.closest('.group-item').remove(); markConfigDirty();" title="Удалить"><i class="bi bi-trash"></i></button>
            </div>
            <textarea class="form-control code-font bg-secondary text-light border-secondary p-2 group-content-input" rows="3" placeholder="https://dns.geohide.ru/dns-query" oninput="markConfigDirty()">${UI.escape(content)}</textarea>
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

window.addNewGroupUI = () => {
    const cont = document.getElementById('dynamic-groups-container');
    if (cont) { document.getElementById('no-groups-msg')?.remove(); cont.insertAdjacentHTML('beforeend', UI.groupCard('', '')); markConfigDirty(); }
};
window.addNewAddressUI = () => {
    const cont = document.getElementById('dynamic-addresses-container');
    if (cont) { document.getElementById('no-addr-msg')?.remove(); cont.insertAdjacentHTML('beforeend', UI.addressRow('', '')); markConfigDirty(); }
};
window.addNewRouteUI = () => {
    const cont = document.getElementById('dynamic-routes-container');
    if (cont) { document.getElementById('no-route-msg')?.remove(); cont.insertAdjacentHTML('beforeend', UI.routeCard('', '', '')); markConfigDirty(); }
};

// === ОСНОВНОЙ ПАРСЕР ===
function parseConfigToSections(content) {
    let coreLines = [], bootstrap = [], upstream = [], group = [], routing = [], other = [];
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
            if (m) addresses.push({ domain: (isComment ? '# ' : '') + m[1], ip: m[2] });
            else other.push(originalTrimmed);
        } else if (cmd === 'domain-set') {
            let m = activeLine.match(/-name\s+([\w-]+)\s+-file\s+(.+)$/);
            if (m) {
                if (!routesObj[m[1]]) routesObj[m[1]] = { group: '', files: [] };
                routesObj[m[1]].files.push((isComment ? '# ' : '') + m[2]);
            }
        } else if (cmd === 'nameserver') {
            let m = activeLine.match(/\/domain-set:([\w-]+)\/([\w-]+)/);
            if (m) {
                if (!routesObj[m[1]]) routesObj[m[1]] = { group: '', files: [] };
                if (!isComment) routesObj[m[1]].group = m[2];
            } else {
                other.push(originalTrimmed);
            }
        } else if (['server', 'server-tls', 'server-https', 'server-quic', 'server-h3', 'server-tcp'].includes(cmd)) {
            
            // ФИКС: Ищем точное совпадение "-group ИМЯ", чтобы не путать с "-exclude-default-group"
            let groupMatch = activeLine.match(/-group\s+([^\s]+)/);
            
            if (activeLine.includes('-bootstrap-dns')) {
                bootstrap.push(originalTrimmed);
            } else if (groupMatch && groupMatch[1] !== 'fallback') {
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

    let bsClean = bootstrap.map(l => cleanDns(l, /-bootstrap-dns/g));
    let upClean = upstream.map(l => cleanDns(l, ['-exclude-default-group', '-e', '-group fallback']));
    
    let groupsObj = {};
    group.forEach(line => {
        let m = line.match(/-group\s+([^\s]+)/);
        if (m) {
            if (!groupsObj[m[1]]) groupsObj[m[1]] = [];
            groupsObj[m[1]].push(cleanDns(line, new RegExp(`-group\\s+${m[1]}`, 'g')));
        }
    });

    let groupsHtml = Object.keys(groupsObj).map(g => UI.groupCard(g, groupsObj[g].join('\n'))).join('');
    let routesHtml = Object.keys(routesObj).map(r => UI.routeCard(r, routesObj[r].group, routesObj[r].files.join('\n'))).join('');
    let addrHtml = addresses.map(a => UI.addressRow(a.domain, a.ip)).join('');

    return `
    <div class="row">
        <div class="col-md-6">
            ${UI.coreCard(coreData, coreLines)}
            ${UI.card('Bootstrap DNS', 'bootstrap', bsClean, 'Закомментируйте (#) любой адрес, чтобы временно выключить его.')}
            ${UI.card('Вышестоящие и Резервные DNS', 'upstream', upClean, 'Автоматически получат суффикс <b>-exclude-default-group -group fallback</b>.')}
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

    const bsEl = document.getElementById('sec-bootstrap');
    if (bsEl && bsEl.value.trim()) {
        text += `##########\n# Bootstrap DNS #\n##########\n`;
        bsEl.value.trim().split('\n').forEach(l => { if (l.trim()) text += formatDns(l.trim(), '-bootstrap-dns') + '\n'; });
        text += '\n';
    }

    const upEl = document.getElementById('sec-upstream');
    if (upEl && upEl.value.trim()) {
        text += `##########\n# Вышестоящие и Резервные DNS #\n##########\n`;
        upEl.value.trim().split('\n').forEach(l => { if (l.trim()) text += formatDns(l.trim(), '-exclude-default-group -group fallback') + '\n'; });
        text += '\n';
    }

    const grpItems = document.querySelectorAll('.group-item');
    if (grpItems.length > 0) {
        text += `##########\n# Групповые записи #\n##########\n`;
        grpItems.forEach(item => {
            let name = item.querySelector('.group-name-input').value.trim();
            let content = item.querySelector('.group-content-input').value.trim();
            if (name && content) {
                content.split('\n').forEach(l => { if (l.trim()) text += formatDns(l.trim(), `-group ${name}`) + '\n'; });
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
            let files = item.querySelector('.route-files').value.trim();
            
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
            let domain = item.querySelector('.addr-domain').value.trim();
            let ip = item.querySelector('.addr-ip').value.trim();
            if (domain && ip) {
                let isComment = domain.startsWith('#');
                if (isComment) domain = domain.replace(/^#+\s*/, '');
                text += (isComment ? '#' : '') + `address /${domain}/${ip}\n`;
            }
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