import { randomUUID } from 'crypto';

const reasons = {
  ORG_READONLY_ROOT_INVALID: ['只读根部门配置格式不正确', '检查 FEISHU_READONLY_ROOT_DEPTS，使用 od- 开头的 open_department_id。'],
  ORG_BUSINESS_ROOT_INVALID: ['业务根部门配置格式不正确', '检查 FEISHU_SYNC_ROOT_DEPT，应为 0 或 od- 开头的 open_department_id。'],
  ORG_DEPARTMENTS_MISSING: ['飞书用户信息未提供所属部门', '检查该用户的通讯录部门信息及应用通讯录可见范围。'],
  ORG_DEPARTMENT_ID_INVALID: ['部门链中出现不支持的部门编号', '检查返回编号类型；接口应使用 open_department_id，顶层部门为 0。'],
  ORG_ANCESTRY_CYCLE: ['部门上级链出现循环', '按日志中的 ancestry 检查重复部门及其上级关系。'],
  ORG_ANCESTRY_LIMIT: ['部门上级链超过校验深度限制', '核对部门上级链，确认是否存在异常层级。'],
  ORG_PARENT_MISSING: ['飞书部门信息缺少有效的上级部门字段', '检查该部门查询响应的 parent_department_id 及应用通讯录可见范围。'],
  ORG_DEPARTMENT_LOOKUP_FAILED: ['查询飞书部门信息失败', '根据 upstreamStatus、upstreamCode 和 upstreamRequestId 排查飞书接口权限、可见范围或网络。'],
  ORG_USER_LOOKUP_FAILED: ['查询飞书用户信息失败', '检查用户编号、应用通讯录可见范围及飞书接口错误码。'],
  ORG_BUSINESS_ROOT_UNMATCHED: ['所有部门分支均未匹配允许的组织范围', '核对业务根部门和只读根部门配置，以及该用户的实际组织归属。'],
} as const;

export class OrganizationClassificationError extends Error {
  readonly diagnosticId = randomUUID();
  readonly suggestion: string;
  constructor(readonly errorCode: keyof typeof reasons, readonly diagnostic: Record<string, unknown>) {
    super(`组织归属校验失败：${reasons[errorCode][0]}（${errorCode}）`);
    this.name = 'OrganizationClassificationError';
    this.suggestion = reasons[errorCode][1];
    this.message += `，诊断编号：${this.diagnosticId}`;
  }
  toDiagnostic() {
    return { errorCode: this.errorCode, diagnosticId: this.diagnosticId, diagnostic: this.diagnostic, suggestion: this.suggestion };
  }
}

// Do not serialize Axios requests, authorization headers, or the complete response.
export function organizationUpstreamDetails(error: any) {
  const scalar = (value: unknown) => typeof value === 'string' ? value.slice(0, 200) : typeof value === 'number' ? value : undefined;
  return {
    upstreamStatus: scalar(error?.response?.status),
    upstreamCode: scalar(error?.feishuCode ?? error?.response?.data?.code ?? error?.code),
    upstreamRequestId: scalar(error?.response?.headers?.['x-tt-logid'] ?? error?.response?.data?.error?.log_id),
  };
}
