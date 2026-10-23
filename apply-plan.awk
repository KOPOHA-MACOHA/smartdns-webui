# Shared tokenizer from validator.awk, static record/END actions disabled.
preflight {
    line=$0;sub(/\r$/,"",line);if(line~/^[ \t]*(#|$)/)next
    n=tokenize(line,token);if(n<=0)next
    if(token[1]~/^bind/) {
        if((token[1]!="bind" && token[1]!="bind-tcp") || n!=2 || token[2]!~/^(:53|0\.0\.0\.0:53|127\.0\.0\.1:53|\[::\]:53|\[::1\]:53)$/) {
            report("E",FNR,"Безопасное применение пока поддерживает только обычные bind/bind-tcp на :53 без параметров.");next
        }
        if(token[1]=="bind-tcp")print "TCP\texample.org\tA" > output
        if(token[2]~/^\[/)print (token[1]=="bind-tcp"?"TCP6":"UDP6") "\texample.org\tA" > output
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
END {if(errors)exit 1}
