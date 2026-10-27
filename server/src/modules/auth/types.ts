// JWT payload：本地签发的 token 里带的用户身份
export interface JwtPayload {
  userId: number;
  feishuUserId: string;
  name: string;
  roles: string[]; // 有效角色：手工角色 + 自动推导的 dept_head（管理 ≥1 个部门时自动加入）
  deptId: number | null;
  managedDeptIds: number[]; // 我负责的部门 id 列表（departments.head_user_id = 我，来自飞书组织架构）
}

export interface AuthResultDto {
  accessToken: string;
  user: {
    id: number;
    name: string;
    feishuUserId: string;
    deptId: number | null;
    roles: string[];
    managedDeptIds: number[];
    avatarUrl?: string | null; // 飞书头像（右上角展示）
    jobTitle?: string | null; // 飞书职务
    deptName?: string | null; // 所在部门名（右上角展示）
  };
}