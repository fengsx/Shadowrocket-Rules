export type ProxyNode = Record<string, unknown> & { name: string; type: string; server: string; port: number };
export interface StoredNode { id: string; sourceId: string; fingerprint: string; name: string; region: string; protocol: string; proxy: ProxyNode; }
export interface ManifestGroup { name: string; type: string; options: string[]; attributes: Record<string,string>; }
export interface ManifestRule { id: string; position: number; kind: string; value: string; target: string; noResolve: boolean; }
export interface RuleManifest { schemaVersion: number; source: { repository:string; path:string; sha256:string }; policyGroups: ManifestGroup[]; rules: ManifestRule[]; finalTarget: string; }
export interface Env { DB: D1Database; ARTIFACTS: KVNamespace; MASTER_KEY:string; ADMIN_TOKEN:string; RULE_MANIFEST_URL:string; }
