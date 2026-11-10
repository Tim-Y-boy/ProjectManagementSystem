export function isCurrentAnalysisRunning(job:any, fileIds:number[], version:number):boolean {
  const sorted=(ids:unknown[])=>ids.map(Number).sort((a,b)=>a-b).join(',');
  return !!job && !job.stale && job.config_version===version
    && Array.isArray(job.file_ids) && sorted(job.file_ids)===sorted(fileIds)
    && ['queued','processing'].includes(job.status);
}
