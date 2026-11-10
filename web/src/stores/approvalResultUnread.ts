import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { useAuthStore } from './auth';

export interface ApprovalResult { key:string; status:string; reviewedAt?:string|null; requestedAt?:string|null; kind?:string }
export const useApprovalResultUnreadStore = defineStore('approval-result-unread', () => {
  const auth=useAuthStore();
  const rows=ref<ApprovalResult[]>([]);
  const seen=ref<Record<string,string>>({});
  const initialized=ref(false);
  const storageKey=computed(()=>`approval-result-seen:${auth.user?.feishuUserId || auth.user?.id || ''}`);
  const fingerprint=(row:ApprovalResult)=>JSON.stringify([row.status,row.reviewedAt,row.requestedAt]);
  watch(storageKey,()=>{
    rows.value=[];seen.value={};initialized.value=false;
    try {
      const saved=JSON.parse(localStorage.getItem(storageKey.value)||'{}');
      if(saved?.version===2 && saved.seen && typeof saved.seen==='object' && !Array.isArray(saved.seen)) {
        seen.value=saved.seen;initialized.value=true;
      }
    } catch { /* Optional local persistence. */ }
  },{immediate:true,flush:'sync'});
  const isUnread=(row:ApprovalResult)=>!!auth.user && !auth.readOnly && ['rejected','approved','done'].includes(row.status) && seen.value[row.key]!==fingerprint(row);
  const unread=computed(()=>rows.value.some(isUnread));
  const unreadState=(state:string,kind='')=>rows.value.some(row=>(!kind||row.kind===kind) && (state==='all'||row.status===state||(state==='approved'&&row.status==='done'))&&isUnread(row));
  function persist() {
    try {localStorage.setItem(storageKey.value,JSON.stringify({version:2,seen:seen.value}));}catch{ /* In-memory fallback. */ }
  }
  function update(values:ApprovalResult[],userId:number|undefined) {
    if(!userId || userId!==auth.user?.id)return;
    // First successful load after upgrade establishes the historical baseline.
    // Pending requests still light up when their decision changes later.
    if(!initialized.value) {
      seen.value=Object.fromEntries(values.map(row=>[row.key,fingerprint(row)]));
      initialized.value=true;
      persist();
    }
    rows.value=values;
  }
  function markSeen(row:ApprovalResult) {
    if(!auth.user)return;
    seen.value={...seen.value,[row.key]:fingerprint(row)};
    if(initialized.value)persist();
  }
  return {unread,isUnread,unreadState,update,markSeen};
});
