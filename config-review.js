(function(root) {
    // Hirschberg LCS: exact line comparison with linear working memory.
    function diffLines(before, after) {
        const a = before.split('\n'), b = after.split('\n');
        const out = [];
        const add = (type, text) => out.push({type, text});
        function lengths(x, y) {
            let row = new Uint32Array(y.length + 1);
            for (const line of x) {
                const next = new Uint32Array(y.length + 1);
                for (let j = 0; j < y.length; j++) next[j + 1] = line === y[j] ? row[j] + 1 : Math.max(row[j + 1], next[j]);
                row = next;
            }
            return row;
        }
        function compare(x, y) {
            let head = 0;
            while (head < x.length && head < y.length && x[head] === y[head]) add('context', x[head++]);
            x = x.slice(head); y = y.slice(head);
            let tail = 0;
            while (tail < x.length && tail < y.length && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;
            const suffix = tail ? x.slice(-tail) : [];
            if (tail) { x = x.slice(0, -tail); y = y.slice(0, -tail); }
            if (!x.length) y.forEach(line => add('add', line));
            else if (!y.length) x.forEach(line => add('remove', line));
            else if (x.length === 1) {
                const at = y.indexOf(x[0]);
                if (at < 0) { add('remove', x[0]); y.forEach(line => add('add', line)); }
                else { y.slice(0, at).forEach(line => add('add', line)); add('context', x[0]); y.slice(at + 1).forEach(line => add('add', line)); }
            } else {
                const present = new Set(x);
                if (!y.some(line => present.has(line))) {
                    x.forEach(line => add('remove', line)); y.forEach(line => add('add', line));
                } else {
                    const mid = Math.floor(x.length / 2);
                    const left = lengths(x.slice(0, mid), y);
                    const right = lengths(x.slice(mid).reverse(), y.slice().reverse());
                    let split = 0, score = -1;
                    for (let j = 0; j <= y.length; j++) {
                        const value = left[j] + right[y.length - j];
                        if (value > score) { score = value; split = j; }
                    }
                    compare(x.slice(0, mid), y.slice(0, split));
                    compare(x.slice(mid), y.slice(split));
                }
            }
            suffix.forEach(line => add('context', line));
        }
        if (before !== after) compare(a, b);
        return out;
    }
    function configDiff(before, after) {
        return diffLines(before, after).map(line => ({add:'+ ', remove:'- ', context:'  '}[line.type]) + line.text).join('\n');
    }
    function reviewConfigChanges(before, after, options = {}) {
        const lines = diffLines(before, after);
        const diff = lines.length > 0;
        if (!diff) return Promise.resolve(true);
        return new Promise(resolve => {
            const previousFocus = document.activeElement;
            const dialog = document.createElement('dialog');
            dialog.className = 'config-review rounded shadow p-4';
            dialog.style.cssText = 'width:min(960px,94vw);max-height:90vh';
            dialog.setAttribute('aria-labelledby', 'config-review-title');
            const heading = document.createElement('h2');
            heading.id = 'config-review-title';
            heading.className = 'h5';
            heading.textContent = options.title ? 'Изменения: '+options.title : 'Изменения конфигурации';
            const description = document.createElement('p');
            description.textContent = options.preview ? 'Просмотр правок относительно последнего сохранённого файла. Этот просмотр ничего не записывает.' : options.apply ? 'Проверьте изменения перед применением и перезапуском DNS.' : 'Проверьте изменения перед сохранением файла.';
            const pre = document.createElement('pre');
            pre.style.cssText = 'max-height:55vh;overflow:auto;white-space:pre;tab-size:4';
            pre.tabIndex = 0;
            // Collapse long unchanged sections; keep three lines of context at each edge.
            let index = 0;
            while (index < lines.length) {
                if (lines[index].type !== 'context') {
                    const row = document.createElement('span');
                    row.className = 'config-diff-line config-diff-' + lines[index].type;
                    row.textContent = (lines[index].type === 'add' ? '+ ' : '- ') + lines[index].text;
                    pre.append(row); index++; continue;
                }
                let end = index;
                while (end < lines.length && lines[end].type === 'context') end++;
                const visible = [];
                if (index > 0) for (let i = index; i < Math.min(index + 3, end); i++) visible.push(i);
                if (end < lines.length) for (let i = Math.max(index, end - 3); i < end; i++) if (!visible.includes(i)) visible.push(i);
                let cursor = index;
                for (const i of visible) {
                    if (i > cursor) appendGap(i - cursor);
                    const row = document.createElement('span');
                    row.className = 'config-diff-line'; row.textContent = '  ' + lines[i].text; pre.append(row);
                    cursor = i + 1;
                }
                if (cursor < end) appendGap(end - cursor);
                index = end;
            }
            function appendGap(count) {
                const row = document.createElement('span'); row.className = 'config-diff-line config-diff-gap';
                row.textContent = '⋯ ' + count + ' строк без изменений'; pre.append(row);
            }
            const cancel = document.createElement('button');
            cancel.type = 'button'; cancel.className = 'btn btn-secondary me-2'; cancel.textContent = options.preview ? 'Закрыть' : 'Отмена';
            const save = document.createElement('button');
            save.type = 'button'; save.className = 'btn btn-primary'; save.textContent = options.apply ? 'Далее к применению' : 'Сохранить файл';
            const finish = accepted => {
                dialog.close(); dialog.remove();
                if (previousFocus && previousFocus.isConnected) previousFocus.focus();
                resolve(accepted);
            };
            cancel.onclick = () => finish(false);
            save.onclick = () => finish(true);
            dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
            dialog.append(heading, description, pre, cancel);
            if(!options.preview)dialog.append(save);
            document.body.append(dialog);
            dialog.showModal(); cancel.focus();
        });
    }
    root.reviewValidationReport = function(report, always = false) {
        if (!always && !report.errors.length && !report.warnings.length) return Promise.resolve(true);
        return new Promise(resolve => {
            const prior = document.activeElement;
            const dialog = document.createElement('dialog');
            dialog.className = 'config-review rounded shadow p-4';
            dialog.style.cssText = 'width:min(800px,94vw);max-height:90vh;overflow:auto';
            dialog.setAttribute('aria-labelledby', 'config-validation-title');
            const title = document.createElement('h2');
            title.id = 'config-validation-title'; title.className = 'h5';
            title.textContent = (report.kind === 'preflight' ? 'Тест DNS' : 'Проверка конфигурации') + ' · SmartDNS ' + (report.profile || '?');
            const summary = document.createElement('p');
            summary.textContent = 'Ошибок: ' + report.errors.length + ' · Предупреждений: ' + report.warnings.length + '. ' + (report.kind === 'preflight' ? 'Проверен снимок редактора на момент запуска, отдельным экземпляром без применения конфига.' : 'Статическая проверка; ответы DNS не проверялись.');
            dialog.append(title, summary);
            for (const [key, label] of [['errors','Ошибка'], ['warnings','Предупреждение'], ['info','Информация']]) {
                if (!report[key].length) continue;
                const section = document.createElement(key === 'info' ? 'details' : 'div');
                if (key === 'info') { const heading = document.createElement('summary'); heading.textContent = (report.kind === 'preflight' ? 'Подробности проверки: ' : 'Выключенные записи: ') + report.info.length; section.append(heading); }
                const list = document.createElement('ul');
                report[key].forEach(message => { const item = document.createElement('li'); item.textContent = label + ': ' + message; list.append(item); });
                section.append(list); dialog.append(section);
            }
            const close = accepted => { dialog.close(); dialog.remove(); if (prior?.isConnected) prior.focus(); resolve(accepted); };
            const cancel = document.createElement('button');
            cancel.className = 'btn btn-secondary me-2'; cancel.textContent = always || report.errors.length ? 'Закрыть' : 'Отмена';
            cancel.onclick = () => close(false); dialog.append(cancel);
            if (!always && !report.errors.length) {
                const proceed = document.createElement('button'); proceed.className = 'btn btn-primary'; proceed.textContent = 'Продолжить';
                proceed.onclick = () => close(true); dialog.append(proceed);
            }
            dialog.addEventListener('cancel', event => { event.preventDefault(); close(false); });
            document.body.append(dialog); dialog.showModal(); cancel.focus();
        });
    };
    root.configDiff = configDiff;
    root.diffLines = diffLines;
    root.reviewConfigChanges = reviewConfigChanges;
    if (typeof module !== 'undefined') module.exports = {configDiff, diffLines};
})(typeof window !== 'undefined' ? window : globalThis);
