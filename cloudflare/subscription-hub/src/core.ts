import { parse, stringify } from "yaml";
import type { ManifestGroup, ManifestRule, ProxyNode, RuleManifest, StoredNode } from "./types";

const SUPPORTED=new Set(["vless","trojan","hysteria2","ss"]);
const REGION_RULES:Array<[RegExp,string]>=[
  [/(?:香港|\bhk\b|hong\s*kong)/i,"香港"],[/(?:台湾|台北|\btw\b|taiwan|taipei)/i,"台湾"],
  [/(?:日本|东京|大阪|\bjp\b|japan|tokyo)/i,"日本"],[/(?:美国|\bus\b|usa|united\s*states|los\s*angeles|纽约)/i,"美国"],
  [/(?:韩国|首尔|\bkr\b|korea|seoul|icn|sel)/i,"韩国"],[/(?:英国|伦敦|\buk\b|britain|london|lhr)/i,"英国"],
  [/(?:新加坡|狮城|\bsg\b|singapore)/i,"新加坡"],
];
const str=(v:unknown)=>typeof v==="string"?v:"";
const bool=(v:unknown)=>v===true||v===1||v==="true";
const region=(name:string)=>REGION_RULES.find(([r])=>r.test(name))?.[1]??"";
async function digest(value:string){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");}
function canonical(proxy:ProxyNode){const reality=proxy["reality-opts"] as Record<string,unknown>|undefined;return JSON.stringify([proxy.type,proxy.server,proxy.port,proxy.uuid??proxy.password??"",reality?.["public-key"]??"",proxy.network??"tcp"]);}
function decode64(value:string){const n=value.replaceAll("-","+").replaceAll("_","/");return new TextDecoder().decode(Uint8Array.from(atob(n+"=".repeat((4-n.length%4)%4)),c=>c.charCodeAt(0)));}
function uriProxy(uri:string):ProxyNode|null{
  let u:URL; try{u=new URL(uri.trim());}catch{return null;} const type=u.protocol.slice(0,-1).toLowerCase(); if(!SUPPORTED.has(type))return null;
  const name=decodeURIComponent(u.hash.slice(1))||`${type} ${u.hostname}`; const common:any={name,type,server:u.hostname,port:Number(u.port),udp:true};
  if(!common.port)return null;
  if(type==="vless"){common.uuid=decodeURIComponent(u.username);common.network=u.searchParams.get("type")||"tcp";const sec=u.searchParams.get("security");common.tls=sec==="tls"||sec==="reality";common.servername=u.searchParams.get("sni")||u.hostname;common["client-fingerprint"]=u.searchParams.get("fp")||"chrome";if(sec==="reality")common["reality-opts"]={"public-key":u.searchParams.get("pbk")||"","short-id":u.searchParams.get("sid")||""};}
  if(type==="trojan"){common.password=decodeURIComponent(u.username);common.sni=u.searchParams.get("sni")||u.hostname;common["skip-cert-verify"]=u.searchParams.get("allowInsecure")==="1";}
  if(type==="hysteria2"){common.password=decodeURIComponent(u.username);common.sni=u.searchParams.get("sni")||u.hostname;common["skip-cert-verify"]=["1","true"].includes(u.searchParams.get("insecure")||"");}
  if(type==="ss"){common.cipher=decodeURIComponent(u.username);common.password=decodeURIComponent(u.password);}
  return common;
}
export async function parseNodes(raw:string,sourceId:string):Promise<StoredNode[]>{
  let values:ProxyNode[]=[]; try{const d=parse(raw) as any;if(Array.isArray(d?.proxies))values=d.proxies;}catch{}
  if(!values.length){let text=raw.trim();try{text=decode64(text);}catch{} values=text.split(/\r?\n/).map(uriProxy).filter(Boolean) as ProxyNode[];}
  const out:StoredNode[]=[];const seen=new Set<string>();let order=0;
  for(const value of values){const type=str(value.type).toLowerCase();const server=str(value.server);const port=Number(value.port);const name=str(value.name)||`${type} ${server}`;if(!SUPPORTED.has(type)||!server||!Number.isInteger(port))continue;const proxy={...value,name,type,server,port} as ProxyNode;const fingerprint=await digest(canonical(proxy));if(seen.has(fingerprint))continue;seen.add(fingerprint);out.push({id:`${sourceId}-${order++}`,sourceId,fingerprint,name,region:region(name),protocol:type,proxy});}
  return out;
}
function hostPort(n:ProxyNode){return `${n.server.includes(":")?`[${n.server}]`:n.server}:${n.port}`;}
export function nodeUri(n:ProxyNode):string{
  const q=new URLSearchParams();let auth="";
  if(n.type==="vless"){auth=encodeURIComponent(str(n.uuid));q.set("type",str(n.network)||"tcp");q.set("security",bool(n.tls)?(n["reality-opts"]?"reality":"tls"):"none");q.set("sni",str(n.servername)||n.server);q.set("fp",str(n["client-fingerprint"])||"chrome");const r=n["reality-opts"] as any;if(r){q.set("pbk",str(r["public-key"]));q.set("sid",str(r["short-id"]));}}
  else if(n.type==="trojan"){auth=encodeURIComponent(str(n.password));q.set("sni",str(n.sni)||n.server);if(bool(n["skip-cert-verify"]))q.set("allowInsecure","1");}
  else if(n.type==="hysteria2"){auth=encodeURIComponent(str(n.password));q.set("sni",str(n.sni)||n.server);if(bool(n["skip-cert-verify"]))q.set("insecure","1");}
  else {auth=`${encodeURIComponent(str(n.cipher))}:${encodeURIComponent(str(n.password))}`;}
  return `${n.type}://${auth}@${hostPort(n)}${q.size?`?${q}`:""}#${encodeURIComponent(n.name)}`;
}
const mapped=(name:string)=>name==="🚀 节点选择"?"PROXY":name;
function groups(nodes:ProxyNode[],manifest:RuleManifest){const names=nodes.map(n=>n.name);const result:any[]=[{name:"PROXY",type:"select",proxies:["AUTO",...names,"DIRECT"]},{name:"AUTO",type:"url-test",proxies:names,url:"https://www.gstatic.com/generate_204",interval:300,tolerance:80,lazy:true}];for(const g of manifest.policyGroups){if(g.name==="🚀 节点选择")continue;if(g.type==="url-test"){let selected: string[]=[];try{const r=new RegExp(g.attributes["policy-regex-filter"]||".+","i");selected=nodes.filter(n=>r.test(n.name)).map(n=>n.name);}catch{}result.push({name:g.name,type:"url-test",proxies:selected.length?selected:names,url:g.attributes.url||"https://www.gstatic.com/generate_204",interval:Number(g.attributes.interval||600),tolerance:Number(g.attributes.tolerance||80),lazy:true});}else{const options=[...new Set(g.options.map(mapped).filter(x=>x!==g.name))];result.push({name:g.name,type:"select",proxies:options.length?options:["PROXY","DIRECT"]});}}return result;}
function providers(rules:ManifestRule[]){const data:Record<string,any>={};const ids=new Map<string,string>();let i=0;for(const r of rules){if(!["rule_set","domain_set"].includes(r.kind))continue;const name=`rules_${String(++i).padStart(2,"0")}`;data[name]={type:"http",behavior:r.kind==="domain_set"?"domain":"classical",format:"text",url:r.value,path:`./ruleset/${name}.list`,interval:21600};ids.set(r.id,name);}return {data,ids};}
function ruleLine(r:ManifestRule,ids:Map<string,string>){const target=mapped(r.target);if(r.kind==="raw")return `${r.value},${target}`;if(r.kind==="rule_set"||r.kind==="domain_set")return `RULE-SET,${ids.get(r.id)},${target}`;const token:{[k:string]:string}={domain:"DOMAIN",domain_suffix:"DOMAIN-SUFFIX",domain_keyword:"DOMAIN-KEYWORD",cidr:"IP-CIDR",cidr6:"IP-CIDR6",geoip:"GEOIP"};return `${token[r.kind]},${r.value},${target}${r.noResolve?",no-resolve":""}`;}
export function renderMihomo(nodes:ProxyNode[],manifest:RuleManifest,merlin:boolean){const p=providers(manifest.rules);const config:any={"mixed-port":7890,"allow-lan":merlin,mode:"rule","log-level":"warning",ipv6:false,dns:{enable:true,ipv6:false,listen:merlin?"0.0.0.0:1053":"127.0.0.1:1053","enhanced-mode":"fake-ip","fake-ip-range":"198.18.0.1/16","respect-rules":true,"default-nameserver":["223.5.5.5","1.1.1.1"],nameserver:["https://cloudflare-dns.com/dns-query","https://dns.google/dns-query"],"direct-nameserver":["https://dns.alidns.com/dns-query","https://doh.pub/dns-query"]},proxies:nodes,"proxy-groups":groups(nodes,manifest),"rule-providers":p.data,rules:[...nodes.map(n=>`DOMAIN,${n.server},DIRECT`),...manifest.rules.map(r=>ruleLine(r,p.ids)),`MATCH,${mapped(manifest.finalTarget)}`]};if(merlin){config["redir-port"]=7892;config["tproxy-port"]=7893;config["bind-address"]="*";}return stringify(config);}
export function renderShadowrocket(nodes:ProxyNode[]){const text=nodes.map(nodeUri).join("\n");const bytes=new TextEncoder().encode(text);let binary="";for(const b of bytes)binary+=String.fromCharCode(b);return btoa(binary);}
