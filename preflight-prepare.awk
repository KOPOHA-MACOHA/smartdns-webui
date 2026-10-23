# Run after validator.awk: reuse its lexer/profile, never shell-evaluate config.
function quote(s) {gsub(/\\/,"\\\\",s);gsub(/"/,"\\\"",s);return "\"" s "\""}
function option(name,short,    j,v,t) {
    for(j=2;j<=n;j++) {
        if(token[j]!~/^-/)continue
        t=token[j];sub(/^--?/,"",t)
        if(t==name || t==short)return token[j+1]
        if(index(t,name "=")==1)return substr(t,length(name)+2)
        if(index(t,short "=")==1)return substr(t,length(short)+2)
        if(short!="" && token[j]~/^-[^-]/ && index(t,short)==1 && t!=name)return substr(t,length(short)+1)
    }
    return ""
}
function preflight_group(name) {
    if(name!="" && name!="-" && name!="#") {
        if(name!~/^[A-Za-z0-9_.-]+$/)report("E",FNR,"Эта форма имени группы пока не поддержана нативной проверкой.")
        else usedgroup[name]=1
    }
}
BEGIN {
    print "PROFILE\t" version "\tpreflight"
    if(version!="46.1") {report("E",0,"Безопасная проверка отдельным процессом пока доступна только для 46.1.");exit 1}
    split("server server-tcp server-tls server-https address cname srv-record https-record ddns-domain nameserver response-mode speed-check-mode rr-ttl rr-ttl-min rr-ttl-max rr-ttl-reply-max serve-expired-ttl serve-expired-reply-ttl serve-expired-prefetch-time dualstack-ip-selection dualstack-ip-selection-threshold dualstack-ip-allow-force-AAAA max-reply-ip-num force-AAAA-SOA force-no-CNAME force-qtype-SOA bogus-nxdomain ignore-ip whitelist-ip blacklist-ip ip-alias edns-client-subnet ca-file ca-path server-name local-ttl local-ptr-enable expand-ptr-from-address",names," ")
    for(i in names)allow[names[i]]=1
}
preflight {
    line=$0;sub(/\r$/,"",line)
    if(line ~ /^[ \t]*(#|$)/)next
    n=tokenize(line,token);if(n<=0)next
    cmd=token[1]
    if(cmd ~ /^bind(-tcp|-tls|-https)?$/) {
        name=option("group","g");if(name=="")name="default"
        preflight_group(name);if(primary=="")primary=name
        next
    }
    if(cmd ~ /^(cache-size|cache-mem-size|cache-file|cache-persist|cache-checkpoint-time|prefetch-domain|serve-expired|log-file|log-level|log-size|log-num|log-console|log-syslog|audit-enable|audit-file|audit-size|audit-num|audit-console|audit-syslog|audit-SOA|audit-log-SOA|debug-save-fail-packet|debug-save-fail-packet-dir|no-pidfile|no-daemon|restart-on-crash|max-query-limit)$/)next
    if(cmd ~ /^bind-cert-/)next
    if(cmd=="server-h3" || cmd=="server-quic")next
    if(cmd=="domain-set") {
        name=option("name","n");path=option("file","f");type=option("type","t");if(type=="")type="list"
        if(type!="list") {report("E",FNR,"Для нативной проверки пока поддерживаются только обычные списки domain-set.");next}
        if(name=="" || path=="" || path ~ /[\t\r\n*?\[]/) {report("E",FNR,"Нельзя безопасно скопировать этот domain-set для проверки.");next}
        if(name in listid){report("E",FNR,"Повторные domain-set требуют отдельной поддержки изолированной проверки.");next}
        id=++listcount;listid[name]=id
        print "LIST\t" id "\t" path > (work "/files")
        print "domain-set -name " quote(name) " -type list -file " quote(work "/list-" id) > (work "/sandbox.conf")
        next
    }
    if(!(cmd in allow)) {report("E",FNR,"Изолированная проверка недоступна для директивы " cmd ". Конфиг не меняется; небезопасные конструкции не выполняются.");next}
    if(cmd ~ /^server/) {
        for(i=3;i<=n;i++)if(token[i] ~ /^--?(p|proxy)(=|$)/ || token[i]~/^-p[^-]/)report("E",FNR,"Прокси-upstream пока не поддержан безопасной нативной проверкой.")
        addr=token[2];sub(/^[^:]+:\/\//,"",addr);sub(/\/.*/,"",addr);sub(/:[0-9]+$/,"",addr)
        if(addr~/^[0-9.]+$/ || addr ~ /:/ || option("host-ip","")!="")literal++
        upstreams++
    }
    if(cmd=="nameserver") {
        count=split(token[2],r,"/");name=r[count];if(name=="")name=r[count-1]
        if(name!="-" && name!="#") {
            preflight_group(name);routecount++;routegroup[routecount]=name
            if(count!=3) {report("E",FNR,"Сложная форма nameserver пока не поддержана нативной проверкой.");next}
            if(r[2]~/^domain-set:/) {set=r[2];sub(/^domain-set:/,"",set);routeset[routecount]=set}
            else if(r[2]~/^[A-Za-z0-9][A-Za-z0-9.-]*$/ && length(r[2])<=253)routedomain[routecount]=r[2]
            else report("E",FNR,"Для такого шаблона маршрута нельзя автоматически выбрать проверочный домен.")
        }
    }
    print line > (work "/sandbox.conf")
}
END {
    if(errors)exit 1
    if(!upstreams || !literal) {report("E",0,"Для независимой нативной проверки нужен явный upstream с IP или host-ip; системный DNS не подставляется.");exit 1}
    if(primary=="")primary="default"
    preflight_group(primary)
    if(routecount>8 || listcount>16) {report("E",0,"Слишком много маршрутов/списков для ограниченной проверки; конфиг не изменён.");exit 1}
    groups=0;for(name in usedgroup)groups++
    if(groups>8) {report("E",0,"Более 8 используемых групп: нужна отдельная ограниченная программа проверки.");exit 1}
    print "cache-size 64\ncache-mem-size 1048576\ncache-persist no\nprefetch-domain no\nserve-expired no\nlog-level info\nlog-size 64k\nlog-num 1\nlog-console no\nlog-syslog no\naudit-enable no\nno-daemon yes\nno-pidfile no\nrestart-on-crash no\ndebug-save-fail-packet no\nmax-query-limit 16" > (work "/sandbox.conf")
    print "cache-file " quote(work "/cache") > (work "/sandbox.conf")
    print "log-file " quote(work "/native.log") > (work "/sandbox.conf")
    print "audit-file " quote(work "/audit.log") > (work "/sandbox.conf")
    print "debug-save-fail-packet-dir " quote(work) > (work "/sandbox.conf")
    print "bind 127.0.0.1:16530 -no-cache" (primary=="default"?"":" -group " quote(primary)) > (work "/sandbox.conf")
    print "bind-tcp 127.0.0.1:16530 -no-cache" (primary=="default"?"":" -group " quote(primary)) > (work "/sandbox.conf")
    print "address /webui-preflight.invalid/192.0.2.123" > (work "/sandbox.conf")
    port=16530
    for(name in usedgroup) {
        port++
        print "bind 127.0.0.1:" port (name=="default"?"":" -group " quote(name)) " -no-rule-nameserver -no-rule-addr -no-cache" > (work "/sandbox.conf")
        sample="example.org";kind="DOMAIN"
        for(j=1;j<=routecount;j++)if(routegroup[j]==name) {
            if(routeset[j]!="") {sample=listid[routeset[j]];kind="LIST"}
            else sample=routedomain[j]
            break
        }
        print "GROUP\t" name "\t" port "\t" kind "\t" sample > (work "/probes")
    }
    for(j=1;j<=routecount;j++) {
        if(routeset[j]!="") {sample=listid[routeset[j]];kind="LIST"}else{sample=routedomain[j];kind="DOMAIN"}
        print "ROUTE\t" routegroup[j] "\t16530\t" kind "\t" sample > (work "/probes")
    }
    report("I",0,"Временная копия: только localhost, отдельные файлы, кэш 64 записи, без prefetch и сохранения кэша. Исходный конфиг не меняется.")
}
