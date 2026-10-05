#!/usr/bin/env python3
# 验证 Shadowrocket 配置引用、定制覆盖和可选的远程规则可用性。
from __future__ import annotations
import argparse
import re
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / 'Shadowrocket.conf'

def parse_sections(text: str) -> dict[str, list[tuple[int, str]]]:
    sections = {}
    current = None
    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if line.startswith('[') and line.endswith(']'):
            current = line[1:-1]
            sections[current] = []
        elif current and line and not line.startswith('#'):
            sections[current].append((number, line))
    return sections

def check_online(url: str) -> None:
    if url.startswith('https://sub.qor.com.cn/rules/'):
        return
    last_error = None
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, method='HEAD', headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(request, timeout=20) as response:
                if response.status == 200:
                    return
                last_error = RuntimeError(f'HTTP {response.status}')
        except Exception as exc:
            last_error = exc
        time.sleep(attempt + 1)
    raise RuntimeError(f'远程规则不可用：{url}: {last_error}')

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--online', action='store_true')
    args = parser.parse_args()
    text = CONFIG.read_text()
    if '<<<<<<<' in text or '>>>>>>>' in text:
        raise RuntimeError('配置中残留 Git 冲突标记')
    sections = parse_sections(text)
    required = {'General','Proxy','Proxy Group','Rule','Script','Host','URL Rewrite','MITM'}
    missing = required - sections.keys()
    if missing:
        raise RuntimeError(f'缺少配置段：{sorted(missing)}')
    groups = {'DIRECT','PROXY','REJECT'}
    for _, line in sections['Proxy Group']:
        if '=' in line:
            groups.add(line.split('=',1)[0].strip())
    unknown=[]
    for number,line in sections['Rule']:
        if ',' not in line:
            continue
        parts=[item.strip() for item in line.split(',')]
        policy=parts[-2] if parts[-1]=='no-resolve' else parts[-1]
        if policy not in groups:
            unknown.append((number,policy))
    if unknown:
        raise RuntimeError(f'存在未知策略引用：{unknown}')
    expected=[
        'dns-server = https://cloudflare-dns.com/dns-query#proxy',
        'fallback-dns-server = https://dns.google/dns-query#proxy',
        'proxy-dns-server = https://dns.alidns.com/dns-query',
        'dns-fallback-system = false',
        'dns-direct-system = true',
        'dns-direct-fallback-proxy = false',
        'ipv6 = false',
        'prefer-ipv6 = false',
        'block-quic = all-proxy',
        'httpdns-api.aliyuncs.com,DIRECT',
        'httpdns.volcengineapi.com,DIRECT',
        'BlockHttpDNS.list,🧱 DNS 防泄露',
        'ApplePush.list,🍎 苹果推送',
        'Apple.list,🍏 苹果服务',
        'China.list,🔒 国内服务',
        'GEOIP,CN,🔒 国内服务',
        'US-Apps.list,💵 美国金融',
        'UK-Finance.list,💷 英国金融',
        'DOMAIN-SUFFIX,mdpi.com,📚 学术网站',
        'DOMAIN-SUFFIX,mdpi-res.com,📚 学术网站',
        'DOMAIN-SUFFIX,preprints.org,📚 学术网站',
        'DOMAIN-SUFFIX,sciprofiles.com,📚 学术网站',
        'DOMAIN-SUFFIX,scilit.com,📚 学术网站',
        'DOMAIN-SUFFIX,ethenapay-api.co,🇭🇰 香港节点',
        'DOMAIN-SUFFIX,ethenapay.co,🇭🇰 香港节点',
        'DOMAIN,pay.ethena.fi,🇭🇰 香港节点',
        '🏠 家宽节点 = url-test',
        '📚 学术网站 = select,🏠 家宽节点',
        '🤖 AI 服务 = fallback,🇺🇸 美国住宅,🇺🇸 美国普通,REJECT',
        '💵 美国金融 = fallback,🇺🇸 美国住宅,🇺🇸 美国普通,REJECT',
        '🇺🇸 美国住宅 = url-test',
        '🇬🇧 英国住宅 = url-test',
        '🇺🇸 美国普通 = url-test',
        '🇬🇧 英国普通 = url-test',
        '💷 英国金融 = fallback,🇬🇧 英国普通,REJECT',
        '🇺🇸 美国节点 = url-test',
        '# CODEX-BEGIN WLOC',
        'gsp-ssl.ls.apple.com',
        '🇬🇧|英国|UK|London|LHR|🇰🇷|韩国|KR|Korea|ICN|SEL',
    ]
    absent=[item for item in expected if item not in text]
    if absent:
        raise RuntimeError(f'缺少预期规则：{absent}')
    httpdns_exception = text.index('DOMAIN,httpdns-api.aliyuncs.com,DIRECT')
    httpdns_block = text.index('BlockHttpDNS.list,🧱 DNS 防泄露')
    apple_rule = text.index('Apple.list,🍏 苹果服务')
    wloc_rule = text.index('DOMAIN,gs-loc.apple.com,DIRECT')
    if not httpdns_exception < httpdns_block or not wloc_rule < apple_rule:
        raise RuntimeError('HTTPDNS 兼容例外或 WLOC 规则顺序错误')
    urls=set()
    for _,line in sections['Rule']:
        match=re.search(r'https://[^,]+',line)
        if match:
            urls.add(match.group(0))
    if args.online:
        for url in sorted(urls):
            check_online(url)
    suffix=f'，远程规则={len(urls)}' if args.online else ''
    print(f'验证通过：配置段={len(sections)}，策略组={len(groups)-3}，规则={len(sections["Rule"])}{suffix}')

if __name__ == '__main__':
    main()
