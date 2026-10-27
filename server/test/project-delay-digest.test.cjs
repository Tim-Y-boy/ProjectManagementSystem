const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildProjectDelayDigest}=require('../src/modules/closures/project-delay-digest');
const task={projectId:1,projectName:'测试<项目>',projectOwners:'甲',title:'接口验证',owners:'乙',assignees:'丙',days:12};
test('daily report uses shared holiday calendar and skips before querying or sending on rest days',async()=>{
 const {HolidaysService}=require('../src/modules/holidays/holidays.service');
 const {ClosuresService}=require('../src/modules/closures/closures.service');
 const calendar=new HolidaysService({findOne:async({where})=>({'2026-10-01':{kind:'holiday'},'2026-10-10':{kind:'makeup'}}[where.date]||null)});
 assert.equal(await calendar.isWorkday('2026-10-01'),false);
 assert.equal(await calendar.isWorkday('2026-10-11'),false);
 assert.equal(await calendar.isWorkday('2026-10-10'),true);
 assert.equal(await calendar.isWorkday('2026-10-27'),true);
 const service=new ClosuresService({createQueryRunner(){throw Error('must not query');}},{sendCard(){throw Error('must not send');}},{},{isWorkday:async()=>false});
 await service.sendProjectDelayDigest();
});
test('red daily card groups projects, retains people and emphasizes delay days',()=>{
 const [{card,fallback}]=buildProjectDelayDigest([task],'2026-10-27',true);
 assert.equal(card.header.title.content,'项目延期日报');
 assert.match(JSON.stringify(card),/延期 \*\*12 天\*\*/);
 assert.match(JSON.stringify(card),/color='red'/);
 const detail=card.elements.find(e=>e.tag==='note' && e.elements[0].tag==='lark_md');
 assert.ok(detail.elements[0].content.startsWith('　　接口验证'));
 assert.deepEqual([...detail.elements[0].content.matchAll(/<font color='red'>(.*?)<\/font>/g)].map(m=>m[1]),['延期 **12 天**']);
 assert.match(JSON.stringify(card),/&lt;项目&gt;/);
 assert.match(fallback,/测试数据/);assert.match(fallback,/负责人：乙｜执行人：丙/);
});
test('long report splits without dropping tasks and empty day is explicit',()=>{
 const cards=buildProjectDelayDigest(Array.from({length:25},(_,i)=>({...task,title:`任务${i}`})),'2026-10-27');
 assert.equal(cards.length,3);for(let i=0;i<25;i++)assert.ok(cards.some(c=>c.fallback.includes(`任务${i}｜`)));
 assert.match(buildProjectDelayDigest([],'2026-10-27')[0].fallback,/暂无未完成的延期任务/);
});
