/* Presentation preferences only. Configuration drafts stay in ChangeController. */
(function () {
    'use strict';
    const root = document.documentElement;
    const media = window.matchMedia('(max-width: 767.98px)');
    const preference = 'smartdns-sidebar-collapsed';
    let collapsed = false;
    let mobileOpen = false;
    try { collapsed = localStorage.getItem(preference) === '1'; } catch (_) {}

    function renderSidebar() {
        root.dataset.sidebar = collapsed ? 'collapsed' : 'expanded';
        root.dataset.menuOpen = String(mobileOpen && media.matches);
        const toggle = document.getElementById('sidebar-toggle');
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.title = collapsed ? 'Развернуть меню' : 'Свернуть меню';
        toggle.querySelector('.nav-label').textContent = toggle.title;
        document.getElementById('mobile-menu-toggle').setAttribute('aria-expanded', String(mobileOpen && media.matches));
        document.getElementById('mobile-menu-toggle').setAttribute('aria-label', mobileOpen ? 'Закрыть меню' : 'Открыть меню');
        document.getElementById('menu-backdrop').hidden = !mobileOpen || !media.matches;
        // Prevent tabbing into the offscreen drawer; desktop icons remain accessible.
        document.getElementById('app-navigation').inert = media.matches && !mobileOpen;
        document.getElementById('main-content').inert = media.matches && mobileOpen;
    }
    window.closeMobileMenu = function (returnFocus = false) {
        mobileOpen = false;
        renderSidebar();
        if (returnFocus && media.matches) document.getElementById('mobile-menu-toggle').focus();
    };
    window.toggleSidebar = function () {
        if (media.matches) {
            mobileOpen = !mobileOpen;
            renderSidebar();
            if (mobileOpen) (document.querySelector('#app-navigation [aria-current="page"]') || document.querySelector('#app-navigation nav button')).focus();
            else document.getElementById('mobile-menu-toggle').focus();
        } else {
            collapsed = !collapsed;
            try { localStorage.setItem(preference, collapsed ? '1' : '0'); } catch (_) {}
            renderSidebar();
        }
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
        document.querySelector('.page-eyebrow').textContent = 'SMARTDNS / ' + (page === 'logs' ? 'ДИАГНОСТИКА' : 'НАСТРОЙКИ');
        document.querySelectorAll('#app-navigation [data-page]').forEach(button => {
            const selected = button.dataset.page === page && (page !== 'settings' || button.dataset.section === section);
            button.classList.toggle('active', selected);
            if (selected) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
        });
    };
    function finishNavigation() {
        if (media.matches && mobileOpen) {
            window.closeMobileMenu();
            document.getElementById('page-title').focus({preventScroll: true});
        }
        window.scrollTo({top: 0, behavior: 'instant'});
    }
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
        if (!['lists', 'logs'].includes(page) || changes.operation) return;
        await switchTab(page, null);
        if (activeTab === page) finishNavigation();
    };
    document.addEventListener('keydown', event => {
        if (!mobileOpen || !media.matches) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            window.closeMobileMenu(true);
        } else if (event.key === 'Tab') {
            const buttons = [...document.querySelectorAll('#app-navigation nav button:not(:disabled)')];
            if (!buttons.length) return;
            const first = buttons[0], last = buttons[buttons.length - 1];
            if (!document.getElementById('app-navigation').contains(document.activeElement)) {event.preventDefault(); (event.shiftKey ? last : first).focus();}
            else if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last.focus();}
            else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus();}
        }
    });
    media.addEventListener('change', () => { mobileOpen = false; renderSidebar(); });
    renderSidebar();
})();
