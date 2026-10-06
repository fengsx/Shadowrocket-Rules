#!/usr/bin/env python3
# 在上游合并结果上重新应用 fengsx 的确定性定制。
from __future__ import annotations
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / 'Shadowrocket.conf'
FORK_RAW = 'https://raw.githubusercontent.com/fengsx/Shadowrocket-Rules/refs/heads/main'
UPDATE_URL = f'{FORK_RAW}/Shadowrocket.conf'
LEGACY_FORK_RAW = 'https://raw.githubusercontent.com/fengsx/Shadowrocket-Rules/main'
UPSTREAM_RAW = 'https://raw.githubusercontent.com/LingJingMaster/Shadowrocket-Rules/refs/heads/main'
UK_GROUP = '🇬🇧 英国节点 = url-test,url=http://www.gstatic.com/generate_204,interval=600,tolerance=0,timeout=5,policy-regex-filter=🇬🇧|英国|UK|London|LHR'
KR_GROUP = '🇰🇷 韩国节点 = url-test,url=http://www.gstatic.com/generate_204,interval=600,tolerance=0,timeout=5,policy-regex-filter=🇰🇷|韩国|KR|Korea|ICN|SEL'
OTHER_GROUP = '🌐 其他节点 = url-test,url=http://www.gstatic.com/generate_204,interval=600,tolerance=0,timeout=5,policy-regex-filter=^(?!.*(?:剩余流量|距离下次重置|套餐到期|官网|节点版本|客户端很旧))((?!(🇭🇰|HK|Hong|hong|香港|深港|沪港|京港|港|🇹🇼|TW|TWN|Taiwan|Taipei|taiwan|台湾|台灣|台北|台中|新北|彰化|🇯🇵|JP|Japan|japan|Tokyo|tokyo|日本|东京|大阪|🇺🇸|US|USA|America|america|United States|美国|凤凰城|洛杉矶|西雅图|芝加哥|纽约|沪美|美|🇬🇧|英国|UK|London|LHR|🇰🇷|韩国|KR|Korea|ICN|SEL)).)*$'
US_RESIDENTIAL_GROUP = '🇺🇸 美国住宅 = url-test,url=https://chatgpt.com/cdn-cgi/trace,interval=300,tolerance=0,timeout=5,policy-regex-filter=(?=.*(?:🇺🇸|US|USA|America|United States|美国|凤凰城|洛杉矶|西雅图|芝加哥|纽约))(?=.*(?:家宽|住宅|resident|Resident|RESIDENT|residential|Residential|RESIDENTIAL|home[ _-]*broadband|Home[ _-]*Broadband|HOME[ _-]*BROADBAND))'
UK_RESIDENTIAL_GROUP = '🇬🇧 英国住宅 = url-test,url=http://www.gstatic.com/generate_204,interval=600,tolerance=0,timeout=5,policy-regex-filter=(?=.*(?:🇬🇧|英国|UK|London|LHR))(?=.*(?:家宽|住宅|resident|Resident|RESIDENT|residential|Residential|RESIDENTIAL|home[ _-]*broadband|Home[ _-]*Broadband|HOME[ _-]*BROADBAND))'
US_REGULAR_GROUP = '🇺🇸 美国普通 = url-test,url=https://chatgpt.com/cdn-cgi/trace,interval=300,tolerance=0,timeout=5,policy-regex-filter=^(?=.*(?:🇺🇸|US|USA|America|United States|美国|凤凰城|洛杉矶|西雅图|芝加哥|纽约))(?!.*(?:家宽|住宅|resident|Resident|RESIDENT|residential|Residential|RESIDENTIAL|home[ _-]*broadband|Home[ _-]*Broadband|HOME[ _-]*BROADBAND)).*$'
UK_REGULAR_GROUP = '🇬🇧 英国普通 = url-test,url=http://www.gstatic.com/generate_204,interval=600,tolerance=0,timeout=5,policy-regex-filter=^(?=.*(?:🇬🇧|英国|UK|London|LHR))(?!.*(?:家宽|住宅|resident|Resident|RESIDENT|residential|Residential|RESIDENTIAL|home[ _-]*broadband|Home[ _-]*Broadband|HOME[ _-]*BROADBAND)).*$'
AI_GROUP = '🤖 AI 服务 = fallback,🇺🇸 美国住宅,🇺🇸 美国普通,REJECT,url=https://chatgpt.com/cdn-cgi/trace,interval=300,timeout=5'
US_FINANCE_GROUP = '💵 美国金融 = fallback,🇺🇸 美国住宅,🇺🇸 美国普通,REJECT,url=http://www.gstatic.com/generate_204,interval=300,timeout=5'
UK_FINANCE_GROUP = '💷 英国金融 = fallback,🇬🇧 英国普通,REJECT,url=http://www.gstatic.com/generate_204,interval=300,timeout=5'
WLOC_GROUP = '📍 WLOC 定位 = select,DIRECT,🚀 节点选择,PROXY,REJECT,policy-select-name=DIRECT'
DNS_GROUP = '🧱 DNS 防泄露 = select,REJECT,🚀 节点选择,DIRECT,policy-select-name=REJECT'
HOME_BROADBAND_GROUP = '🏠 家宽节点 = url-test,url=http://www.gstatic.com/generate_204,interval=600,tolerance=80,timeout=5,policy-regex-filter=家宽|住宅|resident|Resident|RESIDENT|residential|Residential|RESIDENTIAL|home[ _-]*broadband|Home[ _-]*Broadband|HOME[ _-]*BROADBAND'
ACADEMIC_GROUP = '📚 学术网站 = select,🏠 家宽节点,🇭🇰 香港节点,🇺🇸 美国住宅,🇯🇵 日本节点,🇰🇷 韩国节点,DIRECT,REJECT,policy-select-name=🏠 家宽节点'
GENERAL_SETTINGS = {
    'dns-server': 'https://cloudflare-dns.com/dns-query#proxy',
    'fallback-dns-server': 'https://dns.google/dns-query#proxy',
    'proxy-dns-server': 'https://dns.alidns.com/dns-query',
    'ipv6': 'false',
    'prefer-ipv6': 'false',
    'dns-fallback-system': 'false',
    'dns-direct-system': 'true',
    'dns-direct-fallback-proxy': 'false',
    'hijack-dns': '8.8.8.8:53,8.8.4.4:53,1.1.1.1:53,1.0.0.1:53,9.9.9.9:53,208.67.222.222:53,208.67.220.220:53,223.5.5.5:53,223.6.6.6:53,119.29.29.29:53,114.114.114.114:53',
    'block-quic': 'all-proxy',
}
PERSONAL_BLOCK = f'''# CODEX-BEGIN PERSONAL POLICIES
DOMAIN-SUFFIX,mdpi.com,📚 学术网站
DOMAIN-SUFFIX,mdpi-res.com,📚 学术网站
DOMAIN-SUFFIX,preprints.org,📚 学术网站
DOMAIN-SUFFIX,sciprofiles.com,📚 学术网站
DOMAIN-SUFFIX,scilit.com,📚 学术网站
DOMAIN-SUFFIX,ethenapay-api.co,🇭🇰 香港节点
DOMAIN-SUFFIX,ethenapay.co,🇭🇰 香港节点
DOMAIN,pay.ethena.fi,🇭🇰 香港节点
RULE-SET,{FORK_RAW}/US-Apps.list,💵 美国金融
RULE-SET,{FORK_RAW}/UK-Finance.list,💷 英国金融
DOMAIN,wloc.qor.com.cn,DIRECT
DOMAIN-SUFFIX,fengsx.workers.dev,DIRECT
# 蜜雪冰城小程序及静态资源明确使用国内直连，避免依赖 GEOIP 兜底。
DOMAIN-SUFFIX,mxbc.net,🔒 国内服务
DOMAIN,gs-loc.apple.com,DIRECT
DOMAIN,gs-loc-cn.apple.com,DIRECT
DOMAIN,gsp-ssl.ls.apple.com,DIRECT
DOMAIN,bluedot.is.autonavi.com,DIRECT
DOMAIN,bluedot.is.autonavi.com.gds.alibabadns.com,DIRECT

# 国内 App 的 HTTPDNS 兼容例外必须位于通用拦截规则之前。
DOMAIN,dns.jd.com,DIRECT
DOMAIN,dns.weibo.cn,DIRECT
DOMAIN,dns.weixin.qq.com,DIRECT
DOMAIN,dns.weixin.qq.com.cn,DIRECT
DOMAIN,httpdns-api.aliyuncs.com,DIRECT
DOMAIN,httpdns-sc.aliyuncs.com,DIRECT
DOMAIN,httpdns.alicdn.com,DIRECT
DOMAIN,httpdns.bilivideo.com,DIRECT
DOMAIN,httpdns.c.cdnhwc2.com,DIRECT
DOMAIN,httpdns.meituan.com,DIRECT
DOMAIN,httpdns.music.163.com,DIRECT
DOMAIN,httpdns.n.netease.com,DIRECT
DOMAIN,httpdns.push.oppomobile.com,DIRECT
DOMAIN,httpdns.volcengineapi.com,DIRECT
DOMAIN,httpdns.yunxindns.com,DIRECT
DOMAIN,lofter.httpdns.c.163.com,DIRECT
DOMAIN,music.httpdns.c.163.com,DIRECT
DOMAIN-SUFFIX,httpdns.baidu.com,DIRECT
DOMAIN-SUFFIX,httpdns.baidubce.com,DIRECT
DOMAIN-SUFFIX,httpsdns.baidu.com,DIRECT
RULE-SET,https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Shadowrocket/BlockHttpDNS/BlockHttpDNS.list,🧱 DNS 防泄露
# CODEX-END PERSONAL POLICIES'''
SCRIPT_BLOCK = '''# CODEX-BEGIN WLOC
Apple WLOC = type=http-response,pattern=^https?:\\/\\/(?:gs-loc(?:-cn)?\\.apple\\.com|gsp-ssl\\.ls\\.apple\\.com|bluedot\\.is\\.autonavi\\.com(?:\\.gds\\.alibabadns\\.com)?)\\/clls\\/wloc,requires-body=1,binary-body-mode=1,max-size=0,timeout=30,script-path=https://raw.githubusercontent.com/fengsx/wloc/refs/heads/main/dist/wloc.js,argument=longitude=113.94114&latitude=22.544577&accuracy=25&randomRadius=0&logLevel=info
WLOC Settings = type=http-request,pattern=^https?:\\/\\/gs-loc(-cn)?\\.apple\\.com\\/wloc-settings\\/save,requires-body=0,max-size=0,timeout=10,script-path=https://raw.githubusercontent.com/fengsx/wloc/refs/heads/main/dist/wloc-settings.js
# CODEX-END WLOC'''
WLOC_HOSTS = ['gs-loc.apple.com', 'gs-loc-cn.apple.com', 'gsp-ssl.ls.apple.com', 'bluedot.is.autonavi.com', 'bluedot.is.autonavi.com.gds.alibabadns.com']

def replace_managed(text: str, begin: str, end: str, block: str, anchor: str) -> str:
    pattern = re.compile(re.escape(begin) + r'.*?' + re.escape(end), re.DOTALL)
    if pattern.search(text):
        return pattern.sub(block, text, count=1)
    if anchor not in text:
        raise RuntimeError(f'缺少插入锚点：{anchor}')
    return text.replace(anchor, anchor + block + '\n\n', 1)

def ensure_group_line(text: str, prefix: str, line: str, anchor_prefix: str) -> str:
    pattern = re.compile(rf'(?m)^{re.escape(prefix)}.*$')
    if pattern.search(text):
        return pattern.sub(line, text, count=1)
    anchor = re.search(rf'(?m)^{re.escape(anchor_prefix)}.*$', text)
    if not anchor:
        raise RuntimeError(f'缺少策略组锚点：{anchor_prefix}')
    return text[:anchor.end()] + '\n' + line + text[anchor.end():]

def ensure_general_setting(text: str, key: str, value: str) -> str:
    line = f'{key} = {value}'
    pattern = re.compile(rf'(?m)^{re.escape(key)}\s*=.*$')
    if pattern.search(text):
        return pattern.sub(line, text, count=1)
    if '[Proxy]' not in text:
        raise RuntimeError('缺少配置段：[Proxy]')
    return text.replace('[Proxy]', line + '\n\n[Proxy]', 1)

def main() -> None:
    text = CONFIG.read_text()
    if '[Proxy Group]' not in text or '[Rule]' not in text:
        raise RuntimeError('Shadowrocket 配置缺少必要段落')
    text = text.replace(UPSTREAM_RAW, FORK_RAW)
    text = text.replace(LEGACY_FORK_RAW, FORK_RAW)
    text = text.replace('https://sub.qor.com.cn/rules/', FORK_RAW + '/')
    text = re.sub(r'(?m)^update-url\s*=.*$', f'update-url = {UPDATE_URL}', text, count=1)
    for key, value in GENERAL_SETTINGS.items():
        text = ensure_general_setting(text, key, value)
    match = re.search(r'(?m)^🚀 节点选择\s*=.*$', text)
    if not match:
        raise RuntimeError('缺少主节点策略组')
    line = match.group(0)
    for name in ['🇬🇧 英国节点', '🇰🇷 韩国节点']:
        if name not in line:
            line = line.replace(',🌐 其他节点', f',{name},🌐 其他节点')
    text = text[:match.start()] + line + text[match.end():]
    text = ensure_group_line(text, '🇬🇧 英国节点 =', UK_GROUP, '🇺🇸 美国节点 =')
    text = ensure_group_line(text, '🇰🇷 韩国节点 =', KR_GROUP, '🇬🇧 英国节点 =')
    text = ensure_group_line(text, '🌐 其他节点 =', OTHER_GROUP, '🇰🇷 韩国节点 =')
    text = ensure_group_line(text, '🇺🇸 美国住宅 =', US_RESIDENTIAL_GROUP, '🇺🇸 美国节点 =')
    text = ensure_group_line(text, '🇬🇧 英国住宅 =', UK_RESIDENTIAL_GROUP, '🇬🇧 英国节点 =')
    text = ensure_group_line(text, '🇺🇸 美国普通 =', US_REGULAR_GROUP, '🇺🇸 美国住宅 =')
    text = ensure_group_line(text, '🇬🇧 英国普通 =', UK_REGULAR_GROUP, '🇬🇧 英国住宅 =')
    text = ensure_group_line(text, '📍 WLOC 定位 =', WLOC_GROUP, '🍏 苹果服务 =')
    text = ensure_group_line(text, '💵 美国金融 =', US_FINANCE_GROUP, '📈 券商服务 =')
    text = ensure_group_line(text, '💷 英国金融 =', UK_FINANCE_GROUP, '💵 美国金融 =')
    text = ensure_group_line(text, '🏠 家宽节点 =', HOME_BROADBAND_GROUP, '🌐 其他节点 =')
    text = ensure_group_line(text, '📚 学术网站 =', ACADEMIC_GROUP, '💷 英国金融 =')
    text = ensure_group_line(text, '🧱 DNS 防泄露 =', DNS_GROUP, '🌐 其他节点 =')
    text = ensure_group_line(text, '🤖 AI 服务 =', AI_GROUP, '🧱 DNS 防泄露 =')
    text = re.sub(r'(?m)^RULE-SET,https://raw\.githubusercontent\.com/blackmatrix7/ios_rule_script/master/rule/Shadowrocket/BlockHttpDNS/BlockHttpDNS\.list,.*\n?', '', text)
    text = replace_managed(text, '# CODEX-BEGIN PERSONAL POLICIES', '# CODEX-END PERSONAL POLICIES', PERSONAL_BLOCK, '[Rule]\n')
    if '[Script]' not in text:
        if '[Host]' not in text:
            raise RuntimeError('缺少 [Host]，无法插入 WLOC Script')
        text = text.replace('[Host]', '[Script]\n' + SCRIPT_BLOCK + '\n\n[Host]', 1)
    else:
        text = replace_managed(text, '# CODEX-BEGIN WLOC', '# CODEX-END WLOC', SCRIPT_BLOCK, '[Script]\n')
    mitm = re.search(r'(?m)^hostname\s*=\s*(.*)$', text)
    if not mitm:
        raise RuntimeError('缺少 MITM hostname')
    hosts = [item.strip() for item in mitm.group(1).split(',') if item.strip()]
    for host in WLOC_HOSTS:
        if host not in hosts:
            hosts.append(host)
    text = text[:mitm.start()] + 'hostname = ' + ', '.join(hosts) + text[mitm.end():]
    CONFIG.write_text(text)

if __name__ == '__main__':
    main()
