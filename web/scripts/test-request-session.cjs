const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
function setup(){
 let token='old'; const auth={token:'old',user:{id:1},isLoggingOut:false,readOnly:false};
 const messages=[],redirects=[];let before,success,failure;
 class CanceledError extends Error{constructor(msg){super(msg);this.cancelled=true}}
 const axios={CanceledError,isCancel:e=>!!e.cancelled,create:()=>({interceptors:{request:{use:f=>before=f},response:{use:(a,b)=>{success=a;failure=b}}}})};
 let source=fs.readFileSync(require('node:path').join(__dirname,'../src/api/request.ts'),'utf8').replace(/^import .*;\r?$/gm,'').replace(/import\.meta\.env\.VITE_API_BASE/g,"'/api'").replace(/import\.meta\.env\.BASE_URL/g,"'/'");
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText,{exports:{},Blob,axios,ElMessage:{error:m=>messages.push(m)},useAuthStore:()=>auth,localStorage:{getItem:()=>token,removeItem:()=>token=''},location:{pathname:'/tasks',replace:p=>redirects.push(p)}});
 return {auth,messages,redirects,before,success,failure,setToken:t=>{token=t;auth.token=t}};
}
test('logout silently cancels active responses and blocks new private requests',async()=>{
 const s=setup(),cfg=s.before({url:'/tasks',headers:{}});s.auth.isLoggingOut=true;
 assert.throws(()=>s.before({url:'/dashboard/my-todo',headers:{}}),e=>e.cancelled&&e.messageShown);
 await assert.rejects(s.failure({config:cfg,response:{status:401,data:{message:'未登录'}}}),e=>e.cancelled);
 await assert.rejects(s.success({config:cfg,data:{code:0,data:['old']}}),e=>e.cancelled);
 s.auth.isLoggingOut=false;s.setToken('');
 assert.throws(()=>s.before({url:'/tasks',headers:{}}),e=>e.cancelled);
 assert.equal(s.messages.length,0);assert.equal(s.redirects.length,0);
});
test('parallel expired requests show one error and cannot clear a new login',async()=>{
 const s=setup(),a=s.before({url:'/tasks',headers:{}}),b=s.before({url:'/reports',headers:{}});
 const err=config=>({config,response:{status:401,data:{message:'登录已过期'}}});
 await assert.rejects(s.failure(err(a)));await assert.rejects(s.failure(err(b)));
 assert.equal(s.messages.length,1);assert.equal(s.redirects.length,1);assert.equal(s.auth.user,null);
 s.setToken('new');await assert.rejects(s.failure(err(b)),e=>e.cancelled);assert.equal(s.auth.token,'new');
});
test('login failures and current business errors remain visible',async()=>{
 const s=setup();s.setToken('');const cfg=s.before({url:'/auth/mock/login',headers:{}});
 await assert.rejects(s.failure({config:cfg,response:{status:401,data:{message:'密码错误'}}}));
 assert.equal(s.messages[0],'密码错误');assert.equal(s.redirects.length,0);
 s.setToken('new');const business=s.before({url:'/tasks',headers:{}});
 await assert.rejects(s.failure({config:business,response:{status:400,data:{message:'请填写任务'}}}));
 assert.equal(s.messages[1],'请填写任务');
});

test('file response errors decode JSON blobs and keep a single meaningful message',async()=>{
 const s=setup(),cfg=s.before({url:'/tasks/59/assets/1/preview',headers:{}});
 await assert.rejects(s.failure({config:cfg,response:{status:404,data:new Blob([JSON.stringify({message:'文件不存在或已被移除'})],{type:'application/json'})}}),e=>e.message==='文件不存在或已被移除'&&e.messageShown);
 assert.deepEqual(s.messages,['文件不存在或已被移除']);
 await assert.rejects(s.failure({config:cfg,response:{status:502,data:new Blob(['<html>Bad gateway</html>'])}}),e=>e.message==='请求失败，请稍后重试');
});
