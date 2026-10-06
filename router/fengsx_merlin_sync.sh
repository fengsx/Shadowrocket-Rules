#!/bin/sh
# FENGSX-MERLIN-SYNC-V1
# 为 Magic Catling 2 安装并同步 fengsx 规则模板，生成已知节点端点直连规则。

PATH=/koolshare/bin:/usr/sbin:/usr/bin:/sbin:/bin
RAW_BASE=https://raw.githubusercontent.com/fengsx/Shadowrocket-Rules/refs/heads/main
SELF=/jffs/scripts/fengsx-merlin-sync
TEMPLATE=/koolshare/merlinclash/rule_configs/rule_mc_custom.yaml
ENDPOINTS=/koolshare/merlinclash/rule_custom/fengsx_node_endpoints.yaml
WEB=/koolshare/webs/Module_merlinclash.asp
YQ=/koolshare/bin/yq
LOG=/tmp/fengsx_merlin_sync.log

log() {
    logger -t fengsx-merlin "$*"
    printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"
}

curl_with_bootstrap() {
    url="$1"
    target="$2"
    user_agent="${3:-fengsx-merlin-sync}"
    host=$(printf '%s' "$url" | sed -n 's#^https://\([^/]*\)/.*#\1#p')
    [ -n "$host" ] || return 1
    for ip in $(nslookup "$host" 223.5.5.5 2>/dev/null | awk '/^Name:/ { found=1; next } found && $3 ~ /^[0-9]+\./ { print $3 }'); do
        curl -fsSL -A "$user_agent" --resolve "$host:443:$ip" --connect-timeout 8 --max-time 45 "$url" -o "$target" 2>/dev/null && return 0
    done
    return 1
}

materialize_miki_provider() {
    current=$(dbus get merlinclash_set_yamlsel_start)
    case "$current" in MCU_*) ;; *) return 0 ;; esac
    backup=/koolshare/merlinclash/yaml_bak/${current}.yaml
    active=/koolshare/merlinclash/yaml_use/${current}.yaml
    provider_dir=/koolshare/merlinclash/yaml_bak/${current}
    provider=${provider_dir}/AP1.yaml
    encoded=$(dbus get merlinclash_sub_links)
    url=$(printf '%s' "$encoded" | base64 -d 2>/dev/null | cut -d'|' -f1)
    case "$url" in https://sub.mikicloud.xyz/*) ;; *) return 0 ;; esac
    tmp=/tmp/fengsx_miki_provider.$$
    if ! curl -fsSL -A clash.meta --connect-timeout 8 --max-time 60 "$url" -o "$tmp" 2>/dev/null && \
       ! curl_with_bootstrap "$url" "$tmp" clash.meta; then
        rm -f "$tmp"
        log 'MIKI 节点下载失败，保留现有本地缓存'
        return 1
    fi
    count=$("$YQ" eval '.proxies | length' "$tmp" 2>/dev/null)
    case "$count" in ''|0|null) rm -f "$tmp"; log 'MIKI 节点校验失败，保留现有本地缓存'; return 1 ;; esac
    mkdir -p "$provider_dir"
    mv -f "$tmp" "$provider"
    chmod 0666 "$provider"
    for config in "$backup" "$active"; do
        [ -f "$config" ] || continue
        "$YQ" eval -i '."proxy-providers".AP1.type = "file" |
          ."proxy-providers".AP1.path = "./yaml_bak/'"$current"'/AP1.yaml" |
          del(."proxy-providers".AP1.url, ."proxy-providers".AP1.interval,
              ."proxy-providers".AP1.proxy, ."proxy-providers".AP1.header)' "$config"
    done
    log "MIKI 节点已固化为本地提供器：${count} 个"
}


patch_dynamic_finance_groups() {
    current=$(dbus get merlinclash_set_yamlsel_start)
    provider=/koolshare/merlinclash/yaml_bak/$current/AP1.yaml
    [ -f "$provider" ] || return 0
    finance_changed=0
    if "$YQ" eval '.proxies[]?.name' "$provider" 2>/dev/null | grep -Eiq '(英国|UK|London|LHR).*(家宽|住宅|resident|residential|home[ _-]*broadband)|(家宽|住宅|resident|residential|home[ _-]*broadband).*(英国|UK|London|LHR)'; then
        desired='["🇬🇧 英国住宅", "🇬🇧 英国普通", "REJECT"]'
        desired_csv='🇬🇧 英国住宅,🇬🇧 英国普通,REJECT'
    else
        desired='["🇬🇧 英国普通", "REJECT"]'
        desired_csv='🇬🇧 英国普通,REJECT'
    fi
    for config in /koolshare/merlinclash/yaml_bak/$current.yaml /koolshare/merlinclash/yaml_use/$current.yaml; do
        [ -f "$config" ] || continue
        actual=$("$YQ" eval '."proxy-groups"[] | select(.name == "💷 英国金融") | .proxies[]' "$config" 2>/dev/null | tr '\n' ',' | sed 's/,$//')
        [ "$actual" = "$desired_csv" ] && continue
        "$YQ" eval -i '(."proxy-groups"[] | select(.name == "💷 英国金融").proxies) = '"$desired" "$config"
        finance_changed=1
    done
}

download() {
    url="$1"
    target="$2"
    if curl -fsSL --connect-timeout 8 --max-time 45 "$url" -o "$target" 2>/dev/null || \
       curl_with_bootstrap "$url" "$target"; then
        return 0
    fi
    log 'GitHub Raw 下载失败，保留已验证的本地版本'
    return 1
}
refresh_self() {
    tmp=/tmp/fengsx_merlin_self.$$
    if download "$RAW_BASE/router/fengsx_merlin_sync.sh?ts=$(date +%s)" "$tmp" && \
       grep -q 'FENGSX-MERLIN-SYNC-V1' "$tmp"; then
        chmod 0755 "$tmp"
        if ! cmp -s "$tmp" "$SELF"; then
            mv -f "$tmp" "$SELF"
            log '同步脚本已更新'
            exec "$SELF" updated
        fi
    fi
    rm -f "$tmp"
}

install_template() {
    tmp=/tmp/fengsx_merlin_template.$$
    template_changed=0
    if download "$RAW_BASE/dist/merlinclash-fengsx.yaml?ts=$(date +%s)" "$tmp" && \
       grep -q 'FENGSX-MERLIN-TEMPLATE-V2' "$tmp" && \
       "$YQ" eval '.' "$tmp" >/dev/null 2>&1; then
        if ! cmp -s "$tmp" "$TEMPLATE"; then
            mkdir -p "$(dirname "$TEMPLATE")"
            mv -f "$tmp" "$TEMPLATE"
            chmod 0644 "$TEMPLATE"
            template_changed=1
            log '规则模板已更新'
        fi
    else
        log '规则模板下载或校验失败，保留现有版本'
    fi
    rm -f "$tmp"
}

patch_dns_compatibility() {
    dns=/koolshare/merlinclash/yaml_dns/redirhost.yaml
    [ -f "$dns" ] || return 0
    if "$YQ" eval '.dns."nameserver-policy"."rule-set:AI" // ""' "$dns" 2>/dev/null | grep -q .; then
        [ -f "$dns.fengsx-backup" ] || cp -p "$dns" "$dns.fengsx-backup"
        "$YQ" eval 'del(.dns."nameserver-policy"."rule-set:AI", .dns."nameserver-policy"."rule-set:Crypto", .dns."nameserver-policy"."rule-set:Proxy")' -i "$dns"
        log '已移除与 FENGSX 规则不兼容的旧 DNS rule-set 引用'
    fi
    "$YQ" eval '.dns."nameserver-policy"."+.mxbc.net" = ["119.29.29.29", "223.5.5.5"] | .dns."nameserver-policy"."+.jsdmirror.com" = ["223.5.5.5", "119.29.29.29"] | .dns."nameserver-policy"."+.githubproxy.cc" = ["223.5.5.5", "119.29.29.29"] | .dns."nameserver-policy"."+.jsdelivr.net" = ["223.5.5.5", "119.29.29.29"] | .dns."nameserver-policy"."+.githubusercontent.com" = ["223.5.5.5", "119.29.29.29"]' -i "$dns"
    log '已设置规则下载域名的直连 DNS 引导'
}

ensure_lan_dns_hijack() {
    if ! iptables -t nat -C PREROUTING -i br0 -p tcp --dport 53 -j REDIRECT --to-ports 53 >/dev/null 2>&1; then
        iptables -t nat -I PREROUTING 1 -i br0 -p tcp --dport 53 -j REDIRECT --to-ports 53
        log '已启用局域网 TCP 53 DNS 劫持'
    fi
}

ensure_firewall_hook() {
    hook=/jffs/scripts/firewall-start
    touch "$hook"
    if ! grep -q 'FENGSX-DNS-HIJACK-BEGIN' "$hook" 2>/dev/null; then
        {
            printf '\n# FENGSX-DNS-HIJACK-BEGIN\n'
            printf '/jffs/scripts/fengsx-merlin-sync dns-hijack >/tmp/fengsx_dns_hijack.log 2>&1\n'
            printf '# FENGSX-DNS-HIJACK-END\n'
        } >> "$hook"
    fi
    chmod 0755 "$hook"
}
patch_web() {
    [ -f "$WEB" ] || return 0
    grep -q 'value="MCrule_Custom"' "$WEB" && return 0
    tmp=/tmp/Module_merlinclash.$$
    sed '/<option value="APrule">/i\
                                                                            <option value="MCrule_Custom">FENGSX规则</option>' "$WEB" > "$tmp"
    if grep -q 'value="MCrule_Custom"' "$tmp"; then
        cp -p "$WEB" "$WEB.fengsx-backup" 2>/dev/null || true
        mv -f "$tmp" "$WEB"
        chmod 0777 "$WEB"
        log '已恢复 FENGSX 订阅规则入口'
    else
        rm -f "$tmp"
        log '未能修补 Magic Catling 页面'
    fi
}

ensure_schedule() {
    cru d FENGSX_MERLIN_SYNC >/dev/null 2>&1
    cru a FENGSX_MERLIN_SYNC '17 */6 * * * /jffs/scripts/fengsx-merlin-sync cron' >/dev/null 2>&1
    if ! grep -q 'FENGSX-MERLIN-BEGIN' /jffs/scripts/services-start 2>/dev/null; then
        {
            printf '\n# FENGSX-MERLIN-BEGIN\n'
            printf '(sleep 90; /jffs/scripts/fengsx-merlin-sync boot >/tmp/fengsx_merlin_boot.log 2>&1) &\n'
            printf '# FENGSX-MERLIN-END\n'
        } >> /jffs/scripts/services-start
        chmod 0755 /jffs/scripts/services-start
    fi
}

ensure_endpoint_file() {
    mkdir -p "$(dirname "$ENDPOINTS")"
    if [ ! -s "$ENDPOINTS" ]; then
        printf 'payload: []\n' > "$ENDPOINTS"
        chmod 0644 "$ENDPOINTS"
    fi
}

collect_servers() {
    config="$1"
    output="$2"
    "$YQ" eval '.proxies[]?.server' "$config" 2>/dev/null >> "$output"
    "$YQ" eval '.proxy-providers[]?.path' "$config" 2>/dev/null | while IFS= read -r path; do
        [ -n "$path" ] || continue
        case "$path" in
            /*) provider="$path" ;;
            ./*) provider="/koolshare/merlinclash/${path#./}" ;;
            *) provider="/koolshare/merlinclash/$path" ;;
        esac
        [ -f "$provider" ] && "$YQ" eval '.proxies[]?.server' "$provider" 2>/dev/null >> "$output"
    done
}

sync_endpoints() {
    current=$(dbus get merlinclash_set_yamlsel_start)
    config=/koolshare/merlinclash/yaml_use/${current}.yaml
    [ -f "$config" ] || return 0
    servers=/tmp/fengsx_merlin_servers.$$
    rules=/tmp/fengsx_merlin_rules.$$
    output=/tmp/fengsx_merlin_endpoints.$$
    : > "$servers"
    : > "$rules"
    collect_servers "$config" "$servers"
    printf '%s\n' vpn.qor.com.cn cf.qor.com.cn >> "$servers"
    sort -u "$servers" | while IFS= read -r server; do
        server=$(printf '%s' "$server" | tr -d '[]\r')
        [ -n "$server" ] || continue
        case "$server" in
            *[!0-9.]*:*) printf 'IP-CIDR6,%s/128,no-resolve\n' "$server" >> "$rules" ;;
            *[!0-9.]* )
                printf 'DOMAIN,%s\n' "$server" >> "$rules"
                for resolver in system 223.5.5.5; do
                    if [ "$resolver" = system ]; then
                        nslookup "$server" 2>/dev/null
                    else
                        nslookup "$server" "$resolver" 2>/dev/null
                    fi
                done | awk '/^Name:/{found=1;next} found && /^Address [0-9]+:/{print $3}' | sort -u | while IFS= read -r address; do
                    case "$address" in
                        *:*) printf 'IP-CIDR6,%s/128,no-resolve\n' "$address" >> "$rules" ;;
                        *.*) printf 'IP-CIDR,%s/32,no-resolve\n' "$address" >> "$rules" ;;
                    esac
                done
                ;;
            *.*) printf 'IP-CIDR,%s/32,no-resolve\n' "$server" >> "$rules" ;;
        esac
    done
    {
        printf '# 自动生成：Shadowrocket/SOCKS5 已知节点端点直连\n'
        printf 'payload:\n'
        sort -u "$rules" | sed 's/^/  - /'
    } > "$output"
    if "$YQ" eval '.' "$output" >/dev/null 2>&1 && ! cmp -s "$output" "$ENDPOINTS"; then
        mv -f "$output" "$ENDPOINTS"
        chmod 0644 "$ENDPOINTS"
        controller=$("$YQ" eval '.external-controller // ""' "$config" 2>/dev/null)
        secret=$("$YQ" eval '.secret // ""' "$config" 2>/dev/null)
        case "$controller" in http*) api="$controller" ;; *) api="http://$controller" ;; esac
        if [ -n "$controller" ]; then
            if [ -n "$secret" ]; then
                curl -fsS -X PUT -H "Authorization: Bearer $secret" "$api/providers/rules/FENGSX-NodeEndpoints" >/dev/null 2>&1 || true
            else
                curl -fsS -X PUT "$api/providers/rules/FENGSX-NodeEndpoints" >/dev/null 2>&1 || true
            fi
        fi
        log "已更新节点端点直连表：$(grep -c '^  - ' "$ENDPOINTS") 条"
    fi
    rm -f "$servers" "$rules" "$output"
}

rebuild_active_custom_config() {
    current=$(dbus get merlinclash_set_yamlsel_start)
    case "$current" in MCU_*) ;; *) return 0 ;; esac
    if [ "$template_changed" = 1 ]; then
        /bin/sh /koolshare/scripts/clash_subscribe.sh 0 subscribe >/dev/null 2>&1 || return 1
        materialize_miki_provider || return 1
        patch_dynamic_finance_groups
        /bin/sh /koolshare/scripts/clash_config.sh restart restart >/dev/null 2>&1 || return 1
        log '已用新模板重建并重载当前配置'
    else
        materialize_miki_provider || return 1
        patch_dynamic_finance_groups
        if [ "$finance_changed" = 1 ]; then
            /bin/sh /koolshare/scripts/clash_config.sh restart restart >/dev/null 2>&1 || return 1
            log '英国金融节点候选已变化，已重载当前配置'
            return 0
        fi
        config=/koolshare/merlinclash/yaml_use/$current.yaml
        controller=$("$YQ" eval '.external-controller // ""' "$config" 2>/dev/null)
        secret=$("$YQ" eval '.secret // ""' "$config" 2>/dev/null)
        case "$controller" in http*) api="$controller" ;; *) api="http://$controller" ;; esac
        if [ -n "$controller" ]; then
            if [ -n "$secret" ]; then
                curl -fsS -X PUT -H "Authorization: Bearer $secret" "$api/providers/proxies/AP1" >/dev/null 2>&1 || true
            else
                curl -fsS -X PUT "$api/providers/proxies/AP1" >/dev/null 2>&1 || true
            fi
        fi
    fi
}

main() {
    if [ "$1" = dns-hijack ]; then
        ensure_lan_dns_hijack
        exit 0
    fi
    : > "$LOG"
    [ "$1" = updated ] || refresh_self
    if ! grep -q 'MCrule_Custom)' /koolshare/scripts/clash_subscribe.sh 2>/dev/null; then
        log '当前 Magic Catling 不支持 MCrule_Custom，已停止安装'
        exit 1
    fi
    ensure_endpoint_file
    install_template
    patch_dns_compatibility
    ensure_lan_dns_hijack
    ensure_firewall_hook
    patch_web
    ensure_schedule
    rebuild_active_custom_config
    sync_endpoints
    log '同步完成'
}

main "$@"
