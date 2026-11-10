require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ValidationPipe } = require('@nestjs/common');
const { ROUTE_ARGS_METADATA } = require('@nestjs/common/constants');
const { ProjectTerminationController } = require('../src/modules/tasks/project-termination.controller');

// Exercise the same global-then-parameter pipe order used by main.ts.
async function listWithQuery(raw) {
  const calls = [];
  const controller = new ProjectTerminationController({ list: async (...args) => { calls.push(args); return []; } });
  const metatype = Reflect.getMetadata('design:paramtypes', ProjectTerminationController.prototype, 'list')[1];
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, ProjectTerminationController, 'list');
  const parameter = Object.values(args).find(arg => arg.index === 1);
  const metadata = { type: 'query', data: parameter.data, metatype };
  let value = await new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }).transform(raw, metadata);
  for (const pipe of parameter.pipes) value = await pipe.transform(value, metadata);
  await controller.list({ userId: 1 }, value);
  return calls[0][1];
}

test('termination inbox loads without an optional projectId', async () => {
  assert.equal(await listWithQuery(undefined), undefined);
});
test('termination project filter reaches service as a number', async () => {
  assert.equal(await listWithQuery('15'), 15);
});
test('invalid project filters remain rejected', async () => {
  for (const value of ['abc', '', '1.5']) await assert.rejects(listWithQuery(value), { status: 400 });
});
