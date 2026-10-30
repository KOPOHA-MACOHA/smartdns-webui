# Shared lexer from validator.awk; normalize formatting without executing config.
preflight {
    line=$0;sub(/\r$/,"",line);if(line~/^[ \t]*(#|$)/)next
    n=tokenize(line,token);if(n<=0)next
    meaning_encoded="";for(i=1;i<=n;i++)meaning_encoded=meaning_encoded length(token[i]) ":" token[i]
    meaning_rows[++meaning_count]=meaning_encoded;cmd=token[1]
    # Only ordinary, literal HTTPS blocking rules commute with these DNS options.
    if(cmd=="https-record") {
        if(n==2 && token[2]~/^\/[A-Za-z0-9][A-Za-z0-9_.-]*\/#$/)meaning_https[meaning_count]=1
        else meaning_unsafe=1
    }
    if(cmd~/^(conf-file|group-begin|group-end|group-match|client-rules)$/)meaning_unsafe=1
    if(cmd=="log-level" && n==2)meaning_logging[meaning_count]=1
    if(cmd~/^server(-tcp|-tls|-https)?$/ && n>=2)meaning_servers[meaning_count]=1
    if(cmd=="domain-rules")for(i=3;i<=n;i++) {
        if(token[i]=="-no-serve-expired")continue
        if(token[i]~/^-(nameserver|response-mode|speed-check-mode)$/ && i<n) {i++;continue}
        meaning_unsafe=1
    }
}
END {
    if(errors)exit 1
    meaning_sequence=0
    for(i=1;i<=meaning_count;i++) {
        if(!meaning_unsafe && meaning_https[i])print "H:" meaning_rows[i]
        else if(!meaning_unsafe && meaning_servers[i])printf "S%08d:%s\n",++meaning_serversequence,meaning_rows[i]
        else if(!meaning_unsafe && meaning_logging[i])printf "L%08d:%s\n",++meaning_logsequence,meaning_rows[i]
        else printf "O%08d:%s\n",++meaning_sequence,meaning_rows[i]
    }
}
