const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JwtService } = require('@nestjs/jwt');
const { JwtAuthGuard } = require('../src/modules/auth/jwt-auth.guard');
test('a token cannot become another person after restoring a database with reused IDs', async () => {
  const jwt = new JwtService({ secret: 'identity-test-only' });
  const guard = new JwtAuthGuard(jwt, { query: async () => [{ is_active:true, read_only:false, feishu_user_id:'new-person' }] });
  for (const identity of ['old-person', undefined]) {
    const req = { headers: { authorization: 'Bearer ' + jwt.sign({ userId:3, feishuUserId:identity, roles:['admin'] }) } };
    await assert.rejects(guard.canActivate({switchToHttp:()=>({getRequest:()=>req})}), e=>e.getStatus()===401);
  }
  const req = {headers:{authorization:'Bearer '+jwt.sign({userId:3,feishuUserId:'new-person',roles:['member']})}};
  assert.equal(await guard.canActivate({switchToHttp:()=>({getRequest:()=>req})}),true);
});
