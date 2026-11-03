import test from 'node:test';
import assert from 'node:assert/strict';
import { networkAddress } from '../backend/network.js';

test('compressed, expanded, uppercase and rotated IPv6 addresses share the same /64 budget bucket',()=>{
  const expected='2001:0db8:0000:0000::/64';
  for(const address of ['2001:db8::1','2001:db8::2','2001:0DB8:0000:0000:0000:0000:0000:0001','2001:db8:0:0:ffff:ffff:ffff:ffff'])assert.equal(networkAddress(address),expected);
  assert.notEqual(networkAddress('2001:db8:0:1::1'),expected);
});
test('IPv4 mapped IPv6 forms share the direct IPv4 budget bucket',()=>{
  for(const address of ['192.0.2.1','::ffff:192.0.2.1','::ffff:c000:201','0:0:0:0:0:ffff:c000:0201'])assert.equal(networkAddress(address),'192.0.2.1');
  assert.equal(networkAddress('::1'),'0000:0000:0000:0000::/64');
});
