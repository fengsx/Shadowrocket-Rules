#!/usr/bin/env python3
# 将 Shadowrocket.conf 编译为客户端无关、确定性的规则清单。
from __future__ import annotations
import csv
import hashlib
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'Shadowrocket.conf'
OUTPUT=ROOT/'dist/rules-manifest.json'
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
def main():
    raw=SOURCE.read_bytes(); text=raw.decode(); groups=compile_groups(text)
    rules,final=compile_rules(text,BUILTINS|{g['name'] for g in groups})
    manifest={'schemaVersion':1,'source':{'repository':'fengsx/Shadowrocket-Rules','path':'Shadowrocket.conf','sha256':hashlib.sha256(raw).hexdigest()},'policyGroups':groups,'rules':rules,'finalTarget':final}
    OUTPUT.parent.mkdir(parents=True,exist_ok=True); OUTPUT.write_text(json.dumps(manifest,ensure_ascii=False,indent=2,sort_keys=True)+'\n')
    print(f'编译完成：策略组={len(groups)}，规则={len(rules)}，输出={OUTPUT}')
if __name__=='__main__': main()
