/* Navigation and presentation only; drafts belong to ChangeController. */
(function () {
    'use strict';
    const root = document.documentElement;
    let actionsOpen = false;
    window.closeActionPanel = function (returnFocus = false) {
        actionsOpen = false;
        const panel = document.getElementById('action-panel');
        panel.hidden = true; panel.inert = true;
        document.getElementById('action-backdrop').hidden = true;
        document.getElementById('settings-toggle').setAttribute('aria-expanded', 'false');
        document.querySelector('.app-shell').inert = false;
        if (returnFocus) document.getElementById('settings-toggle').focus();
    };
    window.toggleActionPanel = function () {
        if (actionsOpen) return window.closeActionPanel(true);
        actionsOpen = true;
        const panel = document.getElementById('action-panel');
        panel.hidden = false; panel.inert = false;
        document.getElementById('action-backdrop').hidden = false;
        document.getElementById('settings-toggle').setAttribute('aria-expanded', 'true');
        document.querySelector('.app-shell').inert = true;
        panel.querySelector('button').focus();
    };
    const sections = {
        core: ['Основные параметры', 'Параметры DNS, кэш, обработка запросов и серверы по умолчанию.'],
        groups: ['Группы DNS', 'Объединяйте серверы в группы и выбирайте, какие из них использовать для разных доменов.'],
        routing: ['Маршрутизация', 'Назначайте DNS-группы спискам доменов и задавайте локальные адреса. Сетевые маршруты настраиваются в Keenetic.'],
        lists: ['Списки доменов', 'Редактируйте списки доменов, которые используются в правилах DNS.'],
        logs: ['Журнал SmartDNS', 'Просматривайте события службы и сообщения об ошибках.']
    };
    window.syncShellNavigation = function (page, section) {
        if (page === 'settings' && !section) {
            section = document.querySelector('.settings-subtab-panel.active')?.id.replace('settings-subtab-', '') || 'core';
        }
        const content = sections[page === 'settings' ? section : page] || sections.core;
        document.getElementById('page-title').textContent = content[0];
        document.getElementById('page-description').textContent = content[1];
        root.dataset.page = page;
        window.fitEditorPanes?.();
        document.querySelector('.page-eyebrow').textContent = 'SMARTDNS / ' + (page === 'logs' ? 'ДИАГНОСТИКА' : 'НАСТРОЙКИ');
        document.querySelectorAll('#app-navigation [data-page],#settings-section-tabs [data-section]').forEach(button => {
            const selected = button.dataset.page ? button.dataset.page === page : page === 'settings' && button.dataset.section === section;
            button.classList.toggle('active', selected);
            if (selected) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
        });
    };
    window.fitEditorPanes = function () {
        const fit = () => {
            for (const el of document.querySelectorAll('#settings-raw-view .CodeMirror,#raw-config-text,.list-editor-frame,#log-view,#log-content')) {
                if (!el.getClientRects().length) continue;
                const height = Math.max(240,window.innerHeight - el.getBoundingClientRect().top - 16);
                const value = height + 'px';
                if (el.style.height !== value) el.style.height = value;
            }
        };
        if (window.requestAnimationFrame) window.requestAnimationFrame(fit); else fit();
    };
    window.addEventListener('resize', window.fitEditorPanes);
    if (window.ResizeObserver) new ResizeObserver(window.fitEditorPanes).observe(document.querySelector('.app-main'));
    function finishNavigation() { window.scrollTo({top:0,behavior:'instant'}); window.fitEditorPanes(); }
    window.openSettingsSection = async function (section) {
        if (!['core', 'groups', 'routing'].includes(section) || changes.operation) return;
        await switchTab('settings', null);
        if (activeTab !== 'settings' || changes.operation) return;
        switchSettingsMode('ui');
        if (currentSettingsMode !== 'ui') return;
        switchConfigSubtab(section);
        finishNavigation();
    };
    window.openShellPage = async function (page) {
        if (!['settings', 'lists', 'logs'].includes(page) || changes.operation) return;
        await switchTab(page, null);
        if (activeTab === page) finishNavigation();
    };
    document.addEventListener('keydown', event => {
        if (actionsOpen) {
            // Native review dialogs and Bootstrap dialogs manage their own keyboard focus.
            if (document.querySelector('dialog[open],.modal.show')) return;
            if (event.key === 'Escape') { event.preventDefault(); window.closeActionPanel(true); }
            else if (event.key === 'Tab') {
                const controls = [...document.querySelectorAll('#action-panel button:not(:disabled),#action-panel select:not(:disabled),#action-panel summary,#action-panel input:not(:disabled)')].filter(el => !el.closest('details:not([open])') || el.tagName === 'SUMMARY');
                const first = controls[0], last = controls.at(-1);
                if (!document.getElementById('action-panel').contains(document.activeElement) || (!event.shiftKey && document.activeElement === last)) { event.preventDefault(); first.focus(); }
                else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            }
            return;
        }
    });
})();
