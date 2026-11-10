const {test}=require('node:test');const assert=require('node:assert/strict');
const {parseCharterResponse,charterModelOptions,charterFailureMessage}=require('../src/modules/closures/charter-model-response');
test('reject truncated, empty and malformed responses instead of treating them as successful JSON',()=>{
 assert.throws(()=>parseCharterResponse({choices:[{finish_reason:'length',message:{content:'{}'}}]}),/长度上限/);
 assert.throws(()=>parseCharterResponse({choices:[{message:{content:'{"fields":"cut'}}]}),/格式不完整/);
 assert.throws(()=>parseCharterResponse({choices:[{message:{content:''}}]}),/未返回/);
 assert.deepEqual(parseCharterResponse({choices:[{finish_reason:'stop',message:{content:'{"fields":{}}'}}]}),{fields:{}});
});
test('extraction disables default thinking only for the configured DeepSeek host',()=>{
 assert.equal(charterModelOptions('https://api.deepseek.com/v1').thinking.type,'disabled');
 assert.equal(charterModelOptions('https://other.example/v1').thinking,undefined);
 assert.equal(charterModelOptions('https://api.deepseek.com.evil.example').thinking,undefined);
});
test('failures have actionable messages without exposing raw provider data or credentials',()=>{
 assert.match(charterFailureMessage({code:'ECONNABORTED'}),/超时/);
 assert.match(charterFailureMessage({response:{status:429}}),/较多/);
 assert.match(charterFailureMessage({response:{status:401,data:{error:'secret'}}}),/鉴权/);
 assert.ok(!charterFailureMessage({message:'secret'}).includes('secret'));
});
