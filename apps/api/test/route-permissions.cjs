require('reflect-metadata');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {AppModule}=require('../dist/app.module');
test('every HTTP endpoint explicitly declares permission or public access',()=>{
  const controllers=Reflect.getMetadata('controllers',AppModule);
  let checked=0;
  for(const controller of controllers)for(const name of Object.getOwnPropertyNames(controller.prototype)){
    const method=controller.prototype[name];
    if(typeof method!=='function'||Reflect.getMetadata('method',method)===undefined)continue;
    const publicAccess=Reflect.getMetadata('public',method)??Reflect.getMetadata('public',controller);
    const permissions=Reflect.getMetadata('permissions',method)??Reflect.getMetadata('permissions',controller);
    assert.ok(publicAccess||permissions?.length,controller.name+'.'+name+' requires explicit authorization');checked++;
  }
  assert.ok(checked>50);
});
