import { Body, Controller, Get, Param, ParseIntPipe, Post, StreamableFile, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtPayload } from '../auth/types';
import { ClosuresService } from './closures.service';
import { ClosureRuleConfigService } from './closure-rule-config.service';
import { CharterAnalysisService } from './charter-analysis.service';

@Controller('closures')
@UseGuards(JwtAuthGuard)
export class ClosuresController {
  constructor(private closures: ClosuresService, private ruleConfig:ClosureRuleConfigService, private analysis:CharterAnalysisService) {}
  @Get('rules') rules(@CurrentUser() u:JwtPayload){return this.ruleConfig.list(u);}
  @Post('rules') saveRule(@CurrentUser() u:JwtPayload,@Body() body:any){return this.ruleConfig.save(u,body);}
  @Get('projects/:id/analysis') analysisStatus(@CurrentUser() u:JwtPayload,@Param('id',ParseIntPipe) id:number){return this.analysis.latest(u,id);}
  @Post('projects/:id/analysis') analyze(@CurrentUser() u:JwtPayload,@Param('id',ParseIntPipe) id:number,@Body() body:any){return this.analysis.start(u,id,body);}
  @Post('projects/:id/draft') draft(@CurrentUser() u:JwtPayload,@Param('id',ParseIntPipe) id:number,@Body() body:any){return this.closures.saveDraft(u,id,body);}
  @Get() list(@CurrentUser() u: JwtPayload) { return this.closures.list(u); }
  @Get('ready') ready(@CurrentUser() u: JwtPayload) { return this.closures.readyProjects(u); }
  @Get('notices') notices(@CurrentUser() u: JwtPayload) { return this.closures.inbox(u); }
  @Get('delays') delays(@CurrentUser() u: JwtPayload) { return this.closures.delays(u); }
  @Get('delays/:id') delay(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number) { return this.closures.delayDetail(u,id); }
  @Get('supplement-audit') audit(@CurrentUser() u: JwtPayload) { return this.closures.supplementAudit(u); }
  @Get('hr-access') access(@CurrentUser() u: JwtPayload) { return this.closures.hrAccess(u); }
  @Post('hr-access') grant(@CurrentUser() u: JwtPayload, @Body() body: any) { return this.closures.grantHr(u,body); }
  @Post('hr-access/:id/revoke') revoke(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number) { return this.closures.revokeHr(u,id); }
  @Post('followups/:kind/:id') followup(@CurrentUser() u: JwtPayload, @Param('kind') kind: string, @Param('id', ParseIntPipe) id: number, @Body() body: any) { return this.closures.followup(u,kind,id,body); }
  @Post('reopens/:id/review') reopenReview(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number, @Body() body: any) { return this.closures.reviewReopen(u,id,body.approve,body.comment); }
  @Get('projects/:id/preview') preview(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number) { return this.closures.preview(u, id); }
  @Post('projects/:id/charters')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024, files: 1 } }))
  uploadCharter(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number, @UploadedFile() file: any) { return this.closures.uploadCharter(u,id,file); }
  @Get(':id/charters/:fileId/download')
  async charter(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number, @Param('fileId', ParseIntPipe) fileId: number) {
    const file = await this.closures.downloadCharter(u,id,fileId);
    return new StreamableFile(file.stream,{type:'application/octet-stream',disposition:`attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`});
  }
  @Post(':id/transfer') transfer(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number, @Body() body: any) { return this.closures.transfer(u,id,body); }
  @Post('projects/:id') submit(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number, @Body() body: any) { return this.closures.submit(u, id, body); }
  @Post('notices/:id/acknowledge') acknowledge(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number) { return this.closures.acknowledge(u, id); }
  @Get(':id') one(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number) { return this.closures.one(u, id); }
  @Get(':id/export') exportReport(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number) { return this.closures.exportReport(u, id); }
  @Get(':id/assets/:assetId/download') async download(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number, @Param('assetId', ParseIntPipe) assetId: number) {
    const file = await this.closures.downloadAsset(u, id, assetId);
    return new StreamableFile(file.stream, { type: 'application/octet-stream', disposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}` });
  }
  @Post(':id/approve') approve(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number, @Body() body: any) { return this.closures.review(u, id, true, body.comment,body.checklists); }
  @Post(':id/reject') reject(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number, @Body() body: any) { return this.closures.review(u, id, false, body.comment,body.checklists); }
  @Post(':id/withdraw') withdraw(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number, @Body('reason') reason: string) { return this.closures.withdraw(u,id,reason); }
  @Post(':id/reopen') reopen(@CurrentUser() u: JwtPayload, @Param('id', ParseIntPipe) id: number, @Body('reason') reason: string) { return this.closures.requestReopen(u,id,reason); }
}
