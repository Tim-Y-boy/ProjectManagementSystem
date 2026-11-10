const {test}=require('node:test');const assert=require('node:assert/strict');
const {JwtService}=require('@nestjs/jwt');const {JwtAuthGuard}=require('../src/modules/auth/jwt-auth.guard');
const {prepareDepartmentScope,scopeIdentity}=require('../src/modules/closures/closure-department-rules');
const jwt=new JwtService({secret:'local-regression-only-not-a-real-secret'});
async function authenticate(userId){const req={headers:{authorization:'Bearer '+jwt.sign({feishuUserId:'test-person',userId,roles:['member']})}};await new JwtAuthGuard(jwt,{query:async()=>[{feishu_user_id:'test-person',read_only:false,is_active:true}]}).canActivate({switchToHttp:()=>({getRequest:()=>req})});return req.user;}
test('legacy string bigint identity and numeric identity produce the same closure scope',async()=>{
 const a=await authenticate('3'),b=await authenticate(3);assert.equal(a.userId,3);assert.equal(b.userId,3);
 const depts=[{id:17,name:'AI',head_user_id:'3',is_active:true}];
 assert.equal(scopeIdentity(17,a.userId,[3],depts),scopeIdentity(17,b.userId,[3],depts));
 assert.ok(prepareDepartmentScope([],depts,17,a.userId,[3])[0].excludedReason);
});
test('invalid or unsafe authenticated user IDs are rejected',async()=>{
 for(const id of [null,0,-1,1.5,'',' 3','3x','1e2',true,{},'9007199254740993'])await assert.rejects(()=>authenticate(id),error=>error.getStatus()===401);
});
