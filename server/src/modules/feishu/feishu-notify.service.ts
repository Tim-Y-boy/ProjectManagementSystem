import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { REVIEW_NOTIFICATION_TYPES, resolveReviewResult, reviewedCard } from './review-card';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { Notification } from '../../entities/notification.entity';
import { User } from '../../entities/user.entity';
import { FeishuService } from './feishu.service';

type NotificationRefs = {
  projectId?: number | null;
  taskId?: number | null;
  planChangeId?: number | null;
  review?: { stage?: string; noticeId?: number; resultPath?: string };
};

type FeishuMsgType = 'text' | 'interactive' | 'post';

@Injectable()
export class FeishuNotifyService {
  private readonly logger = new Logger(FeishuNotifyService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly feishu: FeishuService,
  ) {}

  async send(
    type: string,
    recipientUserId: number | null,
    content: string,
    refs: NotificationRefs = {},
  ): Promise<Notification> {
    return this.sendMessage(type, recipientUserId, 'text', { text: content }, content, refs);
  }

  async sendCard(
    type: string,
    recipientUserId: number | null,
    card: Record<string, any>,
    fallbackContent: string,
    refs: NotificationRefs = {},
  ): Promise<Notification> {
    const sharedCard = { ...card, config: { ...card.config, update_multi: true } };
    return this.sendMessage(type, recipientUserId, 'interactive', sharedCard, fallbackContent, refs);
  }

  /**
   * 发到群聊的富文本 post（每日项目群简报用）。收件=群 chat_id，落 notifications 时 recipient_id=null、target=chatId。
   * segments：post 的 content 行数组（每行是段元素数组，如 [{"tag":"text","text":"…"},{"tag":"at","user_id":"ou_xxx"}]）。
   */
  async sendGroupPost(
    type: string,
    chatId: string,
    title: string,
    segments: Record<string, any>[][],
    fallbackContent: string,
    refs: NotificationRefs = {},
  ): Promise<Notification> {
    return this.sendGroupMessage(type, chatId, 'post', { zh_cn: { title, content: segments } }, fallbackContent, refs);
  }

  async sendGroupCard(type: string, chatId: string, card: Record<string, any>, fallbackContent: string): Promise<Notification> {
    return this.sendGroupMessage(type, chatId, 'interactive', card, fallbackContent, {});
  }

  async uploadBriefImage(png: Buffer): Promise<string> {
    if (process.env.FEISHU_NOTIFY_DISABLED === 'true' || process.env.FEISHU_GROUP_NOTIFY_DISABLED === 'true') throw new Error('群通知已禁用');
    const token = await this.feishu.getTenantAccessToken();
    const form = new FormData();
    form.append('image_type', 'message');
    form.append('image', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'project-progress.png');
    const response = await axios.post('https://open.feishu.cn/open-apis/im/v1/images', form, {
      headers: { Authorization: `Bearer ${token}` }, timeout: 30000,
    });
    if (response.data?.code !== 0 || !response.data?.data?.image_key) throw new Error(response.data?.msg || '简报图片上传失败');
    return response.data.data.image_key;
  }

  private async sendGroupMessage(type: string, chatId: string, msgType: FeishuMsgType, contentBody: Record<string, any>, fallbackContent: string, refs: NotificationRefs): Promise<Notification> {
    const notification = this.notifications.create({
      type,
      recipientId: null,
      target: chatId,
      content: fallbackContent,
      response: null,
      success: false,
      retryCount: 0,
      projectId: refs.projectId ?? null,
      taskId: refs.taskId ?? null,
      planChangeId: refs.planChangeId ?? null,
      sentAt: null,
    });

    try {
      if (process.env.FEISHU_NOTIFY_DISABLED === 'true') throw new Error('本地测试：已禁用真实飞书通知，仅保留通知记录');
      if (process.env.FEISHU_GROUP_NOTIFY_DISABLED === 'true') throw new Error('本地测试：已禁用真实群通知，仅保留通知记录');
      if (!chatId || !chatId.startsWith('oc_')) {
        throw new Error(`缺少有效的群 chat_id（需 oc_ 开头，当前=${chatId}）`);
      }
      if (!this.feishu.isConfigured()) {
        throw new Error('未配置 FEISHU_APP_ID/FEISHU_APP_SECRET');
      }
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        notification.retryCount = attempt;
        try {
          const token = await this.feishu.getTenantAccessToken();
          const response = await axios.post(
            'https://open.feishu.cn/open-apis/im/v1/messages',
            { receive_id: chatId, msg_type: msgType, content: JSON.stringify(contentBody) },
            {
              params: { receive_id_type: 'chat_id' },
              headers: { Authorization: `Bearer ${token}` },
              timeout: 30000,
            },
          );
          const data = response.data || {};
          if (data.code !== undefined && data.code !== 0) {
            throw new Error(data.msg || `飞书群消息发送失败（code=${data.code}）`);
          }
          notification.success = true;
          notification.response = data;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 3) await this.wait(200 * attempt);
        }
      }
      if (!notification.success) throw lastError || new Error('飞书群消息发送失败');
    } catch (error) {
      notification.success = false;
      notification.response = this.errorResponse(error);
      this.logger.warn(
        `群通知发送失败 type=${type} chat=${chatId}: ${notification.response.message}`,
      );
    }

    notification.sentAt = new Date();
    try {
      return await this.notifications.save(notification);
    } catch (error) {
      this.logger.error(`通知日志落库失败 type=${type}`, error instanceof Error ? error.stack : undefined);
      return notification;
    }
  }

  /** 群通知去重：type+target(=chat_id)+当天已成功发过？ */
  async hasGroupSuccessfulSince(type: string, target: string, since: Date): Promise<boolean> {
    return (
      (await this.notifications.count({
        where: { type, target, success: true, sentAt: MoreThanOrEqual(since) },
      })) > 0
    );
  }

  private async sendMessage(
    type: string,
    recipientUserId: number | null,
    msgType: FeishuMsgType,
    contentBody: Record<string, any>,
    fallbackContent: string,
    refs: NotificationRefs,
  ): Promise<Notification> {
    const notification = this.notifications.create({
      type,
      recipientId: recipientUserId,
      target: null,
      content: fallbackContent,
      response: null,
      success: false,
      retryCount: 0,
      projectId: refs.projectId ?? null,
      taskId: refs.taskId ?? null,
      planChangeId: refs.planChangeId ?? null,
      sentAt: null,
      createdAt: new Date(),
    });

    try {
      if (process.env.FEISHU_NOTIFY_DISABLED === 'true') throw new Error('本地测试：已禁用真实飞书通知，仅保留通知记录');
      // 本地联调转发：FEISHU_NOTIFY_REDIRECT_USER_ID 填一个内部 user id 后，
      // 所有出站通知统一改发给他，避免打扰真实收件人（如总经办负责人/总经理）。
      let recipient = recipientUserId;
      const redirectRaw = String(process.env.FEISHU_NOTIFY_REDIRECT_USER_ID || '').trim();
      const redirectId = redirectRaw ? Number(redirectRaw) : NaN;
      if (redirectRaw && (!Number.isSafeInteger(redirectId) || redirectId <= 0)) throw new Error('测试通知转发人员配置无效，已停止发送');
      if (Number.isFinite(redirectId) && recipient != null && String(recipient) !== String(redirectId)) {
        recipient = redirectId;
        this.logger.warn(
          `[联调转发] type=${type} 收件人 ${recipientUserId} → ${recipient}（FEISHU_NOTIFY_REDIRECT_USER_ID）`,
        );
      }

      const user = recipient
        ? await this.users.findOne({ where: { id: recipient } })
        : null;
      const target = user?.openId || user?.feishuUserId || null;
      const receiveIdType = user?.openId ? 'open_id' : 'user_id';
      notification.recipientId = recipient;
      notification.target = target;

      if (!target) throw new Error('通知对象没有可用的飞书用户 ID');
      if (!this.feishu.isConfigured()) {
        throw new Error('未配置 FEISHU_APP_ID/FEISHU_APP_SECRET');
      }

      let lastError: unknown = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        notification.retryCount = attempt;
        try {
          const token = await this.feishu.getTenantAccessToken();
          const response = await axios.post(
            'https://open.feishu.cn/open-apis/im/v1/messages',
            {
              receive_id: target,
              msg_type: msgType,
              content: JSON.stringify(contentBody),
            },
            {
              params: { receive_id_type: receiveIdType },
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          const data = response.data || {};
          if (data.code !== undefined && data.code !== 0) {
            throw new Error(data.msg || `飞书消息发送失败（code=${data.code}）`);
          }
          notification.success = true;
          notification.response = msgType === 'interactive' && REVIEW_NOTIFICATION_TYPES.includes(type)
            ? { ...data, reviewCard: contentBody, reviewRef: refs.review ?? {} } : data;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 3) await this.wait(200 * attempt);
        }
      }

      if (!notification.success) throw lastError || new Error('飞书消息发送失败');
    } catch (error) {
      notification.success = false;
      notification.response = this.errorResponse(error);
      this.logger.warn(
        `通知发送失败 type=${type} recipient=${recipientUserId ?? 'none'}: ${notification.response.message}`,
      );
    }

    notification.sentAt = new Date();
    try {
      return await this.notifications.save(notification);
    } catch (error) {
      this.logger.error(`通知日志落库失败 type=${type}`, error instanceof Error ? error.stack : undefined);
      return notification;
    }
  }

  private readonly syncingReviewCards = new Set<string>();

  @Cron('*/1 * * * *')
  async retryReviewCards() { await this.syncReviewCards(); }

  // 审核成功后立即调用；定时任务补偿网络失败、进程中断与发送/审核并发。
  // 回写失败只记录错误，绝不回滚已完成的业务审批，也不另发一张卡片冒充更新。
  async syncReviewCards(refs: NotificationRefs = {}): Promise<void> {
    if (process.env.FEISHU_NOTIFY_DISABLED === 'true' || !this.feishu.isConfigured()) return;
    const redirect = String(process.env.FEISHU_NOTIFY_REDIRECT_USER_ID || '').trim();
    if (redirect && (!Number.isSafeInteger(Number(redirect)) || Number(redirect) <= 0)) return;
    try {
      const qb = this.notifications.createQueryBuilder('n')
        .where('n.success = true AND n.type IN (:...types)', {types: REVIEW_NOTIFICATION_TYPES})
        .andWhere("n.created_at >= NOW() - INTERVAL '14 days'")
        .andWhere("COALESCE(n.response->'reviewSync'->>'done','false') <> 'true'")
        .andWhere("(n.response->'reviewSync'->>'nextAttemptAt' IS NULL OR (n.response->'reviewSync'->>'nextAttemptAt')::timestamptz <= NOW())")
        .orderBy("COALESCE(n.response->'reviewSync'->>'checkedAt','')", 'ASC')
        .addOrderBy('n.id', 'ASC').take(200);
      if (refs.projectId != null) qb.andWhere('n.projectId = :projectId', {projectId:refs.projectId});
      if (refs.taskId != null) qb.andWhere('n.taskId = :taskId', {taskId:refs.taskId});
      if (refs.planChangeId != null) qb.andWhere('n.planChangeId = :planChangeId', {planChangeId:refs.planChangeId});
      if (redirect) qb.andWhere('n.recipientId = :redirect', {redirect:Number(redirect)});
      const rows = await qb.getMany();
      for (const n of rows) {
        if (redirect && String(n.recipientId) !== redirect) continue;
        const key = String(n.id);
        if (this.syncingReviewCards.has(key)) continue;
        this.syncingReviewCards.add(key);
        const checkedAt = new Date().toISOString();
        try {
          const messageId = n.response?.data?.message_id;
          const result = await resolveReviewResult(n, (sql,args) => this.notifications.query(sql,args));
          if (!messageId || !result) {
            await this.recordReviewSync(n, {checkedAt,done:false});
            continue;
          }
          const token = await this.feishu.getTenantAccessToken();
          const response = await axios.patch('https://open.feishu.cn/open-apis/im/v1/messages/'+encodeURIComponent(messageId),
            {content:JSON.stringify(reviewedCard(n,result))},
            {headers:{Authorization:'Bearer '+token},timeout:10000});
          if (response.data?.code !== 0) throw new Error(response.data?.msg || '飞书卡片更新失败');
          await this.recordReviewSync(n, {checkedAt,done:true,label:result.label,updatedAt:checkedAt});
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn('审核卡片回写失败 notification='+n.id+': '+message);
          await this.recordReviewSync(n, {checkedAt,done:false,error:message,nextAttemptAt:new Date(Date.now()+60000).toISOString()}).catch(() => {});
        } finally { this.syncingReviewCards.delete(key); }
      }
    } catch (error) {
      this.logger.warn('审核卡片同步失败：'+(error instanceof Error ? error.message : String(error)));
    }
  }

  private async recordReviewSync(n: Notification, sync: Record<string, unknown>) {
    const response: Record<string, any> = { ...n.response, reviewSync: sync };
    await this.notifications.update(n.id, { response });
  }

  async hasSuccessfulSince(
    type: string,
    recipientUserId: number,
    refs: NotificationRefs,
    since: Date,
  ): Promise<boolean> {
    const where: Record<string, any> = {
      type,
      recipientId: recipientUserId,
      success: true,
      sentAt: MoreThanOrEqual(since),
    };
    if (refs.projectId !== undefined) where.projectId = refs.projectId ?? null;
    if (refs.taskId !== undefined) where.taskId = refs.taskId ?? null;
    if (refs.planChangeId !== undefined) where.planChangeId = refs.planChangeId ?? null;
    return (await this.notifications.count({ where })) > 0;
  }

  private wait(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  private errorResponse(error: any) {
    return {
      message: error?.response?.data?.msg || error?.message || String(error),
      data: error?.response?.data || null,
    };
  }
}
