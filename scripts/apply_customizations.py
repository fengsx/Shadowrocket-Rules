#!/usr/bin/env python3
# 在上游合并结果上重新应用 fengsx 的确定性定制。
from __future__ import annotations
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / 'Shadowrocket.conf'
FORK_RAW = 'https://raw.githubusercontent.com/fengsx/Shadowrocket-Rules/main'
UPSTREAM_RAW = 'https://raw.githubusercontent.com/LingJingMaster/Shadowrocket-Rules/refs/heads/main'
UK_GROUP = '🇬🇧 英国节点 = url-test,url=http://www.gstatic.com/generate_204,interval=600,tolerance=0,timeout=5,policy-regex-filter=🇬🇧|英国|UK|London|LHR'
KR_GROUP = '🇰🇷 韩国节点 = url-test,url=http://www.gstatic.com/generate_204,interval=600,tolerance=0,timeout=5,policy-regex-filter=🇰🇷|韩国|KR|Korea|ICN|SEL'
OTHER_GROUP = '🌐 其他节点 = url-test,url=http://www.gstatic.com/generate_204,interval=600,tolerance=0,timeout=5,policy-regex-filter=^((?!(🇭🇰|HK|Hong|hong|香港|深港|沪港|京港|港|🇹🇼|TW|TWN|Taiwan|Taipei|taiwan|台湾|台灣|台北|台中|新北|彰化|🇯🇵|JP|Japan|japan|Tokyo|tokyo|日本|东京|大阪|🇺🇸|US|USA|America|america|United States|美国|凤凰城|洛杉矶|西雅图|芝加哥|纽约|沪美|美|🇬🇧|英国|UK|London|LHR|🇰🇷|韩国|KR|Korea|ICN|SEL)).)*$'
US_RESIDENTIAL_GROUP = '🇺🇸 美国住宅 = url-test,url=http://www.gstatic.com/generate_204,interval=600,tolerance=0,timeout=5,policy-regex-filter=(?=.*(?:🇺🇸|US|USA|America|United States|美国|凤凰城|洛杉矶|西雅图|芝加哥|纽约))(?=.*(?:家宽|住宅|Residential|Home Broadband))'
UK_RESIDENTIAL_GROUP = '🇬🇧 英国住宅 = url-test,url=http://www.gstatic.com/generate_204,interval=600,tolerance=0,timeout=5,policy-regex-filter=(?=.*(?:🇬🇧|英国|UK|London|LHR))(?=.*(?:家宽|住宅|Residential|Home Broadband))'
US_FINANCE_GROUP = '💵 美国金融 = fallback,🇺🇸 美国住宅,🇺🇸 美国节点,REJECT,url=http://www.gstatic.com/generate_204,interval=300,timeout=5'
UK_FINANCE_GROUP = '💷 英国金融 = fallback,🇬🇧 英国住宅,🇬🇧 英国节点,REJECT,url=http://www.gstatic.com/generate_204,interval=300,timeout=5'
WLOC_GROUP = '📍 WLOC 定位 = select,DIRECT,🚀 节点选择,PROXY,REJECT,policy-select-name=DIRECT'
PERSONAL_BLOCK = f'''# CODEX-BEGIN PERSONAL POLICIES
RULE-SET,{FORK_RAW}/US-Apps.list,💵 美国金融
RULE-SET,{FORK_RAW}/UK-Finance.list,💷 英国金融
DOMAIN,wloc.qor.com.cn,DIRECT
DOMAIN-SUFFIX,fengsx.workers.dev,DIRECT
DOMAIN,gs-loc.apple.com,DIRECT
DOMAIN,gs-loc-cn.apple.com,DIRECT
DOMAIN,gsp-ssl.ls.apple.com,DIRECT
DOMAIN,bluedot.is.autonavi.com,DIRECT
DOMAIN,bluedot.is.autonavi.com.gds.alibabadns.com,DIRECT
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

def main() -> None:
    text = CONFIG.read_text()
    if '[Proxy Group]' not in text or '[Rule]' not in text:
        raise RuntimeError('Shadowrocket 配置缺少必要段落')
    text = text.replace(UPSTREAM_RAW, FORK_RAW)
    text = re.sub(r'(?m)^update-url\s*=.*$', f'update-url = {FORK_RAW}/Shadowrocket.conf', text, count=1)
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
    text = ensure_group_line(text, '📍 WLOC 定位 =', WLOC_GROUP, '🍏 苹果服务 =')
    text = ensure_group_line(text, '💵 美国金融 =', US_FINANCE_GROUP, '📈 券商服务 =')
    text = ensure_group_line(text, '💷 英国金融 =', UK_FINANCE_GROUP, '💵 美国金融 =')
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
