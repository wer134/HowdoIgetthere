import { isIP } from 'node:net';

export function networkAddress(address) {
  if (isIP(address) !== 6) return address;
  const dotted = address.match(/(\d+\.\d+\.\d+\.\d+)$/);
  let normalized = address;
  if (dotted) {
    const bytes = dotted[1].split('.').map(Number);
    normalized = address.slice(0, -dotted[1].length) + ((bytes[0] << 8) | bytes[1]).toString(16) + ':' + ((bytes[2] << 8) | bytes[3]).toString(16);
  }
  const [left, right] = normalized.split('::');
  const before = left ? left.split(':') : [];
  const after = right ? right.split(':') : [];
  const groups = right === undefined ? before : [...before, ...Array(8 - before.length - after.length).fill('0'), ...after];
  const words = groups.map(group => Number.parseInt(group, 16));
  if (words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff) return [words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255].join('.');
  return words.slice(0, 4).map(word => word.toString(16).padStart(4, '0')).join(':') + '::/64';
}
