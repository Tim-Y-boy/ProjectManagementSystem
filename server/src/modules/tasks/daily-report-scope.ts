// Aliases are fixed by the report queries; userId is always a bound parameter.
export function dailyReportProjectScope(userId = ':reportUserId'): string {
  return `(project.owner_id=${userId}
    OR EXISTS (SELECT 1 FROM project_owners report_owner WHERE report_owner.project_id=project.id AND report_owner.user_id=${userId})
    OR EXISTS (SELECT 1 FROM tasks participation WHERE participation.project_id=project.id
      AND (participation.assignee_id=${userId} OR EXISTS
        (SELECT 1 FROM task_assignees report_assignee WHERE report_assignee.task_id=participation.id
          AND report_assignee.role='assignee' AND report_assignee.user_id=${userId}))))`;
}
