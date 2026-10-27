# Shared tokenizer from validator.awk, static record/END actions disabled.
function listener(kind, endpoint,    host,port,a,n,i,total,compressed) {
    port=endpoint;sub(/^.*:/,"",port)
    if(port!~/^[0-9]+$/ || port+0<1 || port+0>65535)return 0
    host=endpoint;sub(/:[^:]*$/,"",host)
    if(host~/^\[/) {
        if(host!~/^\[[0-9A-Fa-f:]+\]$/)return 0
        host=substr(host,2,length(host)-2)
        compressed=index(host,"::")>0
        if(host~/:::/ || (host~/^:/ && host!~/^::/) || (host~/:$/ && host!~/::$/))return 0
        n=split(host,a,":");total=0
        for(i=1;i<=n;i++)if(a[i]!="") {if(length(a[i])>4)return 0;total++}
        a[1]=host;sub(/::/,"",a[1]);if(a[1]~/::/)return 0
        if((compressed && total>=8) || (!compressed && total!=8))return 0
        if(host=="::" || host=="0:0:0:0:0:0:0:0")host="::1"
    } else {
        if(host!="" && !ipv4(host))return 0
        if(host=="" || host=="0.0.0.0")host="127.0.0.1"
    }
    print "LISTEN\t" kind "\t" host "\t" (port+0) > output
    listeners++
    return 1
}
preflight {
    line=$0;sub(/\r$/,"",line);if(line~/^[ \t]*(#|$)/)next
    n=tokenize(line,token);if(n<=0)next
    if(token[1]~/^bind/) {
        if((token[1]!="bind" && token[1]!="bind-tcp") || n!=2 || !listener(token[1]=="bind-tcp"?"TCP":"UDP",token[2])) {
            report("E",FNR,"Для безопасного применения нужны bind/bind-tcp с IP-адресом и портом 1–65535 без дополнительных параметров.");next
        }
    }
    if(token[1]=="address") {
        count=split(token[2],parts,"/");ips=parts[count]
        if(ips=="#" || ips=="-" || ips=="#4" || ips=="#6")next
        if(ips!~/^[0-9.,]+$/ || count<3 || ++addresses>8) {report("E",FNR,"Эта ручная address-запись требует отдельного плана проверки применения.");next}
        for(i=2;i<count;i++) {
            if(parts[i]!~/^[A-Za-z0-9][A-Za-z0-9.-]*$/) {report("E",FNR,"Шаблон address пока не поддержан проверкой применения.");continue}
            print "ADDRESS\t" parts[i] "\t" ips > output
        }
    }
}
END {if(errors)exit 1; if(!listeners)listener("UDP","[::]:53")}
