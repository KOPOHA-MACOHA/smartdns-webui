(function(root) {
    'use strict';
    const labels = {ARMING:'Запуск сторожа отката',CHECKING:'Проверка прежнего файла и кандидата',APPLYING:'Применение и перезапуск',VERIFYING:'Проверка рабочего DNS',AWAITING_CONFIRMATION:'DNS-проверки пройдены. Подтвердите работу сети',COMMITTED:'Применение подтверждено',ROLLING_BACK:'Восстановление прежнего файла и службы',ROLLED_BACK:'Прежний файл восстановлен, DNS-проверки пройдены',REJECTED:'Применение отклонено до изменения рабочего файла',ROLLBACK_FAILED:'Откат не подтверждён. Требуется диагностика через SSH'};
    const terminal = new Set(['COMMITTED','ROLLED_BACK','REJECTED','ROLLBACK_FAILED']);
    function parseApplyStatus(text) {
        const match = /^STATUS ([A-Z_]+)\nDEADLINE ([0-9]+)\n?$/.exec(text);
        if (!match || !labels[match[1]]) throw new Error('Неизвестный ответ операции применения');
        return {state:match[1],deadline:Number(match[2])};
    }
    function monitorSafeApply(id, request) {
        if (!/^tx-[A-Za-z0-9]{12}$/.test(id)) return Promise.reject(new Error('Некорректный номер операции'));
        return new Promise(resolve => {
            const prior = document.activeElement;
            const dialog = document.createElement('dialog');dialog.className='config-review rounded shadow p-4';
            dialog.style.cssText='width:min(760px,94vw);max-height:90vh;overflow:auto';
            const title=document.createElement('h2');title.className='h5';title.textContent='Применение SmartDNS';title.id='safe-apply-title';dialog.setAttribute('aria-labelledby',title.id);
            const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
            const note=document.createElement('p');note.textContent='Без подтверждения сторож вернёт прежний файл. Закрытие вкладки не отменяет откат. Проверяется DNS роутера; доступ из вашей сети проверьте самостоятельно.';
            const detail=document.createElement('small');detail.textContent='Операция '+id;detail.style.display='block';
            const confirm=document.createElement('button');confirm.className='btn btn-primary me-2';confirm.textContent='Сеть работает — подтвердить';confirm.disabled=true;
            const abort=document.createElement('button');abort.className='btn btn-warning me-2';abort.textContent='Вернуть прежний конфиг';
            const close=document.createElement('button');close.className='btn btn-secondary';close.textContent='Скрыть';
            let done=false,closed=false,timer=null,started=Date.now(),inFlight=false;
            const finish = result => {
                if(closed)return;closed=true;clearTimeout(timer);dialog.close();dialog.remove();if(prior?.isConnected)prior.focus();resolve(result);
            };
            async function poll(action='get_apply_status') {
                if(closed || inFlight)return;
                inFlight=true;confirm.disabled=true;abort.disabled=true;
                try {
                    const result=parseApplyStatus(await request(action,id));
                    status.textContent=labels[result.state];
                    const left=Math.max(0,result.deadline-Math.floor(Date.now()/1000));
                    detail.textContent='Операция '+id+(terminal.has(result.state)?'':' · до автоматического отката: '+left+' с');
                    done=terminal.has(result.state);
                    confirm.disabled=result.state!=='AWAITING_CONFIRMATION' || left===0;
                    abort.disabled=done || result.state==='ROLLING_BACK';
                    if(done) {
                        close.textContent='Закрыть';
                        try {root.localStorage?.removeItem('smartdns-apply-transaction');} catch (_) {}
                        if(result.state==='COMMITTED')finish(true);
                    }
                } catch(error) {
                    status.textContent='Статус не получен: '+error.message+'. Результат запроса неизвестен; повторная проверка продолжится.';
                } finally {
                    inFlight=false;
                    if(!done && !closed && Date.now()-started<330000)timer=setTimeout(()=>poll(),2000);
                    else if(!done)detail.textContent='Проверка статуса остановлена. Номер операции: '+id+'. Проверьте журнал через SSH.';
                }
            }
            confirm.onclick=()=>{clearTimeout(timer);poll('confirm_apply');};
            abort.onclick=()=>{clearTimeout(timer);poll('abort_apply');};
            close.onclick=()=>finish(done);
            dialog.addEventListener('cancel',event=>{event.preventDefault();finish(done);});
            dialog.append(title,status,note,detail,confirm,abort,close);document.body.append(dialog);dialog.showModal();close.focus();poll();
        });
    }
    root.parseApplyStatus=parseApplyStatus;root.monitorSafeApply=monitorSafeApply;
    if(typeof module!=='undefined')module.exports={parseApplyStatus};
})(typeof window!=='undefined'?window:globalThis);
