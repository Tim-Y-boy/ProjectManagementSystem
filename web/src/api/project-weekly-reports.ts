import { http } from './request';

export interface WeeklyContent {
  overallStatus: 'normal' | 'risk' | 'blocked';
  achievements: string;
  risks: string;
  coordination: string;
  nextWeek: string;
}
export interface WeeklyReport extends WeeklyContent {
  projectId: number; projectName: string; deptId: number | null; deptName: string;
  ownerId: number | null; ownerName: string; ownerAvatarUrl?: string | null; weekStart: string; weekEnd: string;
  dueAt: string; status: 'missing' | 'draft' | 'submitted'; overdue: boolean;
  version: number; submittedAt: string | null; canEdit: boolean;
}
export interface WeeklyEvidenceItem {
  id: number; taskId?: number; taskTitle?: string; title?: string; userName?: string;
  workDate?: string; content?: string; risk?: string; nextPlan?: string; createdAt?: string;
  dueAt?: string; status?: string; sourcePath?: string; hasHistory?: boolean;
}
export interface WeeklyEvidence { updates: WeeklyEvidenceItem[]; assets: WeeklyEvidenceItem[]; tasks: WeeklyEvidenceItem[]; activeTasks?: WeeklyEvidenceItem[] }
export interface WeeklyDetail extends WeeklyReport {
  evidence: WeeklyEvidence; canRequestAmendment?: boolean; canReviewAmendment?: boolean;
  amendment?: { id: number; status: 'draft'|'pending'|'approved'|'rejected'; draftVersion: number; proposedContent: WeeklyContent | null; originalContent: WeeklyContent; reason: string; comment: string; requesterName: string; approverName: string } | null;
}
export type WeeklyPayload = WeeklyContent & { projectId: number; weekStart: string; version: number };
export type WeeklyAmendmentPayload = Omit<WeeklyPayload,'overallStatus'> & {overallStatus: WeeklyContent['overallStatus'] | ''; reason:string; draftVersion:number};
export const projectWeeklyReportsApi = {
  amendments: () => http.get<any[]>('/project-weekly-reports/amendments'),
  requestAmendment: (body: WeeklyAmendmentPayload) => http.post<WeeklyDetail>('/project-weekly-reports/request-amendment', body),
  saveAmendmentDraft: (body: WeeklyAmendmentPayload) => http.put<WeeklyDetail>('/project-weekly-reports/amendment-draft', body),
  reviewAmendment: (body: {id:number;approve:boolean;comment:string}) => http.post<WeeklyDetail>('/project-weekly-reports/review-amendment', body),
  updates: () => http.get<Pick<WeeklyReport, 'projectId' | 'weekStart' | 'version'>[]>('/project-weekly-reports/updates'),
  list: (params: Record<string, unknown> = {}) => http.get<WeeklyReport[]>('/project-weekly-reports', { params }),
  detail: (projectId: number, weekStart: string, liveEvidence = false) => http.get<WeeklyDetail>('/project-weekly-reports/detail', { params: { projectId, weekStart, ...(liveEvidence ? { liveEvidence: true } : {}) } }),
  submit: (body: WeeklyPayload) => http.post<WeeklyDetail>('/project-weekly-reports/submit', body),
  save: (body: Omit<WeeklyPayload, 'overallStatus'> & { overallStatus: WeeklyContent['overallStatus'] | '' }) => http.put<WeeklyDetail>('/project-weekly-reports/save', body),
  todo: () => http.get<WeeklyReport[]>('/project-weekly-reports/todo'),
};
