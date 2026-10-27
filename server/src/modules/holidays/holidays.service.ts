import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Holiday } from '../../entities/holiday.entity';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ['holiday', 'makeup'] as const;

@Injectable()
export class HolidaysService {
  constructor(@InjectRepository(Holiday) private holidays: Repository<Holiday>) {}

  // 某日是否工作日：自然周一~五上班、周六日休息；存在覆盖配置（date 命中 holidays 表）则按 kind 翻转
  // holiday=该日本应上班→休息；makeup=该日本应休息→上班（调休补班）
  async isWorkday(dateStr: string): Promise<boolean> {
    const [y, m, d] = dateStr.split('-').map(Number);
    if (!y || !m || !d) return false;
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=周日
    let work = dow >= 1 && dow <= 5;
    const row = await this.holidays.findOne({ where: { date: dateStr } });
    if (row) work = row.kind === 'makeup';
    return work;
  }

  // 节假日覆盖配置列表：可按年（YYYY）过滤
  list(year?: string): Promise<Holiday[]> {
    if (year && /^\d{4}$/.test(year)) {
      return this.holidays.find({
        where: { date: Between(`${year}-01-01`, `${year}-12-31`) },
        order: { date: 'ASC' },
      });
    }
    return this.holidays.find({ order: { date: 'ASC' } });
  }

  // 新建/覆盖：同一天存在则更新 kind/name（幂等）
  async create(body: any): Promise<Holiday> {
    const date = String(body.date ?? '').trim();
    if (!DATE_RE.test(date)) throw new BadRequestException('日期格式需为 YYYY-MM-DD');
    const kind = body.kind;
    if (!KINDS.includes(kind)) throw new BadRequestException('kind 仅支持 holiday(放假) / makeup(补班)');
    const name = body.name ? String(body.name).trim().slice(0, 64) : null;
    const existed = await this.holidays.findOne({ where: { date } });
    if (existed) {
      existed.kind = kind;
      existed.name = name;
      return this.holidays.save(existed);
    }
    return this.holidays.save(this.holidays.create({ date, kind, name }));
  }

  async remove(id: number): Promise<{ ok: boolean }> {
    const row = await this.holidays.findOne({ where: { id } });
    if (!row) throw new NotFoundException('记录不存在');
    await this.holidays.delete(id);
    return { ok: true };
  }
}
