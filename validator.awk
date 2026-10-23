# Static SmartDNS validator. Profile: upstream Release46.1/src/dns_conf.c.
# No system commands, DNS requests, includes or user-selected files are executed.
function report(level, line, message) { gsub(/[\t\r\n]/," ",message); print level "\t" line "\t" message; if(level=="E") errors++ }
function tokenize(line, a,    i,c,q,escape,word,n,started) {
    for(i in a) delete a[i]
    q=""; escape=0; word=""; n=0; started=0
    for(i=1;i<=length(line);i++) {
        c=substr(line,i,1)
        if(escape) { word=word c; escape=0; started=1; continue }
        if(c=="\\") { escape=1; started=1; continue }
        if(q!="") { if(c==q) q=""; else word=word c; continue }
        if(c=="\"" || c=="\047") { q=c; started=1; continue }
        if(c=="#" && !started && n>0 && a[1]!="address" && a[1]!="ipset" && a[1]!="nftset") break
        if(c ~ /[ \t\r]/) { if(started) { a[++n]=word;word="";started=0 };continue }
        word=word c; started=1
    }
    if(q!="" || escape) { report("E",FNR,"Незакрытая кавычка или незавершённое экранирование."); return -1 }
    if(started) a[++n]=word
    return n
}
function value(i,n) { if(i>n || token[i]=="" || (token[i] ~ /^-/ && token[i]!="-" && token[i]!~/^-[0-9]+$/)) { report("E",FNR,"После " token[i-1] " нужно значение."); return 0 };return 1 }
function ipv4(s,    a,n,i) { n=split(s,a,".");if(n!=4)return 0;for(i=1;i<=4;i++)if(a[i]!~/^[0-9]+$/ || a[i]+0>255)return 0;return 1 }
function endpoint(s,cmd,    host,port,scheme) {
    if(s=="" || s ~ /[ \t]/ || s ~ /^-/) {report("E",FNR,"Не указан корректный адрес сервера.");return 0}
    host=s
    if(host ~ /:\/\//) {
        scheme=host;sub(/:\/\/.*$/,"",scheme);sub(/^[^:]+:\/\//,"",host)
        if(scheme!~/^(https|tls|tcp)$/) {report("E",FNR,"Неподдерживаемая схема адреса: " scheme);return 0}
        if(cmd=="server-https" && scheme!="https") report("E",FNR,"Для server-https требуется https://.")
        if(cmd=="server-tls" && scheme!="tls") report("E",FNR,"Для server-tls используйте tls:// или адрес без схемы.")
    } else if(cmd=="server-https") report("E",FNR,"Для server-https требуется полный https:// URL.")
    sub(/\/.*/,"",host)
    if(host ~ /:.*:/ && host !~ /^\[/ && host ~ /^[0-9a-fA-F:.]+$/) return 1
    if(host ~ /^\[/) { if(host!~/^\[[0-9A-Fa-f:.]+\](:[0-9]+)?$/)report("E",FNR,"Некорректный IPv6-адрес/порт.");sub(/^.*\]/,"",host);port=host;sub(/^:/,"",port) }
    else if(host ~ /^[^:]*:/) {port=host;sub(/^[^:]*:/,"",port);sub(/:.*/,"",host)}
    else port=""
    if(host=="" && s!~/^\[/) report("E",FNR,"Пустой адрес сервера.")
    if(port!="" && (port!~/^[0-9]+$/ || port+0<1 || port+0>65535)) report("E",FNR,"Порт сервера должен быть 1–65535.")
    if(host ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ && !ipv4(host)) report("E",FNR,"Некорректный IPv4-адрес.")
    return 1
}
BEGIN {
    if(!preflight) print "PROFILE\t" version "\tstatic"
    strict=(version=="46.1")
    split("drop-packet-latency group proxy interface set-mark subnet host-ip spki-pin host-name http-host tls-host-verify tcp-keepalive D g p",opts," ")
    for(i in opts) takes[opts[i]]=1
    split("exclude-default-group no-check-certificate bootstrap-dns whitelist-ip blacklist-ip hitchhiking subnet-all-query-types e k b",opts," ")
    for(i in opts) flag[opts[i]]=1
    split("prefetch-domain serve-expired cache-persist",opts," ");for(i in opts) boolean[opts[i]]=1
    if(!strict)report("W",0,"Для версии " version " нет проверенного профиля; проверка совместимости неполная.")
}
NR==FNR {if($0!~/^#/ && $0!="") {split($0,profile,"\t");known[profile[1]]=1;if(profile[2]~/^CONF_YESNO/)boolean[profile[1]]=1};next}
!preflight {
    line=$0;sub(/\r$/,"",line)
    if(line ~ /^[ \t]*#/) {if(strict && line ~ /^[ \t]*#[ \t]*server-(h3|quic)[ \t]/)report("I",FNR,"Выключенная H3/DoQ-запись не влияет на DNS; SmartDNS 46.1 её не поддерживает.");next}
    if(line ~ /^[ \t]*$/)next
    n=tokenize(line,token);if(n<=0)next
    cmd=token[1]
    if((cmd in known) && cmd!="group-end" && n<2) {report("E",FNR,"Директива " cmd " требует значение.");next}
    if(cmd=="conf-file") {external=1;report("W",FNR,"Подключённый конфиг не раскрывается статическим валидатором; нужна отдельная проверка.");if(n<2)report("E",FNR,"conf-file требует путь.");next}
    if(cmd=="group-begin" || cmd=="group-end" || cmd=="group-match" || cmd=="client-rules") {complex=1;report("W",FNR,"Контекстные правила сохраняются; полнота проверки групп в этих контекстах ограничена.");next}
    if(cmd ~ /^server(-tcp|-tls|-https|-quic|-h3)?$/) {
        configured++
        if(strict && cmd ~ /^server-(quic|h3)$/) {report("W",FNR,cmd " не поддерживается 46.1 и не создаёт upstream; строка будет проигнорирована.");next}
        if(!strict && cmd ~ /^server-(quic|h3)$/) {external=1;report("W",FNR,"Поддержка " cmd " этой сборкой не подтверждена.");next}
        endpoint(token[2],cmd)
        excluded=0;bootstrap=0;groups="";hostip=""
        for(i=3;i<=n;i++) {
            opt=token[i]
            if(opt!~/^-/) {report("E",FNR,"Лишний аргумент сервера: " opt ". Один адрес на строку.");continue}
            sub(/^--?/,"",opt);inline=0;val=""
            if(index(opt,"=")) {val=substr(opt,index(opt,"=")+1);sub(/=.*/,"",opt);inline=1}
            if(!inline && !(opt in takes) && !(opt in flag) && token[i] !~ /^--/ && length(opt)>1 && substr(opt,1,1) in takes) {val=substr(opt,2);opt=substr(opt,1,1);inline=1}
            if(takes[opt]) {
                if(!inline) {i++;if(!value(i,n))continue;val=token[i]}
                if(val=="")report("E",FNR,"Пустое значение параметра " opt)
                if(opt=="group" || opt=="g") groups=groups " " val
                if(opt=="host-ip")hostip=val
            } else if(flag[opt]) {
                if(inline)report("E",FNR,"Параметр " opt " не принимает значение.")
                if(opt=="exclude-default-group" || opt=="e")excluded=1
                if(opt=="bootstrap-dns" || opt=="b")bootstrap=1
            } else if(strict)report("E",FNR,"Неизвестный аргумент upstream для 46.1: -" opt)
            else report("W",FNR,"Аргумент не проверен для этой версии: -" opt)
        }
        if(n>=2) {
            servers++
            if(!excluded && !bootstrap)members["default"]++
            split(groups,g," ");for(j in g)if(g[j]!="")members[g[j]]++
        }
        next
    }
    if(strict && !(cmd in known)) {report("E",FNR,"Директива " cmd " отсутствует в профиле SmartDNS 46.1.");next}
    if(cmd in boolean) {if(n!=2 || token[2]!~/^(yes|no)$/)report("E",FNR,cmd " принимает только yes или no.")}
    if(cmd=="cache-size" && (n!=2 || token[2]!~/^(-1|[0-9]+)$/))report("E",FNR,"cache-size: целое число от -1.")
    if(cmd=="response-mode" && (n!=2 || token[2]!~/^(first-ping|fastest-ip|fastest-response)$/))report("E",FNR,"Недопустимый response-mode.")
    if(cmd=="log-level" && (n!=2 || token[2]!~/^(debug|info|notice|warn|error|fatal)$/))report("E",FNR,"Недопустимый log-level.")
    if(cmd=="speed-check-mode") {
        if(n!=2)report("E",FNR,"speed-check-mode требует одно значение через запятые.")
        split(token[2],speed,",");for(j in speed)if(speed[j]!~/^(none|ping|tcp:[0-9]+)$/ || (speed[j]~/^tcp:/ && (substr(speed[j],5)+0<1 || substr(speed[j],5)+0>65535)))report("E",FNR,"Некорректный speed-check-mode: " speed[j])
    }
    if(cmd ~ /^bind(-tcp|-tls|-https)?$/) {
        binds++;target="default"
        if(n<2)report("E",FNR,"bind требует адрес/порт.")
        addr=token[2];sub(/@.*/,"",addr);port=addr;sub(/^.*:/,"",port)
        if(port!~/^[0-9]+$/ || port+0<1 || port+0>65535)report("E",FNR,"Порт bind должен быть 1–65535.")
        for(i=3;i<=n;i++) {
            if(token[i]~/^--?(group|g)=/) {target=token[i];sub(/^[^=]*=/,"",target)}
            else if(token[i]=="-group" || token[i]=="--group" || token[i]=="-g") {i++;if(value(i,n))target=token[i]}
            else if(token[i]~/^-g.+/) target=substr(token[i],3)
        }
        refs[++refcount]=target;refline[refcount]=FNR
    }
    if(cmd=="domain-set") {
        name="";file=""
        for(i=2;i<=n;i++) {
            opt=token[i];inline=0;val=""
            if(index(opt,"=")) {val=substr(opt,index(opt,"=")+1);sub(/=.*/,"",opt);inline=1}
            if(!inline && opt~/^-[nft].+/ && opt!~/^-(name|file|type)$/) {val=substr(opt,3);opt=substr(opt,1,2);inline=1}
            if(opt~/^--?(name|n|file|f|type|t)$/) {
                if(!inline) {i++;if(!value(i,n))continue;val=token[i]}
                if(opt~/^--?(name|n)$/)name=val
                if(opt~/^--?(file|f)$/)file=val
                if(opt~/^--?(type|t)$/ && val!~/^(list|geosite)$/)report("E",FNR,"Тип domain-set должен быть list или geosite.")
            } else report("W",FNR,"Форма параметра domain-set не проверена: " opt)
        }
        if(name=="" || file=="")report("E",FNR,"domain-set требует -name и -file.")
        else {sets[name]=1;print "FILE\t" FNR "\t" file}
    }
    if(cmd=="nameserver") {
        if(n!=2)report("E",FNR,"nameserver требует правило /домен/группа.")
        count=split(token[2],route,"/");group=route[count];if(group=="")group=route[count-1]
        if(group!="-" && group!="#" && group!="") {refs[++refcount]=group;refline[refcount]=FNR}
        for(j=1;j<=count;j++)if(route[j]~/^domain-set:/){name=route[j];sub(/^domain-set:/,"",name);usedset[++setcount]=name;setline[setcount]=FNR}
    }
}
END {
    if(!preflight) {
    if(binds==0 && !external && !complex) {
        refs[++refcount]="default";refline[refcount]=0
        report("W",0,strict ? "Явный bind не указан: SmartDNS 46.1 добавит UDP [::]:53. Проверьте нужные адреса и протоколы." : "Явный bind не указан; поведение слушателя этой версии нужно проверить.")
    }
    if(!complex && !external) {
        for(i=1;i<=refcount;i++)if(!(refs[i] in members)) {
            if(refs[i]=="default" && configured==0)report("W",refline[i],"Upstream не указан: SmartDNS может использовать системный resolv.conf; это не проверено.")
            else report("E",refline[i],"Группа " refs[i] " не содержит активных поддерживаемых upstream.")
        }
        for(i=1;i<=setcount;i++)if(!(usedset[i] in sets))report("E",setline[i],"Не объявлен domain-set: " usedset[i])
    }
    if(configured>0 && servers==0 && !external)report("E",0,"Не осталось ни одного поддерживаемого upstream.")
    exit(errors?1:0)
    }
}
