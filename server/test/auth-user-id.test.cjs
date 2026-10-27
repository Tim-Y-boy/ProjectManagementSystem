const {test}=require('node:test');const assert=require('node:assert/strict');
const {JwtService}=require('@nestjs/jwt');const {JwtAuthGuard}=require('../src/modules/auth/jwt-auth.guard');
const {prepareDepartmentScope,scopeIdentity}=require('../src/modules/closures/closure-department-rules');
const jwt=new JwtService({secret:'local-regression-only-not-a-real-secret'});
function authenticate(userId){const req={headers:{authorization:'Bearer '+jwt.sign({userId,roles:['member']})}};new JwtAuthGuard(jwt).canActivate({switchToHttp:()=>({getRequest:()=>req})});return req.user;}
test('legacy string bigint identity and numeric identity produce the same closure scope',()=>{
 const a=authenticate('3'),b=authenticate(3);assert.equal(a.userId,3);assert.equal(b.userId,3);
 const depts=[{id:17,name:'AI',head_user_id:'3',is_active:true}];
 assert.equal(scopeIdentity(17,a.userId,[3],depts),scopeIdentity(17,b.userId,[3],depts));
 assert.ok(prepareDepartmentScope([],depts,17,a.userId,[3])[0].excludedReason);
});
test('invalid or unsafe authenticated user IDs are rejected',()=>{
 for(const id of [null,0,-1,1.5,'',' 3','3x','1e2',true,{},'9007199254740993'])assert.throws(()=>authenticate(id),/登录/);
});
