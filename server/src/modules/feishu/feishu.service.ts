import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import axios from 'axios';
import { config } from '../../config/config';

// 飞书开放能力封装：拿 token、拉部门、拉用户。
@Injectable()
export class FeishuService {
  private logger = new Logger(FeishuService.name);
  private cachedTenantToken: { token: string; exp: number } | null = null;

  isConfigured() {
    return !!config.feishu.appId && !!config.feishu.appSecret;
  }

  // tenant_access_token，带本地缓存（飞书有效期约 2h）
  async getTenantAccessToken(): Promise<string> {
    if (!this.isConfigured()) {
      throw new InternalServerErrorException(
        '未配置 FEISHU_APP_ID/SECRET，无法调用飞书接口',
      );
    }
    const now = Math.floor(Date.now() / 1000);
    if (this.cachedTenantToken && this.cachedTenantToken.exp - now > 60) {
      return this.cachedTenantToken.token;
    }
    const res = await axios.post(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      {
        app_id: config.feishu.appId,
        app_secret: config.feishu.appSecret,
      },
    );
    const token = res.data?.tenant_access_token;
    const expire = res.data?.expire || 7200;
    if (!token) {
      throw new InternalServerErrorException(
        '获取 tenant_access_token 失败：' + JSON.stringify(res.data),
      );
    }
    this.cachedTenantToken = { token, exp: now + expire };
    return token;
  }

  // 拉部门列表：从指定根部门(rootDeptId，od- 前缀)开始递归 children。
  // 飞书不返回 parent 字段，父子关系靠"从哪个父部门拉到的"自己记录。
  // 返回 [{...部门字段, parentId: 父部门od-}, ...]；根部门本身 parentId=null。
  // 传 '0' 表示全公司；传具体部门 ID 则只同步该部门分支。
  async listDepartments(rootDeptId: string = '0'): Promise<any[]> {
    const token = await this.getTenantAccessToken();
    const all: any[] = [];
    const seen = new Set<string>();
    const depth: Record<string, number> = {};

    const fetchChildren = async (
      parentId: string,
      parentOuterId: string | null,
      curDepth: number,
    ) => {
      if (seen.has(parentId)) return;
      seen.add(parentId);
      let pageToken: string | undefined;
      do {
        const res = await axios.get(
          `https://open.feishu.cn/open-apis/contact/v3/departments/${encodeURIComponent(parentId)}/children`,
          {
            params: {
              department_id_type: 'open_department_id',
              user_id_type: 'user_id', // 让 leaders[].leaderID 返回 user_id 格式，与 users.feishu_user_id 对齐
              page_size: 50,
              page_token: pageToken || undefined,
            },
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        const items = res.data?.data?.items || [];
        for (const item of items) {
          all.push({ ...item, parentId: parentId });
        }
        // 递归每个子部门：用 open_department_id 作为父节点继续拉
        for (const item of items) {
          await fetchChildren(
            item.open_department_id,
            parentId,
            curDepth + 1,
          );
        }
        pageToken = res.data?.data?.has_more
          ? res.data.data.page_token
          : undefined;
      } while (pageToken);
    };

    // 根部门本身（非全公司模式时）也要进来，parentId=null 表示它是顶层
    if (rootDeptId !== '0') {
      const rootInfo = await this.getDepartment(rootDeptId);
      if (rootInfo) {
        all.push({ ...rootInfo, parentId: null });
      }
    }
    await fetchChildren(rootDeptId, rootDeptId === '0' ? null : rootDeptId, 0);
    return all;
  }

  // 按部门拉成员：必须用 open_department_id（od- 前缀），用 department_id(UUID) 拉不到
  async listUsersByDepartment(deptId: string): Promise<any[]> {
    const token = await this.getTenantAccessToken();
    const all: any[] = [];
    let pageToken: string | undefined;
    do {
      const res = await axios.get(
        'https://open.feishu.cn/open-apis/contact/v3/users',
        {
          params: {
            department_id: deptId,
            department_id_type: 'open_department_id',
            page_size: 100,
            page_token: pageToken || undefined,
          },
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const items = res.data?.data?.items || [];
      all.push(...items);
      pageToken = res.data?.data?.has_more
        ? res.data.data.page_token
        : undefined;
    } while (pageToken);
    return all;
  }

  // 按 user_id 单拉一个用户
  async getUser(userId: string): Promise<any> {
    const token = await this.getTenantAccessToken();
    const res = await axios.get(
      `https://open.feishu.cn/open-apis/contact/v3/users/${encodeURIComponent(userId)}`,
      {
        params: { user_id_type: 'user_id' },
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    return res.data?.data?.user || null;
  }

  // 按 open_department_id 单拉一个部门（用于同步根部门本身）
  async getDepartment(deptId: string): Promise<any> {
    const token = await this.getTenantAccessToken();
    const res = await axios.get(
      `https://open.feishu.cn/open-apis/contact/v3/departments/${encodeURIComponent(deptId)}`,
      {
        params: { department_id_type: 'open_department_id' },
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    return res.data?.data?.department || null;
  }

  async searchDocs(query: string): Promise<any[]> {
    const keyword = query.trim();
    if (!keyword) return [];
    const token = await this.getTenantAccessToken();
    const res = await axios.post(
      'https://open.feishu.cn/open-apis/suite/docs-api/search/object',
      {
        search_key: keyword,
        count: 20,
      },
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const docs = res.data?.data?.docs_entities || res.data?.data?.items || [];
    return docs.map((item: any) => ({
      id: item.docs_token || item.obj_token || item.token || item.id,
      title: item.title || item.name || '未命名飞书文件',
      type: item.docs_type || item.obj_type || item.type || 'doc',
      url: item.url || item.docs_url || item.link || null,
      owner: item.owner_name || item.owner || null,
      updatedAt: item.update_time || item.updated_time || null,
    }));
  }
}
