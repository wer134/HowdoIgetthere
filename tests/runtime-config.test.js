import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {buildRuntimeConfig} from '../runtime-config-builder.js';
const run=env=>{const context={window:{APP_CONFIG:{}}};vm.runInNewContext(buildRuntimeConfig(env, {localKeys:true}),context);return context.window.APP_CONFIG;};
test('environment bindings select Maps and Gemini without exposing unrelated environment values',()=>{
 const config=run({googlemap:'maps-test-value',geminiapi:'gemini-test-value',unrelated:'private-other'});
 assert.equal(config.googleMapsApiKey,'maps-test-value');assert.equal(config.geminiApiKey,'gemini-test-value');assert.deepEqual(Object.keys(config).sort(),['geminiApiKey','googleMapsApiKey']);
 assert.doesNotMatch(buildRuntimeConfig({unrelated:'private-other'}),/private-other/);
});
test('existing googleAPI setting takes precedence and empty environments emit nothing',()=>{
 assert.equal(run({googleAPI:'legacy',googlemap:'new'}).googleMapsApiKey,'legacy');assert.doesNotMatch(buildRuntimeConfig({}),/geminiApiKey|googleMapsApiKey/);
});
test('runtime values remain JavaScript string data, including quotes and newlines',()=>{
 const value='"; globalThis.injected = true; //\n';const context={window:{APP_CONFIG:{}}};vm.runInNewContext(buildRuntimeConfig({geminiapi:value}, {localKeys:true}),context);
 assert.equal(context.window.APP_CONFIG.geminiApiKey,value);assert.equal(context.injected,undefined);
});

test('private environment keys are absent by default and always absent in production',()=>{
 for(const options of [{},{localKeys:true}]) {
  const output=buildRuntimeConfig({NODE_ENV:'production',geminiapi:'private-ai',googlemap:'private-map',PUBLIC_GOOGLE_MAPS_KEY:'public-map'},options);
  assert(!output.includes('private-ai'));assert(!output.includes('private-map'));assert(output.includes('public-map'));
 }
 assert(!buildRuntimeConfig({geminiapi:'private-ai'}).includes('private-ai'));
});
