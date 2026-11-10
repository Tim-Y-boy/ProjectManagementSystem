const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),vue=require('vue');
function setup({feishu=true,search='?redirect=%2Fmobile%2Ftask%2F42',authorize,fetchMe}={}) {
 let mounted, authorizeCalls=0,sdkCalls=0; const errors=[],destinations=[],memory=new Map();
 const location={search,href:''};
 const info={url:'https://example.test/authorize',feishuConfigured:true,appId:'test-app',mockAvailable:false};
 const auth={setToken(t){this.token=t},fetchMe:fetchMe||async function(){this.user={id:1}}};
 const api={authorize:async()=>{authorizeCalls++;return authorize?authorize():info},loginFreeByCode:async()=>({accessToken:'test'})};
 const source=fs.readFileSync(require('path').join(__dirname,'../src/views/Login.vue'),'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]+'\nexports.subject={feishuLogin,loading,mockAvailable};';
 const context={exports:{},location,navigator:{userAgent:'Feishu iPhone Mobile'},URLSearchParams,sessionStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},require(name){return {'vue':{...vue,onMounted:fn=>mounted=fn},'vue-router':{useRouter:()=>({replace:async target=>destinations.push(target)})},'@/stores/auth':{useAuthStore:()=>auth},'@/api':{authApi:api},'@/utils/feishu-sso':{isFeishuEnv:()=>feishu,fetchFeishuFreeCode:async()=>{sdkCalls++;throw Error('native authorization failure')}},'element-plus':{ElMessage:{error:m=>errors.push(m),info(){},warning(){},success(){}}}}[name]||{};}};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
 return {...context.exports.subject,mount:()=>mounted(),location,memory,errors,destinations,auth,get authorizeCalls(){return authorizeCalls},get sdkCalls(){return sdkCalls}};
}
test('mobile Feishu enters web authorization once without a failing native authorization attempt',async()=>{
 const f=setup();await f.mount();assert.equal(f.sdkCalls,0);assert.equal(f.authorizeCalls,1);assert.equal(f.location.href,'https://example.test/authorize');assert.equal(f.memory.get('loginRedirect'),'/mobile/task/42');assert.deepEqual(f.errors,[]);
});
test('manual click cannot race automatic authorization initialization',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);const f=setup({authorize:()=>pending});const boot=f.mount();const click=f.feishuLogin();
 assert.equal(f.authorizeCalls,1);resolve({url:'https://example.test/authorize',feishuConfigured:true,appId:'test-app'});await Promise.all([boot,click]);assert.equal(f.authorizeCalls,1);
});
test('ordinary browser waits for a click; repeat clicks cannot start duplicate redirects',async()=>{
 const f=setup({feishu:false});await f.mount();assert.equal(f.location.href,'');assert.equal(f.loading.value,false);await Promise.all([f.feishuLogin(),f.feishuLogin()]);assert.equal(f.authorizeCalls,2);assert.equal(f.location.href,'https://example.test/authorize');
});
test('real authorization failures remain visible once and allow retry',async()=>{
 let fail=true;const f=setup({authorize:()=>{if(fail)throw Error('network unavailable');return {url:'https://example.test/authorize',feishuConfigured:true}}});await f.mount();assert.deepEqual(f.errors,['network unavailable']);assert.equal(f.loading.value,false);fail=false;await f.feishuLogin();assert.equal(f.location.href,'https://example.test/authorize');
});
test('callback validates user and returns to the original task without restarting authorization',async()=>{
 const f=setup({search:'?token=test-token'});f.memory.set('loginRedirect','/mobile/task/42');await f.mount();assert.equal(f.authorizeCalls,0);assert.equal(f.auth.token,'test-token');assert.deepEqual(f.destinations,['/mobile/task/42']);
});

test('failed callback user validation never navigates into the application',async()=>{
 const f=setup({search:'?token=invalid',fetchMe:async()=>{throw Error('session expired')}});await f.mount();assert.deepEqual(f.destinations,[]);assert.deepEqual(f.errors,['session expired']);assert.equal(f.loading.value,false);
});
test('an error already reported by the request interceptor is not displayed twice',async()=>{
 const f=setup({authorize:()=>{throw Object.assign(Error('offline'),{messageShown:true})}});await f.mount();assert.deepEqual(f.errors,[]);assert.equal(f.loading.value,false);
});
