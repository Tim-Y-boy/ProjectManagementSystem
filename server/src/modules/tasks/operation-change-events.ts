// Read existing approval facts without rewriting historical task logs.
export function operationChangeEvents(logs: any[], changes: any[], items: any[]) {
  const result = logs.map(log => ({ ...log }));
  for (const change of changes) {
    const linked = result.filter(log => log.action === 'plan_change' && String(log.payload?.changeId) === String(change.id));
    for (const log of linked) {
      log.action = 'plan_change_approve';
      log.payload = { ...log.payload, reason: change.reason, comment: change.approverComment, requesterId: change.requesterId, requestedAt: change.createdAt, approverId: change.approverId, reviewedAt: change.reviewedAt };
    }
    for (const item of items.filter(item => String(item.changeId) === String(change.id))) {
      const payload = { changeId: change.id, changeType: item.changeType, before: item.before, after: item.after, reason: change.reason, requesterId: change.requesterId, requestedAt: change.createdAt, approverId: change.approverId, reviewedAt: change.reviewedAt,
        taskTitle: item.changeType === 'add' ? item.after?.title : item.before?.title };
      const event = (action: string, operatorId: any, createdAt: any, comment?: string) => {
        if (!operatorId || !createdAt) return;
        result.push({ id: `change-${change.id}-${item.id}-${action}`, projectId: change.projectId, taskId: item.changeType === 'add' ? null : item.taskId,
          action, operatorId, createdAt, fromStatus: null, toStatus: null, payload: { ...payload, comment } });
      };
      event('plan_change_request', change.requesterId, change.createdAt);
      event('plan_change_owner_approve', change.ownerApproverId, change.ownerApprovedAt, change.ownerComment);
      if (change.status === 'approved' && !linked.some(log => String(log.taskId) === String(item.taskId))) {
        event('plan_change_approve', change.approverId, change.reviewedAt, change.approverComment);
      }
      if (change.status === 'rejected') event('plan_change_reject', change.approverId, change.reviewedAt, change.approverComment);
    }
  }
  return result;
}
