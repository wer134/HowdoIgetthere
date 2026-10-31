// Session-only LRU caches; personal travel records are never stored here.
export class BoundedMap extends Map {
  constructor(limit = 200) { super(); this.limit = limit; }
  get(key) { if (!super.has(key)) return undefined; const value = super.get(key); super.delete(key); super.set(key,value); return value; }
  set(key,value) { super.delete(key); super.set(key,value); while(this.size>this.limit)super.delete(this.keys().next().value); return this; }
}
export class BoundedSet extends Set {
  constructor(limit = 200) { super(); this.limit = limit; }
  add(value) { super.delete(value); super.add(value); while(this.size>this.limit)super.delete(this.values().next().value);return this; }
}
