import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { JwtPayload } from '../auth/types';
import { canManageRules, ReviewRule, validateRule } from './closure-department-rules';

@Injectable()
export class ClosureRuleConfigService {
  constructor(private db: DataSource) {}
  async current(m: EntityManager=this.db.manager, lock=false): Promise<{version:number;rules:ReviewRule[]}> {
    const [row]=await m.query(`SELECT version,rules FROM closure_rule_config WHERE id=1${lock?' FOR SHARE':''}`);
    if (!row) throw new BadRequestException('结项审核规则尚未初始化，请执行数据库迁移');
    return row;
  }
  departments(m: EntityManager=this.db.manager) {
    return m.query(`SELECT d.id,d.name,d.head_user_id,u.name AS head_name,u.avatar_url AS head_avatar_url,u.is_active FROM departments d LEFT JOIN users u ON u.id=d.head_user_id ORDER BY d.name,d.id`);
  }
  private async authorize(u: JwtPayload,m=this.db.manager) {
    const [allowed]=await m.query(`SELECT u.id FROM users u WHERE u.id=$1 AND u.is_active=true AND (
      EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND r.role IN ('admin','leader','dept_head')) OR EXISTS(SELECT 1 FROM departments d WHERE d.head_user_id=u.id))`,[u.userId]);
    if (!allowed) throw new ForbiddenException('仅部门负责人、领导或管理员可配置审核规则');
  }
  async list(u: JwtPayload) { await this.authorize(u); return {...await this.current(),departments:await this.departments()}; }
  async save(u: JwtPayload, body: any) {
    return this.db.transaction(async m=>{
      await this.authorize(u,m);
      const [current]=await m.query('SELECT version,rules FROM closure_rule_config WHERE id=1 FOR UPDATE');
      if (body?.version!==current.version) throw new ConflictException('规则已更新，请刷新后重试');
      const rules:ReviewRule[]=current.rules;
      const old=body.rule?.id ? rules.find(r=>r.id===body.rule.id) : undefined;
      if (body.rule?.id && !old) throw new BadRequestException('规则不存在');
      const rule=validateRule({...body.rule,id:old?.id||Math.max(0,...rules.map(r=>r.id))+1},old);
      const departments=await this.departments(m), dept=departments.find(d=>Number(d.id)===rule.departmentId);
      if (!dept || (rule.enabled && (!dept.head_user_id || !dept.is_active))) throw new BadRequestException('请选择已配置启用负责人的部门');
      rule.departmentName=dept.name;
      if (rule.enabled && rules.some(r=>r.id!==rule.id && r.enabled && r.departmentId===rule.departmentId)) throw new BadRequestException('该部门已有启用规则');
      const next=old?rules.map(r=>r.id===old.id?rule:r):[...rules,rule];
      const version=current.version+1;
      await m.query('UPDATE closure_rule_config SET rules=$1,version=$2,updated_at=NOW() WHERE id=1',[JSON.stringify(next),version]);
      await m.query('INSERT INTO closure_rule_history(version,rules,actor_id) VALUES($1,$2,$3)',[version,JSON.stringify(next),u.userId]);
      return {version,rules:next,departments};
    });
  }
}
