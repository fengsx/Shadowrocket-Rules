const enc=new TextEncoder(),dec=new TextDecoder();
async function key(secret:string){return crypto.subtle.importKey("raw",await crypto.subtle.digest("SHA-256",enc.encode(secret)),"AES-GCM",false,["encrypt","decrypt"]);}
export async function encrypt(secret:string,value:string){const iv=crypto.getRandomValues(new Uint8Array(12));const data=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},await key(secret),enc.encode(value)));return btoa(String.fromCharCode(...iv,...data));}
export async function decrypt(secret:string,value:string){const raw=Uint8Array.from(atob(value),c=>c.charCodeAt(0));return dec.decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:raw.slice(0,12)},await key(secret),raw.slice(12)));}
export async function sha(value:string){const raw=new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(value)));return [...raw].map(x=>x.toString(16).padStart(2,"0")).join("");}
export function token(){const raw=crypto.getRandomValues(new Uint8Array(24));return [...raw].map(x=>x.toString(16).padStart(2,"0")).join("");}
