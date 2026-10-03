#!/usr/bin/env python3
# 将 Shadowrocket.conf 编译为客户端无关、确定性的规则清单。
from __future__ import annotations
import csv
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlparse
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'Shadowrocket.conf'
OUTPUT=ROOT/'dist/rules-manifest.json'
MERLIN_OUTPUT=ROOT/'dist/merlinclash-fengsx.yaml'
BUILTINS={'DIRECT','PROXY','REJECT'}
def section_lines(text,name):
    marker=f'[{name}]'
    if marker not in text: raise RuntimeError(f'缺少配置段：{marker}')
    body=text.split(marker,1)[1]
    if '\n[' in body: body=body.split('\n[',1)[0]
    return [line.strip() for line in body.splitlines() if line.strip() and not line.lstrip().startswith('#')]
def fields(line): return next(csv.reader([line],skipinitialspace=True))
def compile_groups(text):
    groups=[]; names=set()
    for line in section_lines(text,'Proxy Group'):
        if '=' not in line: continue
        name,rhs=(part.strip() for part in line.split('=',1)); values=fields(rhs)
        kind=values[0]; options=[]; attributes={}
        for value in values[1:]:
            if '=' in value:
                key,item=value.split('=',1); attributes[key.strip()]=item.strip()
            else: options.append(value)
        if name in names: raise RuntimeError(f'重复策略组：{name}')
        names.add(name); groups.append({'name':name,'type':kind,'options':options,'attributes':attributes})
    return groups
def compile_rules(text,targets):
    rules=[]; final='PROXY'
    for line in section_lines(text,'Rule'):
        if line.startswith('FINAL,'):
            final=line.split(',',1)[1].strip(); continue
        no_resolve=line.endswith(',no-resolve'); core=line[:-11] if no_resolve else line
        if core.startswith('AND,'):
            value,target=core.rsplit(',',1); kind='raw'
        else:
            parts=fields(core)
            if len(parts)<3: raise RuntimeError(f'无法解析规则：{line}')
            token,value,target=parts[0],parts[1],parts[2]
            kind={'DOMAIN':'domain','DOMAIN-SUFFIX':'domain_suffix','DOMAIN-KEYWORD':'domain_keyword','IP-CIDR':'cidr','IP-CIDR6':'cidr6','GEOIP':'geoip','RULE-SET':'rule_set','DOMAIN-SET':'domain_set'}.get(token)
            if not kind: raise RuntimeError(f'不支持跨客户端转换的规则：{line}')
        target=target.strip()
        if target not in targets: raise RuntimeError(f'规则目标不存在：{target}（{line}）')
        rules.append({'id':f'rule-{len(rules)+1:04d}','position':(len(rules)+1)*10,'kind':kind,'value':value.strip(),'target':target,'noResolve':no_resolve})
    if final not in targets: raise RuntimeError(f'兜底策略不存在：{final}')
    return rules,final

def yaml_value(value):
    return json.dumps(value, ensure_ascii=False)

def mapped_target(name):
    return '🚀 节点选择' if name == 'PROXY' else name

def delivery_url(url):
    match = re.fullmatch(r'https://raw\.githubusercontent\.com/([^/]+)/([^/]+)/(?:refs/heads/)?([^/]+)/(.*)', url)
    if not match:
        return url
    owner, repository, branch, path = match.groups()
    return f'https://cdn.jsdelivr.net/gh/{owner}/{repository}@{branch}/{path}'

def append_list(lines, key, values, indent=4):
    lines.append(' ' * indent + f'{key}:')
    for value in values:
        lines.append(' ' * (indent + 2) + f'- {yaml_value(value)}')

def provider_base_name(url):
    stem=Path(urlparse(url).path).stem
    stem=re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', stem)
    stem=re.sub(r'[^A-Za-z0-9]+', '_', stem).strip('_').lower()
    if not stem:
        raise RuntimeError(f'无法从规则地址生成可读名称：{url}')
    return f'fengsx_{stem}'

def compile_merlin(groups, rules, final):
    lines = [
        '# 由 scripts/compile_rules.py 自动生成，请勿手工修改。',
        '# FENGSX-MERLIN-TEMPLATE-V1',
        'proxy-groups:',
        '  - name: "♻️ 自动选择"',
        '    type: url-test',
        '    include-all: true',
        '    proxies:',
        '      - "REJECT"',
        '    url: "https://www.gstatic.com/generate_204"',
        '    interval: 300',
        '    tolerance: 80',
        '    lazy: true',
    ]
    for group in groups:
        name = group['name']
        kind = group['type']
        lines.append(f'  - name: {yaml_value(name)}')
        lines.append(f'    type: {kind}')
        if kind == 'url-test':
            lines.append('    include-all: true')
            lines.append(f'    filter: {yaml_value(group["attributes"].get("policy-regex-filter", ".+"))}')
            append_list(lines, 'proxies', ['REJECT'])
            lines.append(f'    url: {yaml_value(group["attributes"].get("url", "https://www.gstatic.com/generate_204"))}')
            lines.append(f'    interval: {int(group["attributes"].get("interval", 600))}')
            lines.append(f'    tolerance: {int(group["attributes"].get("tolerance", 80))}')
            lines.append('    lazy: true')
            continue
        options = []
        for option in group['options']:
            mapped = mapped_target(option)
            if mapped != name and mapped not in options:
                options.append(mapped)
        if name == '🚀 节点选择':
            lines.append('    include-all: true')
            options.insert(0, '♻️ 自动选择')
        selected = mapped_target(group['attributes'].get('policy-select-name', ''))
        if selected and selected in options:
            options.remove(selected)
            options.insert(0, selected)
        append_list(lines, 'proxies', options or ['DIRECT'])
        if kind == 'fallback':
            lines.append(f'    url: {yaml_value(group["attributes"].get("url", "https://www.gstatic.com/generate_204"))}')
            lines.append(f'    interval: {int(group["attributes"].get("interval", 300))}')
            lines.append('    lazy: true')

    lines.extend([
        'rule-providers:',
        '  FENGSX-NodeEndpoints:',
        '    type: file',
        '    behavior: classical',
        '    format: yaml',
        '    path: ./rule_custom/fengsx_node_endpoints.yaml',
    ])
    provider_ids = {}
    used_provider_names = {'FENGSX-NodeEndpoints'}
    for rule in rules:
        if rule['kind'] not in {'rule_set', 'domain_set'}:
            continue
        base = provider_base_name(rule['value'])
        provider = base
        if provider in used_provider_names:
            behavior = 'domain' if rule['kind'] == 'domain_set' else 'classical'
            provider = f'{base}_{behavior}'
        suffix = 2
        unique_provider = provider
        while unique_provider in used_provider_names:
            unique_provider = f'{provider}_{suffix:02d}'
            suffix += 1
        provider = unique_provider
        used_provider_names.add(provider)
        provider_ids[rule['id']] = provider
        lines.extend([
            f'  {provider}:',
            '    type: http',
            f'    behavior: {"domain" if rule["kind"] == "domain_set" else "classical"}',
            '    format: text',
            f'    url: {yaml_value(delivery_url(rule["value"]))}',
            f'    path: ./rule_provider/fengsx/{provider}.list',
            '    interval: 21600',
        ])

    tokens = {
        'domain': 'DOMAIN',
        'domain_suffix': 'DOMAIN-SUFFIX',
        'domain_keyword': 'DOMAIN-KEYWORD',
        'cidr': 'IP-CIDR',
        'cidr6': 'IP-CIDR6',
        'geoip': 'GEOIP',
    }
    lines.extend(['rules:', '  - RULE-SET,FENGSX-NodeEndpoints,DIRECT'])
    for rule in rules:
        target = mapped_target(rule['target'])
        if rule['kind'] == 'raw':
            line = f'{rule["value"].replace("PROTOCOL,", "NETWORK,")},{target}'
        elif rule['kind'] in {'rule_set', 'domain_set'}:
            line = f'RULE-SET,{provider_ids[rule["id"]]},{target}'
        else:
            line = f'{tokens[rule["kind"]]},{rule["value"]},{target}'
            if rule['noResolve']:
                line += ',no-resolve'
        lines.append(f'  - {line}')
    lines.append(f'  - MATCH,{mapped_target(final)}')
    MERLIN_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    MERLIN_OUTPUT.write_text('\n'.join(lines) + '\n')
def main():
    raw=SOURCE.read_bytes(); text=raw.decode(); groups=compile_groups(text)
    rules,final=compile_rules(text,BUILTINS|{g['name'] for g in groups})
    manifest={'schemaVersion':1,'source':{'repository':'fengsx/Shadowrocket-Rules','path':'Shadowrocket.conf','sha256':hashlib.sha256(raw).hexdigest()},'policyGroups':groups,'rules':rules,'finalTarget':final}
    OUTPUT.parent.mkdir(parents=True,exist_ok=True); OUTPUT.write_text(json.dumps(manifest,ensure_ascii=False,indent=2,sort_keys=True)+'\n')
    compile_merlin(groups, rules, final)
    print(f'编译完成：策略组={len(groups)}，规则={len(rules)}，输出={OUTPUT}, {MERLIN_OUTPUT}')
if __name__=='__main__': main()
