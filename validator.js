/* Conservative offline checks for common SmartDNS configuration mistakes.
 * This deliberately does not claim to implement SmartDNS's full grammar.
 */
(function (root) {
    'use strict';

    const SERVER_DIRECTIVES = new Set([
        'server', 'server-tcp', 'server-tls', 'server-https', 'server-quic', 'server-h3'
    ]);
    const REQUIRED_VALUE = new Set([
        'bind', 'cache-size', 'prefetch-domain', 'serve-expired',
        'response-mode', 'speed-check-mode', 'log-level', 'address',
        'domain-set', 'nameserver', 'ipset', 'nftset'
    ]);
    const BOOL_DIRECTIVES = new Set(['prefetch-domain', 'serve-expired']);
    const LOG_LEVELS = new Set(['fatal', 'error', 'warn', 'notice', 'info', 'debug']);

    function stripComment(line) {
        let quote = '';
        let escaped = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (escaped) { escaped = false; continue; }
            if (ch === '\\') { escaped = true; continue; }
            if (quote) {
                if (ch === quote) quote = '';
            } else if (ch === '"' || ch === "'") {
                quote = ch;
            } else if (ch === '#') {
                return line.slice(0, i);
            }
        }
        return line;
    }

    function unclosedQuote(line) {
        let quote = '';
        let escaped = false;
        for (const ch of line) {
            if (escaped) { escaped = false; continue; }
            if (ch === '\\') { escaped = true; continue; }
            if (quote) {
                if (ch === quote) quote = '';
            } else if (ch === '"' || ch === "'") {
                quote = ch;
            }
        }
        return quote;
    }

    function validateSmartDnsConfig(text) {
        const errors = [];
        const warnings = [];
        const lines = String(text == null ? '' : text).split(/\r?\n/);

        lines.forEach((raw, index) => {
            const lineNo = index + 1;
            const trimmed = raw.trim();
            if (!trimmed || trimmed.startsWith('#')) return;

            const quote = unclosedQuote(stripComment(raw));
            if (quote) {
                errors.push('Строка ' + lineNo + ': незакрытая кавычка ' + quote + '.');
                return;
            }

            const active = stripComment(raw).trim();
            if (!active) return;
            const parts = active.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
            if (!parts.length) return;
            const directive = parts[0];
            const args = parts.slice(1);

            if (SERVER_DIRECTIVES.has(directive)) {
                // Stop at options: URL-valued options are not extra endpoints.
                const optionsIndex = args.findIndex((arg, i) => i > 0 && arg.startsWith('-'));
                const endpoints = args.slice(1, optionsIndex < 0 ? args.length : optionsIndex);
                if (endpoints.some(arg => /^(?:https?|tls|dot|quic|doq|h3|tcp):\/\//i.test(arg.replace(/^["']/, '')))) {
                    errors.push('Строка ' + lineNo + ': укажите каждый DNS-сервер отдельной строкой; несколько URL в одной директиве не поддерживаются.');
                }
            }
            if (directive === 'response-mode' && args.length &&
                !['first-ping', 'fastest-ip', 'fastest-response'].includes(args[0])) {
                errors.push('Строка ' + lineNo + ': неизвестный response-mode "' + args[0] + '".');
            }

            if (REQUIRED_VALUE.has(directive) && args.length === 0) {
                errors.push('Строка ' + lineNo + ': директива ' + directive + ' требует значение.');
                return;
            }

            if (SERVER_DIRECTIVES.has(directive) && args.length === 0) {
                errors.push('Строка ' + lineNo + ': ' + directive + ' требует адрес DNS-сервера.');
                return;
            }

            if (BOOL_DIRECTIVES.has(directive) && args.length && !['yes', 'no'].includes(args[0])) {
                errors.push('Строка ' + lineNo + ': ' + directive + ' принимает yes или no.');
            }

            if (directive === 'cache-size' && args.length && !/^(?:-1|\d+)$/.test(args[0])) {
                errors.push('Строка ' + lineNo + ': cache-size должен быть целым числом от -1.');
            }

            if (directive === 'log-level' && args.length && !LOG_LEVELS.has(args[0])) {
                errors.push('Строка ' + lineNo + ': неизвестный уровень log-level "' + args[0] + '".');
            }

            if (directive === 'bind' && args.length) {
                // Validate only an explicit port suffix; don't try to parse all SmartDNS bind forms.
                const endpoint = args[0].replace(/^["']|["']$/g, '');
                const portMatch = endpoint.match(/:(\d+)$/);
                if (portMatch) {
                    const port = Number(portMatch[1]);
                    if (port < 1 || port > 65535) {
                        errors.push('Строка ' + lineNo + ': порт bind должен быть в диапазоне 1–65535.');
                    }
                } else if (/:[^:]*$/.test(endpoint) && !endpoint.startsWith('[')) {
                    warnings.push('Строка ' + lineNo + ': не удалось проверить формат bind "' + endpoint + '"; проверьте адрес и порт вручную.');
                }
            }

            for (let i = 1; i < parts.length; i++) {
                if (parts[i] === '-group' && (!parts[i + 1] || parts[i + 1].startsWith('-'))) {
                    errors.push('Строка ' + lineNo + ': после -group нужно указать имя DNS-группы.');
                    break;
                }
            }
        });

        return { errors: Array.from(new Set(errors)), warnings: Array.from(new Set(warnings)) };
    }

    function parseValidationReport(text) {
        const result = {profile:'', kind:'static', errors:[], warnings:[], info:[]};
        String(text).split(/\r?\n/).filter(Boolean).forEach(line => {
            const [level, number, ...rest] = line.split('\t');
            if (level === 'PROFILE') { result.profile = number; result.kind = rest[0] === 'preflight' ? 'preflight' : 'static'; return; }
            const field = {E:'errors', W:'warnings', I:'info'}[level];
            if (!field || !/^\d+$/.test(number) || !rest.length) { result.errors.push('Некорректный ответ серверного валидатора.'); return; }
            result[field].push((number !== '0' ? 'Строка ' + number + ': ' : '') + rest.join(' '));
        });
        if (!result.profile) result.errors.push('Версия SmartDNS не получена; проверка не подтверждена.');
        return result;
    }
    root.validateSmartDnsConfig = validateSmartDnsConfig;
    root.parseValidationReport = parseValidationReport;
    if (typeof module !== 'undefined' && module.exports) module.exports = { validateSmartDnsConfig, parseValidationReport };
}(typeof window !== 'undefined' ? window : globalThis));
